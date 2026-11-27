const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, waStickersDir, uploadSticker } = require('../lib/config');
const { db } = require('../lib/db');
const { authMiddleware, adminOnly, staffOnly } = require('../lib/auth');
const {
  getWhatsAppStatus,
  connectWhatsApp,
  disconnectWhatsApp,
  sendWhatsAppNow,
  sendWhatsAppSticker,
  resetPeerSignalSession,
  normalizePeruPhone
} = require('../lib/whatsapp');
const { runParentWhatsAppReminders } = require('../lib/notifications');

const router = express.Router();

function cleanPeerParam(raw) {
  const s = String(raw || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  return normalizePeruPhone(s) || s;
}

// Resumen rápido en vivo para las 3 tarjetas del Hub Admin
router.get('/intranet/api/admin/hub-summary', authMiddleware, adminOnly, (req, res) => {
  const st = getWhatsAppStatus();
  db.get(
    `SELECT
       (SELECT COUNT(*) FROM users WHERE role = 'student') AS students_count,
       (SELECT COUNT(*) FROM submissions WHERE grade_score IS NULL) AS ungraded_count,
       (SELECT COUNT(*) FROM ti_orders) AS ti_orders_count,
       (SELECT COUNT(*) FROM ti_invoices) AS ti_invoices_count,
       (SELECT COUNT(*) FROM wa_messages WHERE direction = 'in' AND is_read = 0) AS wa_unread_count,
       (SELECT COUNT(DISTINCT peer_phone) FROM wa_messages) AS wa_chats_count`,
    [],
    (err, row) => {
      res.json({
        ...(row || {}),
        wa_status: st.status,
        wa_phone: st.phoneNumber || ''
      });
    }
  );
});

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
    const { phone, message, category } = req.body;
    if (!phone || !message || !String(message).trim()) {
      return res.status(400).json({ error: 'Número y mensaje son obligatorios' });
    }
    const result = await sendWhatsAppNow(phone, String(message).trim(), { category: category || '' });
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
    const result = await sendWhatsAppNow(phone, text, { category: 'libre' });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo enviar el mensaje' });
  }
});

// --- CENTRO DE CHATS, SEGMENTACIÓN Y BORRADO ---
router.get('/intranet/api/admin/whatsapp/chats', authMiddleware, adminOnly, (req, res) => {
  db.all(
    `SELECT m.peer_phone,
            MAX(NULLIF(m.peer_name, '')) AS wa_name,
            (SELECT peer_jid FROM wa_messages mj WHERE mj.peer_phone = m.peer_phone AND mj.peer_jid != '' ORDER BY mj.id DESC LIMIT 1) AS peer_jid,
            (SELECT category FROM wa_messages mc WHERE mc.peer_phone = m.peer_phone ORDER BY mc.id DESC LIMIT 1) AS last_category,
            (SELECT body FROM wa_messages m2 WHERE m2.peer_phone = m.peer_phone ORDER BY m2.id DESC LIMIT 1) AS last_body,
            (SELECT media_type FROM wa_messages m3 WHERE m3.peer_phone = m.peer_phone ORDER BY m3.id DESC LIMIT 1) AS last_media_type,
            MAX(m.created_at) AS last_at,
            SUM(CASE WHEN m.direction = 'in' AND m.is_read = 0 THEN 1 ELSE 0 END) AS unread_count
     FROM wa_messages m
     GROUP BY m.peer_phone
     ORDER BY MAX(m.id) DESC
     LIMIT 150`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Error al cargar chats' });
      db.all(`SELECT full_name, whatsapp, role FROM users WHERE TRIM(COALESCE(whatsapp, '')) != ''`, [], (e2, uRows) => {
        db.all(`SELECT name, phone FROM ti_clients WHERE TRIM(COALESCE(phone, '')) != ''`, [], (e3, cRows) => {
          const nameMap = {};
          const tiPhoneSet = new Set();
          (uRows || []).forEach(u => {
            const p = normalizePeruPhone(u.whatsapp);
            const roleLabel = u.role === 'admin' ? 'Dirección / Admin' : (u.role === 'teacher' ? 'Docente' : 'Apoderado');
            if (p) nameMap[p] = `${u.full_name} (${roleLabel})`;
          });
          (cRows || []).forEach(c => {
            const p = normalizePeruPhone(c.phone);
            if (p) {
              tiPhoneSet.add(p);
              if (!nameMap[p]) nameMap[p] = `${c.name} (Cliente TI)`;
            }
          });
          const chats = (rows || []).map(r => {
            let cat = r.last_category || 'libre';
            if (cat === 'libre' && tiPhoneSet.has(r.peer_phone)) cat = 'ti';
            return {
              ...r,
              category: cat,
              display_name: nameMap[r.peer_phone] || r.wa_name || `+${r.peer_phone}`
            };
          });
          res.json(chats);
        });
      });
    }
  );
});

router.delete('/intranet/api/admin/whatsapp/chats/:phone', authMiddleware, adminOnly, (req, res) => {
  const raw = String(req.params.phone || '').replace(/\D/g, '');
  const norm = cleanPeerParam(req.params.phone);
  if (!raw && !norm) return res.status(400).json({ error: 'Chat inválido' });
  db.run(
    `DELETE FROM wa_messages WHERE peer_phone = ? OR peer_phone = ?`,
    [norm, raw],
    function (err) {
      if (err) return res.status(500).json({ error: 'No se pudo borrar el chat' });
      res.json({ ok: true, deleted: this.changes });
    }
  );
});

