const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { dataDir, waStickersDir } = require('./config');
const { db } = require('./db');
const { broadcastToRole } = require('./sse');

const waAuthDir = path.join(dataDir, 'wa-auth');
const lidMapFile = path.join(dataDir, 'wa-lid-map.json');

const waState = {
  sock: null,
  status: 'disconnected', // 'disconnected' | 'connecting' | 'qr' | 'connected' | 'missing_dependency'
  qrDataUrl: '',
  phoneNumber: '',
  lastError: ''
};

let isConnectingLock = false;
let reconnectTimer = null;
const messageQueue = [];
let processingQueue = false;
let sendLockChain = Promise.resolve();

function withSendLock(fn) {
  const next = sendLockChain.then(() => fn(), () => fn());
  sendLockChain = next.catch(() => {});
  return next;
}

// Caché limpio de texto/contenido enviado (SIN messageContextInfo) para retry receipts
const sentCleanPayloadCache = new Map();
const lidToPhoneMap = new Map();
const verifiedJidCache = new Map();
const retryCounterStore = new Map();
const signalMemoryStore = new Map();

const msgRetryCounterCache = {
  get: (key) => retryCounterStore.get(key),
  set: (key, val) => {
    retryCounterStore.set(key, val);
    if (retryCounterStore.size > 2000) {
      retryCounterStore.delete(retryCounterStore.keys().next().value);
    }
  },
  del: (key) => retryCounterStore.delete(key),
  flushAll: () => retryCounterStore.clear()
};

// CacheStore sin TTL de 5 minutos para makeCacheableSignalKeyStore (evita la desincronización a los 5 min)
const signalKeyCacheStore = {
  get: (key) => signalMemoryStore.get(key),
  set: (key, val) => {
    signalMemoryStore.set(key, val);
    if (signalMemoryStore.size > 5000) {
      signalMemoryStore.delete(signalMemoryStore.keys().next().value);
    }
  },
  del: (key) => signalMemoryStore.delete(key),
  flushAll: () => signalMemoryStore.clear()
};

function loadJsonMap(filePath, targetMap) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (Array.isArray(raw)) {
        raw.forEach(([k, v]) => {
          if (k && v) targetMap.set(String(k), v);
        });
      }
    }
  } catch {}
}

function saveJsonMap(filePath, sourceMap, maxEntries = 800) {
  try {
    const entries = Array.from(sourceMap.entries()).slice(-maxEntries);
    fs.writeFileSync(filePath, JSON.stringify(entries), 'utf8');
  } catch {}
}

loadJsonMap(lidMapFile, lidToPhoneMap);

// --- Store Atómico de Autenticación y Llaves Signal en SQLite ---
let authWriteChain = Promise.resolve();

function sqlGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function sqlAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function sqlRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function migrateLegacyMultiFileIfNeeded() {
  const existing = await sqlGet(`SELECT k FROM wa_auth_state WHERE k = 'creds'`);
  if (existing) return;
  const credsPath = path.join(waAuthDir, 'creds.json');
  if (!fs.existsSync(credsPath)) return;

  try {
    const files = fs.readdirSync(waAuthDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const raw = fs.readFileSync(path.join(waAuthDir, f), 'utf8');
      const base = f.replace(/\.json$/, '');
      const keyName = base === 'creds' ? 'creds' : base;
      await sqlRun(`INSERT OR REPLACE INTO wa_auth_state (k, v) VALUES (?, ?)`, [keyName, raw]);
    }
  } catch {}
}

