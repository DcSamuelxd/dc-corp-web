const express = require('express');
const { db } = require('../lib/db');
const { authMiddleware, adminOnly } = require('../lib/auth');

const router = express.Router();

router.get('/intranet/api/admin/payments', authMiddleware, adminOnly, (req, res) => {
  const month = String(req.query.month || new Date().toISOString().slice(0, 7)).slice(0, 7);
  db.all(
    `SELECT u.id AS student_id, u.full_name, u.code, g.name AS group_name, g.category,
            COALESCE(sp.amount, 0) AS amount,
            COALESCE(sp.status, 'Pendiente') AS status,
            COALESCE(sp.note, '') AS note,
            sp.updated_at
     FROM users u
     LEFT JOIN groups g ON g.id = u.group_id
     LEFT JOIN student_payments sp ON sp.student_id = u.id AND sp.month_key = ?
     WHERE u.role = 'student'
     ORDER BY u.full_name ASC`,
    [month],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Error al consultar pagos' });
      const list = rows || [];
      const collected = list.filter(r => r.status === 'Pagado').reduce((acc, r) => acc + Number(r.amount || 0), 0);
      const paidCount = list.filter(r => r.status === 'Pagado').length;
      res.json({ month, collected, paidCount, totalStudents: list.length, payments: list });
    }
  );
});

router.post('/intranet/api/admin/payments', authMiddleware, adminOnly, (req, res) => {
  const { student_id, month_key, amount, status, note } = req.body;
  if (!student_id || !month_key) {
    return res.status(400).json({ error: 'Estudiante y mes son obligatorios' });
  }
  const cleanStatus = ['Pagado', 'Pendiente'].includes(status) ? status : 'Pagado';
  const numAmount = Math.max(0, Number(amount || 0));

  db.run(
    `INSERT INTO student_payments (student_id, month_key, amount, status, note, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(student_id, month_key) DO UPDATE SET
       amount = excluded.amount,
       status = excluded.status,
       note = excluded.note,
       updated_at = CURRENT_TIMESTAMP`,
    [Number(student_id), String(month_key).slice(0, 7), numAmount, cleanStatus, (note || '').trim()],
    (err) => {
      if (err) return res.status(500).json({ error: 'No se pudo guardar el pago' });
      res.json({ ok: true });
    }
  );
});

module.exports = router;