router.patch('/intranet/api/admin/whatsapp/chats/:phone/category', authMiddleware, adminOnly, (req, res) => {
  const valid = ['tareas', 'libre', 'ti'];
  const cat = valid.includes(req.body.category) ? req.body.category : 'libre';
  const raw = String(req.params.phone || '').replace(/\D/g, '');
  const norm = cleanPeerParam(req.params.phone);
  db.run(
    `UPDATE wa_messages SET category = ? WHERE peer_phone = ? OR peer_phone = ?`,
    [cat, norm, raw],
    (err) => {
      if (err) return res.status(500).json({ error: 'No se pudo cambiar el segmento' });
      res.json({ ok: true, category: cat });
    }
  );
});

router.post('/intranet/api/admin/whatsapp/chats/:phone/repair', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await resetPeerSignalSession(req.params.phone);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo reparar la sesión Signal' });
  }
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
          const roleTag = u.role === 'admin' ? 'Dirección / Admin' : (u.role === 'teacher' ? 'Docente' : 'Apoderado / Alumno');
          contacts.push({
            phone: p,
            name: u.full_name,
            tag: roleTag,
            category: u.role === 'student' ? 'tareas' : 'libre'
          });
        }
      });
      (cRows || []).forEach(c => {
        const p = normalizePeruPhone(c.phone);
        if (p && !seen.has(p)) {
          seen.add(p);
          contacts.push({ phone: p, name: c.name, tag: 'Cliente TI', category: 'ti' });
        }
      });
      res.json(contacts);
    });
  });
});

router.get('/intranet/api/admin/whatsapp/messages/:phone', authMiddleware, adminOnly, (req, res) => {
  const raw = String(req.params.phone || '').replace(/\D/g, '');
  const phone = cleanPeerParam(req.params.phone);
  if (!phone && !raw) return res.status(400).json({ error: 'Número inválido' });
  db.run(`UPDATE wa_messages SET is_read = 1 WHERE (peer_phone = ? OR peer_phone = ?) AND direction = 'in'`, [phone, raw], () => {
    db.all(
      `SELECT id, peer_phone, peer_jid, peer_name, direction, category, media_type, media_file, body, is_read, created_at
       FROM wa_messages
       WHERE peer_phone = ? OR peer_phone = ?
       ORDER BY id ASC
       LIMIT 250`,
      [phone, raw],
      (err, rows) => {
        if (err) return res.status(500).json({ error: 'Error cargando conversación' });
        res.json(rows || []);
      }
    );
  });
});

router.post('/intranet/api/admin/whatsapp/messages/:phone', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { message, category, peer_jid } = req.body;
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Escribe un mensaje' });
    }
    const result = await sendWhatsAppNow(req.params.phone, String(message).trim(), {
      category: category || '',
      peerJid: peer_jid || ''
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo enviar el mensaje' });
  }
});

// --- STICKERS WHATSAPP (RECIBIR, SUBIR Y ENVIAR) ---
router.get('/intranet/api/admin/whatsapp/stickers', authMiddleware, adminOnly, (req, res) => {
  db.all(`SELECT id, file_name, label, created_at FROM wa_stickers ORDER BY id DESC LIMIT 80`, [], (err, rows) => {
    res.json(rows || []);
  });
});

router.post('/intranet/api/admin/whatsapp/stickers/upload', authMiddleware, adminOnly, uploadSticker.single('sticker'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Sube una imagen o archivo .webp' });
  try {
    const buf = fs.readFileSync(req.file.path);
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    db.get(`SELECT id, file_name FROM wa_stickers WHERE sha256 = ?`, [sha], (err, existing) => {
      if (existing) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.json(existing);
      }
      db.run(
        `INSERT INTO wa_stickers (file_name, sha256, label) VALUES (?, ?, ?)`,
        [req.file.filename, sha, (req.body.label || '').trim()],
        function (err2) {
          if (err2) return res.status(500).json({ error: 'Error guardando sticker' });
          res.json({ id: this.lastID, file_name: req.file.filename });
        }
      );
    });
  } catch {
    res.status(500).json({ error: 'Error procesando sticker' });
  }
});

router.delete('/intranet/api/admin/whatsapp/stickers/:id', authMiddleware, adminOnly, (req, res) => {
  db.get(`SELECT * FROM wa_stickers WHERE id = ?`, [req.params.id], (err, row) => {
    if (!row) return res.json({ ok: true });
    const full = path.join(waStickersDir, path.basename(row.file_name));
    if (fs.existsSync(full)) {
      try { fs.unlinkSync(full); } catch {}
    }
    db.run(`DELETE FROM wa_stickers WHERE id = ?`, [req.params.id], () => res.json({ ok: true }));
  });
});

router.post('/intranet/api/admin/whatsapp/messages/:phone/sticker', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { file_name, category, peer_jid } = req.body;
    if (!file_name) return res.status(400).json({ error: 'Selecciona un sticker' });
    const result = await sendWhatsAppSticker(req.params.phone, file_name, {
      category: category || '',
      peerJid: peer_jid || ''
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo enviar el sticker' });
  }
});

router.get('/intranet/api/admin/whatsapp/stickers/file/:filename', (req, res) => {
  const token = req.query.token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
  if (!token) return res.status(401).send('No autorizado');
  try {
    const user = jwt.verify(token, JWT_SECRET);
    if (user.role !== 'admin') return res.status(403).send('Prohibido');
  } catch {
    return res.status(401).send('Sesión inválida');
  }
  const safeFile = path.basename(req.params.filename);
  const fullPath = path.join(waStickersDir, safeFile);
  if (!fs.existsSync(fullPath)) return res.status(404).send('Sticker no encontrado');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=604800');
  res.sendFile(fullPath);
});

module.exports = router;