async function useSqliteAuthState(baileys) {
  const { initAuthCreds, BufferJSON, proto } = baileys;
  await migrateLegacyMultiFileIfNeeded();

  const readItem = async (keyName) => {
    const row = await sqlGet(`SELECT v FROM wa_auth_state WHERE k = ?`, [keyName]);
    if (!row || !row.v) return null;
    try {
      return JSON.parse(row.v, BufferJSON.reviver);
    } catch {
      return null;
    }
  };

  const enqueueWriteBatch = (ops) => {
    const task = authWriteChain.then(async () => {
      await sqlRun('BEGIN IMMEDIATE TRANSACTION');
      try {
        for (const op of ops) {
          if (op.val === null || op.val === undefined) {
            await sqlRun(`DELETE FROM wa_auth_state WHERE k = ?`, [op.key]);
          } else {
            const serialized = JSON.stringify(op.val, BufferJSON.replacer);
            await sqlRun(`INSERT OR REPLACE INTO wa_auth_state (k, v) VALUES (?, ?)`, [op.key, serialized]);
          }
        }
        await sqlRun('COMMIT');
      } catch (e) {
        await sqlRun('ROLLBACK').catch(() => {});
      }
    });
    authWriteChain = task.catch(() => {});
    return task;
  };

  const creds = (await readItem('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          if (!ids || !ids.length) return data;
          const keyNames = ids.map(id => `${type}-${id}`);
          const placeholders = keyNames.map(() => '?').join(',');
          const rows = await sqlAll(`SELECT k, v FROM wa_auth_state WHERE k IN (${placeholders})`, keyNames);
          const byKey = new Map(rows.map(r => [r.k, r.v]));

          for (const id of ids) {
            const raw = byKey.get(`${type}-${id}`);
            if (!raw) continue;
            try {
              let parsed = JSON.parse(raw, BufferJSON.reviver);
              if (type === 'app-state-sync-key' && parsed && proto?.Message?.AppStateSyncKeyData) {
                parsed = proto.Message.AppStateSyncKeyData.fromObject(parsed);
              }
              data[id] = parsed;
            } catch {}
          }
          return data;
        },
        set: async (data) => {
          const ops = [];
          for (const category of Object.keys(data || {})) {
            const entries = data[category] || {};
            for (const id of Object.keys(entries)) {
              const value = entries[id];
              ops.push({ key: `${category}-${id}`, val: value || null });
            }
          }
          if (ops.length) {
            await enqueueWriteBatch(ops);
          }
        }
      }
    },
    saveCreds: async () => {
      await enqueueWriteBatch([{ key: 'creds', val: creds }]);
    }
  };
}

async function hasSavedAuthCreds() {
  try {
    const row = await sqlGet(`SELECT k FROM wa_auth_state WHERE k = 'creds'`);
    if (row) return true;
  } catch {}
  return fs.existsSync(path.join(waAuthDir, 'creds.json'));
}

async function wipeAllAuthState() {
  signalMemoryStore.clear();
  retryCounterStore.clear();
  verifiedJidCache.clear();
  await sqlRun(`DELETE FROM wa_auth_state`).catch(() => {});
  if (fs.existsSync(waAuthDir)) {
    fs.rmSync(waAuthDir, { recursive: true, force: true });
  }
}

function recordLidMapping(lidRaw, pnRaw) {
  const lid = String(lidRaw || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  const pn = normalizePeruPhone(String(pnRaw || '').split('@')[0].split(':')[0]);
  if (lid && pn && lid !== pn) {
    if (lidToPhoneMap.get(lid) !== pn) {
      lidToPhoneMap.set(lid, pn);
      saveJsonMap(lidMapFile, lidToPhoneMap, 1000);
      db.run(
        `UPDATE wa_messages SET peer_phone = ?, peer_jid = ? WHERE peer_phone = ?`,
        [pn, `${pn}@s.whatsapp.net`, lid],
        () => {}
      );
    }
  }
}

// Guarda una copia LIMPIA (sin messageContextInfo ni deviceListMetadata viejos) para que getMessage re-encripte perfecto
function cacheCleanOutgoingMessage(msgId, cleanMessageObj) {
  if (!msgId || !cleanMessageObj) return;
  const copy = { ...cleanMessageObj };
  delete copy.messageContextInfo;
  sentCleanPayloadCache.set(String(msgId), copy);
  while (sentCleanPayloadCache.size > 400) {
    sentCleanPayloadCache.delete(sentCleanPayloadCache.keys().next().value);
  }
}

function destroyCurrentSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const old = waState.sock;
  waState.sock = null;
  if (old) {
    try {
      if (old.ev && typeof old.ev.removeAllListeners === 'function') {
        old.ev.removeAllListeners('connection.update');
        old.ev.removeAllListeners('creds.update');
        old.ev.removeAllListeners('messages.upsert');
        old.ev.removeAllListeners('contacts.upsert');
        old.ev.removeAllListeners('contacts.update');
      }
    } catch {}
    try {
      old.end(undefined);
    } catch {}
    try {
      if (old.ws && typeof old.ws.close === 'function') old.ws.close();
    } catch {}
  }
}

