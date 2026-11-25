const express = require('express');
const { db } = require('../lib/db');
const { authMiddleware } = require('../lib/auth');

const router = express.Router();

router.get('/intranet/api/notifications', authMiddleware, (req, res) => {
  db.all(
    `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 30`,
    [req.user.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Error cargando notificaciones' });
      const items = rows || [];
      const unreadCount = items.filter(n => !n.is_read).length;
      res.json({ notifications: items, unread_count: unreadCount });
    }
  );
});

router.post('/intranet/api/notifications/read', authMiddleware, (req, res) => {
  const { id } = req.body || {};
  if (id) {
    db.run(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`, [Number(id), req.user.id], () => {
      res.json({ ok: true });
    });
  } else {
    db.run(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`, [req.user.id], () => {
      res.json({ ok: true });
    });
  }
});

module.exports = router;
