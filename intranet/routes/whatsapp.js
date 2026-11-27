const express = require('express');
const { db } = require('../lib/db');
const { authMiddleware, adminOnly, staffOnly } = require('../lib/auth');
const {
  getWhatsAppStatus,
  connectWhatsApp,
  disconnectWhatsApp,
  sendWhatsAppNow,
  normalizePeruPhone
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

// --- CENTRO DE CHATS Y CONTACTOS WHATSAPP ---
router.get('/intranet/api/admin/whatsapp/chats', authMiddleware, adminOnly, (req, res) => {
  db.all(
    `SELECT m.peer_phone,
            MAX(NULLIF(m.peer_name, '')) AS wa_name,
            (SELECT body FROM wa_messages m2 WHERE m2.peer_phone = m.peer_phone ORDER BY m2.id DESC LIMIT 1) AS last_body,
            MAX(m.created_at) AS last_at,
            SUM(CASE WHEN m.direction = 'in' AND m.is_read = 0 THEN 1 ELSE 0 END) AS unread_count
     FROM wa_messages m
     GROUP BY m.peer_phone
     ORDER BY MAX(m.id) DESC
     LIMIT 100`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Error al cargar chats' });
      db.all(`SELECT full_name, whatsapp, role FROM users WHERE TRIM(COALESCE(whatsapp, '')) != ''`, [], (e2, uRows) => {
        db.all(`SELECT name, phone FROM ti_clients WHERE TRIM(COALESCE(phone, '')) != ''`, [], (e3, cRows) => {
          const nameMap = {};
          (uRows || []).forEach(u => {
            const p = normalizePeruPhone(u.whatsapp);
            if (p) nameMap[p] = `${u.full_name} (${u.role === 'teacher' ? 'Docente' : 'Alumno/Apoderado'})`;
          });
          (cRows || []).forEach(c => {
            const p = normalizePeruPhone(c.phone);
            if (p && !nameMap[p]) nameMap[p] = `${c.name} (Cliente TI)`;
          });
          const chats = (rows || []).map(r => ({
            ...r,
            display_name: nameMap[r.peer_phone] || r.wa_name || `+${r.peer_phone}`
          }));
          res.json(chats);
        });
      });
    }
  );
});

router.get('/intranet/api/admin/whatsapp/contacts', authMiddleware, adminOnly, (req, res) => {
  db.all(`SELECT id, full_name, role, whatsapp FROM users WHERE TRIM(COALESCE(whatsapp, '')) != '' ORDER BY full_name ASC`, [], (err, uRows) => {
    db.all(`SELECT id, name, contact_name, phone FROM ti_clients WHERE TRIM(COALESCE(phone, '')) != '' ORDER BY name ASC`, [], (err2, cRows) => {
      const contacts = [];
      const seen = new Set();
      (uRows || []).forEach(u => {
        const p = normalizePeruPhone(u.whatsapp);
        if (p && !seen.has(p)) {
          seen.add(p);
          contacts.push({ phone: p, name: u.full_name, tag: u.role === 'teacher' ? 'Docente' : 'Apoderado / Alumno' });
        }
      });
      (cRows || []).forEach(c => {
        const p = normalizePeruPhone(c.phone);
        if (p && !seen.has(p)) {
          seen.add(p);
          contacts.push({ phone: p, name: c.name, tag: 'Cliente TI' });
        }
      });
      res.json(contacts);
    });
  });
});

router.get('/intranet/api/admin/whatsapp/messages/:phone', authMiddleware, adminOnly, (req, res) => {
  const phone = normalizePeruPhone(req.params.phone) || String(req.params.phone || '').replace(/\D/g, '');
  if (!phone) return res.status(400).json({ error: 'Número inválido' });
  db.run(`UPDATE wa_messages SET is_read = 1 WHERE peer_phone = ? AND direction = 'in'`, [phone], () => {
    db.all(
      `SELECT id, peer_phone, peer_name, direction, body, is_read, created_at
       FROM wa_messages
       WHERE peer_phone = ?
       ORDER BY id ASC
       LIMIT 200`,
      [phone],
      (err, rows) => {
        if (err) return res.status(500).json({ error: 'Error cargando conversación' });
        res.json(rows || []);
      }
    );
  });
});

router.post('/intranet/api/admin/whatsapp/messages/:phone', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Escribe un mensaje' });
    }
    const result = await sendWhatsAppNow(req.params.phone, String(message).trim());
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo enviar el mensaje' });
  }
});

module.exports = router;