function loadBaileys() {
  try {
    const baileys = require('@whiskeysockets/baileys');
    const QRCode = require('qrcode');
    return { baileys, QRCode };
  } catch {
    return null;
  }
}

function normalizePeruPhone(rawPhone) {
  const clean = String(rawPhone || '').split('@')[0].split(':')[0];
  const digits = clean.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 9 && digits.startsWith('9')) {
    return `51${digits}`;
  }
  if (digits.length >= 10 && digits.length <= 15) {
    return digits;
  }
  return '';
}

function getWhatsAppStatus() {
  return {
    status: waState.status,
    qrDataUrl: waState.qrDataUrl,
    phoneNumber: waState.phoneNumber,
    lastError: waState.lastError,
    queueLength: messageQueue.length
  };
}

function unwrapMessageContent(m) {
  if (!m) return null;
  if (m.ephemeralMessage && m.ephemeralMessage.message) return unwrapMessageContent(m.ephemeralMessage.message);
  if (m.viewOnceMessage && m.viewOnceMessage.message) return unwrapMessageContent(m.viewOnceMessage.message);
  if (m.viewOnceMessageV2 && m.viewOnceMessageV2.message) return unwrapMessageContent(m.viewOnceMessageV2.message);
  if (m.documentWithCaptionMessage && m.documentWithCaptionMessage.message) return unwrapMessageContent(m.documentWithCaptionMessage.message);
  return m;
}

function extractWaText(msg) {
  const m = unwrapMessageContent(msg && msg.message);
  if (!m) return '';
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage && m.extendedTextMessage.text) return m.extendedTextMessage.text;
  if (m.imageMessage) return m.imageMessage.caption ? `📷 ${m.imageMessage.caption}` : '📷 [Imagen]';
  if (m.videoMessage) return m.videoMessage.caption ? `🎥 ${m.videoMessage.caption}` : '🎥 [Video]';
  if (m.documentMessage) return `📄 [Documento: ${m.documentMessage.fileName || 'archivo'}]`;
  if (m.audioMessage) return '🎵 [Nota de voz / Audio]';
  if (m.stickerMessage) return '[Sticker]';
  return '';
}

function inferCategoryForPeer(phone, explicitCategory, cb) {
  const valid = ['tareas', 'libre', 'ti'];
  if (explicitCategory && valid.includes(explicitCategory)) {
    return cb(explicitCategory);
  }
  db.get(
    `SELECT category FROM wa_messages WHERE peer_phone = ? AND category IN ('tareas', 'ti') ORDER BY id DESC LIMIT 1`,
    [phone],
    (err, prev) => {
      if (prev && prev.category) return cb(prev.category);
      db.get(`SELECT id FROM ti_clients WHERE REPLACE(REPLACE(phone, ' ', ''), '+', '') LIKE ? LIMIT 1`, [`%${phone.slice(-9)}%`], (e2, tiRow) => {
        if (tiRow) return cb('ti');
        cb('libre');
      });
    }
  );
}

