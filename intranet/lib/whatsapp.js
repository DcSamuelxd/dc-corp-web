const path = require('path');
const fs = require('fs');
const { dataDir } = require('./config');
const { db } = require('./db');
const { broadcastToRole } = require('./sse');

const waAuthDir = path.join(dataDir, 'wa-auth');
const sentCacheFile = path.join(dataDir, 'wa-sent-cache.json');

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

// Cargar caché persistente de mensajes enviados para responder a retry receipts tras reconexiones
function loadPersistentSentCache() {
  try {
    if (fs.existsSync(sentCacheFile)) {
      const raw = JSON.parse(fs.readFileSync(sentCacheFile, 'utf8'));
      if (Array.isArray(raw)) {
        raw.forEach(([k, v]) => {
          if (k && v) sentMessagesCache.set(k, v);
        });
      }
    }
  } catch {}
}

function savePersistentSentCache() {
  try {
    const entries = Array.from(sentMessagesCache.entries()).slice(-200);
    fs.writeFileSync(sentCacheFile, JSON.stringify(entries), 'utf8');
  } catch {}
}

loadPersistentSentCache();

function cacheSentMessage(msgObj) {
  if (!msgObj || !msgObj.key || !msgObj.key.id || !msgObj.message) return;
  sentMessagesCache.set(msgObj.key.id, msgObj.message);
  while (sentMessagesCache.size > 300) {
    const firstKey = sentMessagesCache.keys().next().value;
    sentMessagesCache.delete(firstKey);
  }
  savePersistentSentCache();
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
  } catch (err) {
    return null;
  }
}

function normalizePeruPhone(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 9 && digits.startsWith('9')) {
    return `51${digits}`;
  }
  if (digits.length >= 10) {
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
        if (key && key.id && sentMessagesCache.has(key.id)) {
          return sentMessagesCache.get(key.id);
        }
        return undefined;
      }
    });

    waState.sock = sock;
    sock.ev.on('creds.update', saveCreds);

function extractWaText(msg) {
  if (!msg || !msg.message) return '';
  const m = msg.message;
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage && m.extendedTextMessage.text) return m.extendedTextMessage.text;
  if (m.imageMessage) return m.imageMessage.caption ? `[Imagen] ${m.imageMessage.caption}` : '[Imagen]';
  if (m.videoMessage) return m.videoMessage.caption ? `[Video] ${m.videoMessage.caption}` : '[Video]';
  if (m.documentMessage) return `[Documento: ${m.documentMessage.fileName || 'archivo'}]`;
  if (m.audioMessage) return '[Audio]';
  if (m.stickerMessage) return '[Sticker]';
  return '';
}

function saveWaChatMessage({ peerPhone, peerName = '', direction = 'in', body = '', waMsgId = '', isRead = 0 }) {
  const phone = normalizePeruPhone(peerPhone) || String(peerPhone || '').replace(/\D/g, '');
  if (!phone || !body) return;
  db.run(
    `INSERT INTO wa_messages (peer_phone, peer_name, direction, body, wa_msg_id, is_read) VALUES (?, ?, ?, ?, ?, ?)`,
    [phone, String(peerName || '').trim(), direction, String(body), String(waMsgId || ''), isRead ? 1 : 0],
    function (err) {
      if (!err) {
        broadcastToRole('admin', {
          type: 'wa_message',
          message: {
            id: this.lastID,
            peer_phone: phone,
            peer_name: String(peerName || '').trim(),
            direction,
            body: String(body),
            is_read: isRead ? 1 : 0,
            created_at: new Date().toISOString()
          }
        });
      }
    }
  );
}

    // Pre-cachear salientes y guardar entrantes individuales en wa_messages
    sock.ev.on('messages.upsert', ({ messages }) => {
      if (!Array.isArray(messages)) return;
      for (const m of messages) {
        if (!m || !m.key) continue;
        if (m.key.fromMe) {
          cacheSentMessage(m);
          continue;
        }
        const jid = String(m.key.remoteJid || '');
        if (!jid || jid === 'status@broadcast' || jid.endsWith('@g.us')) continue;
        const phone = jid.split('@')[0].split(':')[0];
        const body = extractWaText(m);
        if (phone && body) {
          saveWaChatMessage({
            peerPhone: phone,
            peerName: m.pushName || '',
            direction: 'in',
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

async function sendWhatsAppNow(phone, text) {
  if (waState.status !== 'connected' || !waState.sock) {
    throw new Error('WhatsApp no está conectado');
  }
  const normalized = normalizePeruPhone(phone);
  if (!normalized) {
    throw new Error('Número de WhatsApp inválido');
  }

  const sock = waState.sock;
  let targetJid = `${normalized}@s.whatsapp.net`;
  try {
    const [exists] = await sock.onWhatsApp(normalized);
    if (exists && exists.exists && exists.jid) {
      targetJid = exists.jid;
    }
  } catch {}

  // Sincronizar llaves Signal de todos los dispositivos del destinatario tras periodos de inactividad
  try {
    if (typeof sock.assertSessions === 'function') {
      await sock.assertSessions([targetJid], false);
    }
  } catch {}

  const sent = await sock.sendMessage(targetJid, { text });
  cacheSentMessage(sent);
  saveWaChatMessage({
    peerPhone: normalized,
    direction: 'out',
    body: text,
    waMsgId: (sent && sent.key && sent.key.id) || '',
    isRead: 1
  });
  return { ok: true, to: normalized };
}

function enqueueWhatsAppMessage(phone, text) {
  const normalized = normalizePeruPhone(phone);
  if (!normalized || waState.status !== 'connected') return false;
  messageQueue.push({ phone: normalized, text });
  processQueue();
  return true;
}

async function processQueue() {
  if (processingQueue || waState.status !== 'connected' || !waState.sock) return;
  processingQueue = true;
  while (messageQueue.length > 0 && waState.status === 'connected' && waState.sock) {
    const item = messageQueue.shift();
    try {
      await sendWhatsAppNow(item.phone, item.text);
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
  enqueueWhatsAppMessage,
  initWhatsAppIfLinked,
  normalizePeruPhone
};
