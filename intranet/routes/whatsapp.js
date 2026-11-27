const express = require('express');
const { authMiddleware, adminOnly, staffOnly } = require('../lib/auth');
const {
  getWhatsAppStatus,
  connectWhatsApp,
  disconnectWhatsApp,
  sendWhatsAppNow
} = require('../lib/whatsapp');
const { runParentWhatsAppReminders } = require('../lib/notifications');

const router = express.Router();

router.get('/intranet/api/whatsapp/linked', authMiddleware, staffOnly, (req, res) => {
  const st = getWhatsAppStatus();
  res.json({ connected: st.status === 'connected', phoneNumber: st.phoneNumber || '', status: st.status });
});

router.post('/intranet/api/whatsapp/send', authMiddleware, staffOnly, async (req, res) => {
  try {
    const st = getWhatsAppStatus();
    if (st.status !== 'connected') {
      return res.status(400).json({ error: 'La instancia de WhatsApp no está conectada', notConnected: true });
    }
    const { phone, message } = req.body;
    if (!phone || !message || !String(message).trim()) {
      return res.status(400).json({ error: 'Número y mensaje son obligatorios' });
    }
    const result = await sendWhatsAppNow(phone, String(message).trim());
    res.json({ ...result, from: st.phoneNumber || '' });
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo enviar por la instancia vinculada' });
  }
});

router.get('/intranet/api/admin/whatsapp/status', authMiddleware, adminOnly, (req, res) => {
  res.json(getWhatsAppStatus());
});

router.post('/intranet/api/admin/whatsapp/connect', authMiddleware, adminOnly, async (req, res) => {
  const st = await connectWhatsApp();
  res.json(st);
});

router.post('/intranet/api/admin/whatsapp/disconnect', authMiddleware, adminOnly, async (req, res) => {
  const st = await disconnectWhatsApp();
  res.json(st);
});

router.post('/intranet/api/admin/whatsapp/send-reminders', authMiddleware, adminOnly, (req, res) => {
  runParentWhatsAppReminders(true, (result) => {
    if (!result.ok) {
      return res.status(400).json({ error: result.reason || 'No se pudo enviar' });
    }
    res.json(result);
  });
});

router.post('/intranet/api/admin/whatsapp/test', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone) return res.status(400).json({ error: 'Ingresa un número de WhatsApp' });
    const text = (message || '').trim() || '✅ Prueba de recordatorios DC CORP Intranet funcionando correctamente.';
    const result = await sendWhatsAppNow(phone, text);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo enviar el mensaje' });
  }
});

module.exports = router;
