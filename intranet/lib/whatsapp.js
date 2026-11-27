const path = require('path');
const fs = require('fs');
const { dataDir } = require('./config');

const waAuthDir = path.join(dataDir, 'wa-auth');

const waState = {
  sock: null,
  status: 'disconnected', // 'disconnected' | 'connecting' | 'qr' | 'connected' | 'missing_dependency'
  qrDataUrl: '',
  phoneNumber: '',
  lastError: ''
};

const messageQueue = [];
let processingQueue = false;
const sentMessagesCache = new Map();
const retryCounterStore = new Map();
const msgRetryCounterCache = {
  get: (key) => retryCounterStore.get(key),
  set: (key, val) => {
    retryCounterStore.set(key, val);
    if (retryCounterStore.size > 500) {
      retryCounterStore.delete(retryCounterStore.keys().next().value);
    }
  },
  del: (key) => retryCounterStore.delete(key),
  flushAll: () => retryCounterStore.clear()
};

function cacheSentMessage(msgObj) {
  if (!msgObj || !msgObj.key || !msgObj.key.id || !msgObj.message) return;
  sentMessagesCache.set(msgObj.key.id, msgObj.message);
  if (sentMessagesCache.size > 250) {
    const firstKey = sentMessagesCache.keys().next().value;
    sentMessagesCache.delete(firstKey);
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

  if (waState.status === 'connected' || waState.status === 'connecting') {
    return getWhatsAppStatus();
  }

  const { baileys, QRCode } = libs;
  const makeWASocket = baileys.default || baileys.makeWASocket;
  const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys;

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

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: silentLogger,
      browser: ['DC CORP Intranet', 'Chrome', '1.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: true,
      keepAliveIntervalMs: 25000,
      connectTimeoutMs: 30000,
      defaultQueryTimeoutMs: 30000,
      retryRequestDelayMs: 350,
      maxMsgRetryCount: 5,
      msgRetryCounterCache,
      getMessage: async (key) => {
        if (key && key.id && sentMessagesCache.has(key.id)) {
          return sentMessagesCache.get(key.id);
        }
        return undefined;
      }
    });

    waState.sock = sock;
    sock.ev.on('creds.update', saveCreds);

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
        waState.sock = null;
        waState.qrDataUrl = '';
        if (loggedOut) {
          waState.status = 'disconnected';
          waState.phoneNumber = '';
          waState.lastError = 'Sesión cerrada desde WhatsApp. Vuelve a escanear el QR.';
          fs.rmSync(waAuthDir, { recursive: true, force: true });
        } else {
          waState.status = 'disconnected';
          waState.lastError = 'Conexión cerrada. Reconectando automáticamente...';
          setTimeout(() => {
            if (fs.existsSync(waAuthDir)) connectWhatsApp().catch(() => {});
          }, 5000);
        }
      }
    });
  } catch (err) {
    waState.status = 'disconnected';
    waState.lastError = err.message || 'Error al iniciar WhatsApp';
  }

  return getWhatsAppStatus();
}

async function disconnectWhatsApp() {
  try {
    if (waState.sock) {
      await waState.sock.logout().catch(() => {});
      waState.sock = null;
    }
  } catch {}
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
  let targetJid = `${normalized}@s.whatsapp.net`;
  try {
    const [exists] = await waState.sock.onWhatsApp(normalized);
    if (exists && exists.exists && exists.jid) {
      targetJid = exists.jid;
    }
  } catch {}

  const sent = await waState.sock.sendMessage(targetJid, { text });
  cacheSentMessage(sent);
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
    // Pausa de 3.5 segundos entre envíos para evitar bloqueos por spam
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
  initWhatsAppIfLinked
};