function saveWaChatMessage({
  peerPhone,
  peerJid = '',
  peerName = '',
  direction = 'in',
  category = '',
  mediaType = 'text',
  mediaFile = '',
  body = '',
  waMsgId = '',
  isRead = 0
}) {
  const rawDigits = String(peerPhone || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  const mappedPhone = lidToPhoneMap.get(rawDigits) || normalizePeruPhone(rawDigits) || rawDigits;
  if (!mappedPhone || (!body && !mediaFile)) return;

  inferCategoryForPeer(mappedPhone, category, (finalCat) => {
    db.run(
      `INSERT INTO wa_messages (peer_phone, peer_jid, peer_name, direction, category, media_type, media_file, body, wa_msg_id, is_read)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        mappedPhone,
        String(peerJid || ''),
        String(peerName || '').trim(),
        direction,
        finalCat,
        mediaType || 'text',
        String(mediaFile || ''),
        String(body || ''),
        String(waMsgId || ''),
        isRead ? 1 : 0
      ],
      function (err) {
        if (!err) {
          broadcastToRole('admin', {
            type: 'wa_message',
            message: {
              id: this.lastID,
              peer_phone: mappedPhone,
              peer_jid: String(peerJid || ''),
              peer_name: String(peerName || '').trim(),
              direction,
              category: finalCat,
              media_type: mediaType || 'text',
              media_file: String(mediaFile || ''),
              body: String(body || ''),
              is_read: isRead ? 1 : 0,
              created_at: new Date().toISOString()
            }
          });
        }
      }
    );
  });
}

function lookupDbMessageByWaId(waId) {
  return new Promise((resolve) => {
    if (!waId) return resolve(undefined);
    db.get(`SELECT body, media_type FROM wa_messages WHERE wa_msg_id = ? ORDER BY id DESC LIMIT 1`, [String(waId)], (err, row) => {
      if (err || !row || !row.body || row.media_type === 'sticker') return resolve(undefined);
      resolve({ conversation: String(row.body) });
    });
  });
}

async function downloadAndSaveIncomingSticker(baileys, sock, msg, silentLogger) {
  try {
    if (!baileys || typeof baileys.downloadMediaMessage !== 'function') return '';
    const buf = await baileys.downloadMediaMessage(
      msg,
      'buffer',
      {},
      { logger: silentLogger, reuploadRequest: sock.updateMediaMessage }
    );
    if (!buf || !buf.length) return '';
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const fileName = `stk-${sha.slice(0, 20)}.webp`;
    const fullPath = path.join(waStickersDir, fileName);
    if (!fs.existsSync(fullPath)) {
      fs.writeFileSync(fullPath, buf);
    }
    db.run(`INSERT OR IGNORE INTO wa_stickers (file_name, sha256) VALUES (?, ?)`, [fileName, sha], () => {});
    return fileName;
  } catch {
    return '';
  }
}

async function connectWhatsApp() {
  const libs = loadBaileys();
  if (!libs) {
    waState.status = 'missing_dependency';
    waState.lastError = 'Falta instalar @whiskeysockets/baileys y qrcode en el servidor (npm install).';
    return getWhatsAppStatus();
  }

  if (isConnectingLock || waState.status === 'connected' || waState.status === 'connecting') {
    return getWhatsAppStatus();
  }

  isConnectingLock = true;
  destroyCurrentSocket();
  signalMemoryStore.clear();

  const { baileys, QRCode } = libs;
  const makeWASocket = baileys.default || baileys.makeWASocket;
  const {
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers,
    proto
  } = baileys;

  waState.status = 'connecting';
  waState.lastError = '';
  waState.qrDataUrl = '';

  try {
    const { state, saveCreds } = await useSqliteAuthState(baileys);
    let version;
    try {
      const vInfo = await fetchLatestBaileysVersion();
      version = vInfo.version;
    } catch {}

    const silentLogger = {
      level: 'silent',
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
      child: () => silentLogger
    };

    const authConfig = {
      creds: state.creds,
      keys: typeof makeCacheableSignalKeyStore === 'function'
        ? makeCacheableSignalKeyStore(state.keys, silentLogger, signalKeyCacheStore)
        : state.keys
    };

    const browserTuple = (Browsers && typeof Browsers.ubuntu === 'function')
      ? Browsers.ubuntu('Chrome')
      : ['Ubuntu', 'Chrome', '22.04.4'];

    const sock = makeWASocket({
      version,
      auth: authConfig,
      printQRInTerminal: false,
      logger: silentLogger,
      browser: browserTuple,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      keepAliveIntervalMs: 20000,
      connectTimeoutMs: 45000,
      defaultQueryTimeoutMs: 45000,
      retryRequestDelayMs: 250,
      maxMsgRetryCount: 5,
      msgRetryCounterCache,
      getMessage: async (key) => {
        if (!key || !key.id) return undefined;
        let payload = sentCleanPayloadCache.get(String(key.id));
        if (!payload) {
          payload = await lookupDbMessageByWaId(key.id);
        }
        if (!payload) return undefined;
        if (proto && proto.Message && typeof proto.Message.fromObject === 'function') {
          return proto.Message.fromObject(payload);
        }
        return payload;
      }
    });

    waState.sock = sock;
    sock.ev.on('creds.update', saveCreds);

    const handleContactList = (contacts) => {
      if (!Array.isArray(contacts)) return;
      for (const c of contacts) {
        if (!c) continue;
        if (c.lid && c.id && String(c.id).endsWith('@s.whatsapp.net')) {
          recordLidMapping(c.lid, c.id);
        } else if (c.id && String(c.id).endsWith('@lid') && c.phoneNumber) {
          recordLidMapping(c.id, c.phoneNumber);
        }
      }
    };

    sock.ev.on('contacts.upsert', handleContactList);
    sock.ev.on('contacts.update', handleContactList);

    sock.ev.on('messages.upsert', async ({ messages }) => {
      if (!Array.isArray(messages)) return;
      for (const m of messages) {
        if (!m || !m.key) continue;
        if (m.key.fromMe) {
          const innerOut = unwrapMessageContent(m.message);
          if (innerOut && m.key.id) {
            if (innerOut.conversation) {
              cacheCleanOutgoingMessage(m.key.id, { conversation: innerOut.conversation });
            } else if (innerOut.extendedTextMessage?.text) {
              cacheCleanOutgoingMessage(m.key.id, { conversation: innerOut.extendedTextMessage.text });
            } else {
              cacheCleanOutgoingMessage(m.key.id, innerOut);
            }
          }
          continue;
        }
        const jid = String(m.key.remoteJid || '');
        if (!jid || jid === 'status@broadcast' || jid.endsWith('@g.us') || jid.endsWith('@newsletter')) continue;

        const altJid = String(m.key.senderPn || m.key.remoteJidAlt || m.participantAlt || '');
        if (jid.endsWith('@lid') && altJid) {
          recordLidMapping(jid, altJid);
        }

        const rawUser = jid.split('@')[0].split(':')[0];
        let resolvedPhone = '';
        let resolvedJid = jid;

        if (jid.endsWith('@lid')) {
          const fromAlt = altJid ? normalizePeruPhone(altJid) : '';
          const fromMap = lidToPhoneMap.get(rawUser) || '';
          resolvedPhone = fromAlt || fromMap || rawUser;
          if (fromAlt || fromMap) {
            resolvedJid = `${resolvedPhone}@s.whatsapp.net`;
          }
        } else {
          resolvedPhone = normalizePeruPhone(rawUser) || rawUser;
          resolvedJid = `${resolvedPhone}@s.whatsapp.net`;
        }

        const inner = unwrapMessageContent(m.message);
        if (inner && inner.stickerMessage) {
          const stkFile = await downloadAndSaveIncomingSticker(baileys, sock, m, silentLogger);
          saveWaChatMessage({
            peerPhone: resolvedPhone,
            peerJid: resolvedJid,
            peerName: m.pushName || '',
            direction: 'in',
            mediaType: stkFile ? 'sticker' : 'text',
            mediaFile: stkFile,
            body: '[Sticker]',
            waMsgId: m.key.id || '',
            isRead: 0
          });
          continue;
        }

        const body = extractWaText(m);
        if (resolvedPhone && body) {
          saveWaChatMessage({
            peerPhone: resolvedPhone,
            peerJid: resolvedJid,
            peerName: m.pushName || '',
            direction: 'in',
            mediaType: 'text',
            body,
            waMsgId: m.key.id || '',
            isRead: 0
          });
        }
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        waState.status = 'qr';
        try {
          waState.qrDataUrl = await QRCode.toDataURL(qr, { width: 260, margin: 1 });
        } catch {
          waState.qrDataUrl = '';
        }
      }
      if (connection === 'open') {
        waState.status = 'connected';
        waState.qrDataUrl = '';
        waState.lastError = '';
        const rawId = sock.user && sock.user.id ? String(sock.user.id) : '';
        waState.phoneNumber = rawId.split(':')[0] || rawId.split('@')[0] || '';
        processQueue();
      } else if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        const badSession = statusCode === DisconnectReason.badSession;

        destroyCurrentSocket();
        waState.qrDataUrl = '';

        if (loggedOut || badSession) {
          waState.status = 'disconnected';
          waState.phoneNumber = '';
          waState.lastError = 'Sesión cerrada o expirada. Vuelve a escanear el QR.';
          await wipeAllAuthState();
        } else {
          waState.status = 'disconnected';
          waState.lastError = 'Reconectando sesión de WhatsApp...';
          reconnectTimer = setTimeout(async () => {
            reconnectTimer = null;
            if (await hasSavedAuthCreds()) {
              connectWhatsApp().catch(() => {});
            }
          }, 3000);
        }
      }
    });
  } catch (err) {
    destroyCurrentSocket();
    waState.status = 'disconnected';
    waState.lastError = err.message || 'Error al iniciar WhatsApp';
  } finally {
    isConnectingLock = false;
  }

  return getWhatsAppStatus();
}

async function disconnectWhatsApp() {
  try {
    if (waState.sock) {
      await waState.sock.logout().catch(() => {});
    }
  } catch {}
  destroyCurrentSocket();
  await wipeAllAuthState();
  waState.status = 'disconnected';
  waState.qrDataUrl = '';
  waState.phoneNumber = '';
  waState.lastError = '';
  return getWhatsAppStatus();
}

function lookupSavedJidForPeer(peerDigits) {
  return new Promise((resolve) => {
    db.get(
      `SELECT peer_jid FROM wa_messages WHERE peer_phone = ? AND peer_jid != '' ORDER BY id DESC LIMIT 1`,
      [peerDigits],
      (err, row) => resolve((row && row.peer_jid) || '')
    );
  });
}

async function resolveTargetJid(sock, rawTarget, hintJid = '') {
  const rawStr = String(rawTarget || '').trim();
  if (rawStr.endsWith('@lid')) {
    const lidDigits = rawStr.split('@')[0].split(':')[0].replace(/\D/g, '');
    const mapped = lidToPhoneMap.get(lidDigits);
    if (mapped) return { phone: mapped, jid: `${mapped}@s.whatsapp.net` };
    return { phone: lidDigits, jid: rawStr };
  }

  const digits = rawStr.split('@')[0].split(':')[0].replace(/\D/g, '');
  if (!digits) throw new Error('Número o contacto de WhatsApp inválido');

  if (lidToPhoneMap.has(digits)) {
    const mapped = lidToPhoneMap.get(digits);
    return { phone: mapped, jid: `${mapped}@s.whatsapp.net` };
  }

  const normalized = normalizePeruPhone(digits) || digits;

  if (verifiedJidCache.has(normalized)) {
    return { phone: normalized, jid: verifiedJidCache.get(normalized) };
  }

  const savedJid = hintJid || await lookupSavedJidForPeer(normalized);
  if (savedJid && savedJid.endsWith('@lid') && normalized.length > 11) {
    return { phone: normalized, jid: savedJid };
  }

  let targetJid = `${normalized}@s.whatsapp.net`;
  try {
    const [exists] = await sock.onWhatsApp(normalized);
    if (exists && exists.exists && exists.jid) {
      targetJid = exists.jid;
      verifiedJidCache.set(normalized, targetJid);
    } else if (savedJid && savedJid.endsWith('@lid')) {
      targetJid = savedJid;
    }
  } catch {}

  return { phone: normalized, jid: targetJid };
}

async function resetPeerSignalSession(rawPeer) {
  const digits = String(rawPeer || '').replace(/\D/g, '');
  if (!digits) return { removed: 0 };
  const normalized = normalizePeruPhone(digits) || digits;
  const short9 = normalized.length === 11 && normalized.startsWith('51') ? normalized.slice(2) : normalized;
  const myPhone = waState.phoneNumber ? String(waState.phoneNumber).replace(/\D/g, '') : '';

  // Limpiar sesiones Signal del contacto Y las sesiones DSM de dispositivos propios si estaban desincronizadas
  const res1 = await sqlRun(
    `DELETE FROM wa_auth_state WHERE (k LIKE 'session-%' OR k LIKE 'device-list-%') AND (k LIKE ? OR k LIKE ?${myPhone ? ` OR k LIKE ?` : ''})`,
    myPhone
      ? [`%${normalized}%`, `%${short9}%`, `%${myPhone}%`]
      : [`%${normalized}%`, `%${short9}%`]
  ).catch(() => ({ changes: 0 }));

  for (const key of Array.from(signalMemoryStore.keys())) {
    if ((key.startsWith('session-') || key.startsWith('device-list-')) &&
        (key.includes(normalized) || key.includes(short9) || (myPhone && key.includes(myPhone)))) {
      signalMemoryStore.delete(key);
    }
  }
  verifiedJidCache.delete(normalized);

  return { ok: true, removed: res1.changes || 0 };
}

async function sendWhatsAppNow(phone, text, options = {}) {
  return withSendLock(async () => {
    if (waState.status !== 'connected' || !waState.sock) {
      throw new Error('WhatsApp no está conectado');
    }
    const sock = waState.sock;
    const cleanText = String(text);
    const { phone: cleanPhone, jid: targetJid } = await resolveTargetJid(sock, phone, options.peerJid || '');

    const sent = await sock.sendMessage(targetJid, { text: cleanText });
    const msgId = (sent && sent.key && sent.key.id) || '';
    if (msgId) {
      cacheCleanOutgoingMessage(msgId, { conversation: cleanText });
    }
    saveWaChatMessage({
      peerPhone: cleanPhone,
      peerJid: targetJid,
      direction: 'out',
      category: options.category || '',
      mediaType: 'text',
      body: cleanText,
      waMsgId: msgId,
      isRead: 1
    });
    return { ok: true, to: cleanPhone };
  });
}

async function sendWhatsAppSticker(phone, stickerFileName, options = {}) {
  return withSendLock(async () => {
    if (waState.status !== 'connected' || !waState.sock) {
      throw new Error('WhatsApp no está conectado');
    }
    const safeFile = path.basename(String(stickerFileName || ''));
    const fullPath = path.join(waStickersDir, safeFile);
    if (!safeFile || !fs.existsSync(fullPath)) {
      throw new Error('Archivo de sticker no encontrado');
    }
    const buf = fs.readFileSync(fullPath);
    const sock = waState.sock;
    const { phone: cleanPhone, jid: targetJid } = await resolveTargetJid(sock, phone, options.peerJid || '');

    const sent = await sock.sendMessage(targetJid, { sticker: buf });
    const msgId = (sent && sent.key && sent.key.id) || '';
    if (msgId && sent?.message?.stickerMessage) {
      cacheCleanOutgoingMessage(msgId, { stickerMessage: sent.message.stickerMessage });
    }
    saveWaChatMessage({
      peerPhone: cleanPhone,
      peerJid: targetJid,
      direction: 'out',
      category: options.category || '',
      mediaType: 'sticker',
      mediaFile: safeFile,
      body: '[Sticker]',
      waMsgId: msgId,
      isRead: 1
    });
    return { ok: true, to: cleanPhone, file_name: safeFile };
  });
}

function enqueueWhatsAppMessage(phone, text, category = '') {
  const normalized = normalizePeruPhone(phone);
  if (!normalized || waState.status !== 'connected') return false;
  messageQueue.push({ phone: normalized, text, category });
  processQueue();
  return true;
}

async function processQueue() {
  if (processingQueue || waState.status !== 'connected' || !waState.sock) return;
  processingQueue = true;
  while (messageQueue.length > 0 && waState.status === 'connected' && waState.sock) {
    const item = messageQueue.shift();
    try {
      await sendWhatsAppNow(item.phone, item.text, { category: item.category || '' });
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 3500));
  }
  processingQueue = false;
}

async function initWhatsAppIfLinked() {
  if (await hasSavedAuthCreds()) {
    connectWhatsApp().catch(() => {});
  }
}

module.exports = {
  getWhatsAppStatus,
  connectWhatsApp,
  disconnectWhatsApp,
  sendWhatsAppNow,
  sendWhatsAppSticker,
  resetPeerSignalSession,
  enqueueWhatsAppMessage,
  initWhatsAppIfLinked,
  normalizePeruPhone
};
