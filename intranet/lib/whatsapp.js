const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { dataDir, waStickersDir } = require('./config');
const { db } = require('./db');
const { broadcastToRole } = require('./sse');

const waAuthDir = path.join(dataDir, 'wa-auth');
const sentCacheFile = path.join(dataDir, 'wa-sent-cache.json');
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

const sentMessagesCache = new Map();
const lidToPhoneMap = new Map();
const retryCounterStore = new Map();

const msgRetryCounterCache = {
  get: (key) => retryCounterStore.get(key),
  set: (key, val) => {
    retryCounterStore.set(key, val);
    if (retryCounterStore.size > 1000) {
      retryCounterStore.delete(retryCounterStore.keys().next().value);
    }
  },
  del: (key) => retryCounterStore.delete(key),
  flushAll: () => retryCounterStore.clear()
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

function saveJsonMap(filePath, sourceMap, maxEntries = 400) {
  try {
    const entries = Array.from(sourceMap.entries()).slice(-maxEntries);
    fs.writeFileSync(filePath, JSON.stringify(entries), 'utf8');
  } catch {}
}

loadJsonMap(sentCacheFile, sentMessagesCache);
loadJsonMap(lidMapFile, lidToPhoneMap);

function recordLidMapping(lidRaw, pnRaw) {
  const lid = String(lidRaw || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  const pn = normalizePeruPhone(String(pnRaw || '').split('@')[0].split(':')[0]);
  if (lid && pn && lid !== pn) {
    if (lidToPhoneMap.get(lid) !== pn) {
      lidToPhoneMap.set(lid, pn);
      saveJsonMap(lidMapFile, lidToPhoneMap, 1000);
      // Migrar mensajes previos que hubieran quedado con el LID crudo al teléfono real
      db.run(
        `UPDATE wa_messages SET peer_phone = ?, peer_jid = ? WHERE peer_phone = ?`,
        [pn, `${pn}@s.whatsapp.net`, lid],
        () => {}
      );
    }
  }
}

function cacheSentMessage(msgObj) {
  if (!msgObj || !msgObj.key || !msgObj.key.id || !msgObj.message) return;
  sentMessagesCache.set(msgObj.key.id, msgObj.message);
  while (sentMessagesCache.size > 350) {
    const firstKey = sentMessagesCache.keys().next().value;
    sentMessagesCache.delete(firstKey);
  }
  saveJsonMap(sentCacheFile, sentMessagesCache, 250);
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
    db.get(`SELECT body FROM wa_messages WHERE wa_msg_id = ? ORDER BY id DESC LIMIT 1`, [String(waId)], (err, row) => {
      if (err || !row || !row.body) return resolve(undefined);
      resolve({ conversation: row.body });
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

  const { baileys, QRCode } = libs;
  const makeWASocket = baileys.default || baileys.makeWASocket;
  const {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers
  } = baileys;

  if (!fs.existsSync(waAuthDir)) fs.mkdirSync(waAuthDir, { recursive: true });
  waState.status = 'connecting';
  waState.lastError = '';
  waState.qrDataUrl = '';

  try {
    const { state, saveCreds } = await useMultiFileAuthState(waAuthDir);
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
        ? makeCacheableSignalKeyStore(state.keys, silentLogger)
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
      patchMessageBeforeSending: (message) => {
        const requiresPatch = Boolean(
          message.buttonsMessage ||
          message.templateMessage ||
          message.listMessage
        );
        if (requiresPatch) {
          return {
            viewOnceMessage: {
              message: {
                messageContextInfo: {
                  deviceListMetadataVersion: 2,
                  deviceListMetadata: {}
                },
                ...message
              }
            }
          };
        }
        return message;
      },
      getMessage: async (key) => {
        if (key && key.id) {
          if (sentMessagesCache.has(key.id)) {
            return sentMessagesCache.get(key.id);
          }
          return await lookupDbMessageByWaId(key.id);
        }
        return undefined;
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
          cacheSentMessage(m);
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
          fs.rmSync(waAuthDir, { recursive: true, force: true });
        } else {
          waState.status = 'disconnected';
          waState.lastError = 'Reconectando sesión de WhatsApp...';
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (fs.existsSync(path.join(waAuthDir, 'creds.json'))) {
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
  if (fs.existsSync(waAuthDir)) {
    fs.rmSync(waAuthDir, { recursive: true, force: true });
  }
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

  // Verificar si en BD este identificador era un @lid sin número telefónico revelado
  const savedJid = hintJid || await lookupSavedJidForPeer(normalized);
  if (savedJid && savedJid.endsWith('@lid') && normalized.length > 11) {
    return { phone: normalized, jid: savedJid };
  }

  let targetJid = `${normalized}@s.whatsapp.net`;
  try {
    const [exists] = await sock.onWhatsApp(normalized);
    if (exists && exists.exists && exists.jid) {
      targetJid = exists.jid;
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

  let removed = 0;
  if (fs.existsSync(waAuthDir)) {
    const files = fs.readdirSync(waAuthDir);
    for (const f of files) {
      if (f.startsWith('session-') && (f.includes(normalized) || (short9.length >= 9 && f.includes(short9)))) {
        try {
          fs.unlinkSync(path.join(waAuthDir, f));
          removed++;
        } catch {}
      }
    }
  }

  // Reiniciar el socket en caliente para limpiar también el caché en memoria de Signal sin perder el QR
  if (waState.status === 'connected' && fs.existsSync(path.join(waAuthDir, 'creds.json'))) {
    destroyCurrentSocket();
    waState.status = 'disconnected';
    await connectWhatsApp();
  }

  return { ok: true, removed };
}

async function sendWhatsAppNow(phone, text, options = {}) {
  if (waState.status !== 'connected' || !waState.sock) {
    throw new Error('WhatsApp no está conectado');
  }
  const sock = waState.sock;
  const { phone: cleanPhone, jid: targetJid } = await resolveTargetJid(sock, phone, options.peerJid || '');

  const sent = await sock.sendMessage(targetJid, { text: String(text) });
  cacheSentMessage(sent);
  saveWaChatMessage({
    peerPhone: cleanPhone,
    peerJid: targetJid,
    direction: 'out',
    category: options.category || '',
    mediaType: 'text',
    body: String(text),
    waMsgId: (sent && sent.key && sent.key.id) || '',
    isRead: 1
  });
  return { ok: true, to: cleanPhone };
}

async function sendWhatsAppSticker(phone, stickerFileName, options = {}) {
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
  cacheSentMessage(sent);
  saveWaChatMessage({
    peerPhone: cleanPhone,
    peerJid: targetJid,
    direction: 'out',
    category: options.category || '',
    mediaType: 'sticker',
    mediaFile: safeFile,
    body: '[Sticker]',
    waMsgId: (sent && sent.key && sent.key.id) || '',
    isRead: 1
  });
  return { ok: true, to: cleanPhone, file_name: safeFile };
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

function initWhatsAppIfLinked() {
  if (fs.existsSync(path.join(waAuthDir, 'creds.json'))) {
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
