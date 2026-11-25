const express = require("express");
const { db, verifyGroupAccess } = require("../lib/db");
const { authMiddleware, staffOnly } = require("../lib/auth");

const router = express.Router();

// ================= ASISTENCIA SEMANAL GRÁFICA (SOPORTE MÚLTIPLES SUBGRUPOS) =================
router.get('/intranet/api/admin/weekly-attendance', authMiddleware, staffOnly, (req, res) => {
  const { group_id, start_date, end_date } = req.query;
  if (!group_id || !start_date || !end_date) {
    return res.status(400).json({ error: 'Falta grupo o rango de semana' });
  }
  const monthPrefix = start_date.slice(0, 7);

  verifyGroupAccess(req.user, group_id, (allowed) => {
    if (!allowed) return res.status(403).json({ error: 'No tienes permiso sobre este grupo' });

    db.all(
      `SELECT DISTINCT u.id AS student_id, u.code, u.full_name, u.schedule, u.monthly_quota, u.avatar_file, u.instrument,
              (SELECT COUNT(*) FROM attendance a2
               WHERE a2.student_id = u.id
                 AND a2.session_type IN ('Regular', 'Recuperacion')
                 AND substr(a2.date, 1, 7) = ?
                 AND a2.status IN ('Presente', 'Tardanza', 'Justificado')) AS used_this_month,
              (SELECT COUNT(*) FROM attendance a3
               WHERE a3.student_id = u.id
                 AND a3.session_type = 'Reforzamiento'
                 AND substr(a3.date, 1, 7) = ?) AS ref_this_month
       FROM users u
       LEFT JOIN student_groups sg ON sg.student_id = u.id
       WHERE u.role = 'student' AND (sg.group_id = ? OR u.group_id = ?)
       ORDER BY u.full_name ASC`,
      [monthPrefix, monthPrefix, group_id, group_id],
      (err, students) => {
        if (!students || !students.length) return res.json({ students: [], records: [] });

        db.all(
          `SELECT id, student_id, date, status, note, session_type, arrival_time, recorded_by_name
           FROM attendance
           WHERE group_id = ? AND date >= ? AND date <= ?`,
          [group_id, start_date, end_date],
          (err2, records) => {
            res.json({ students, records: records || [] });
          }
        );
      }
    );
  });
});

router.post('/intranet/api/admin/attendance/cell', authMiddleware, staffOnly, (req, res) => {
  const { student_id, group_id, date, status, session_type, arrival_time, note } = req.body;
  if (!student_id || !group_id || !date) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }
  const sType = ['Regular', 'Recuperacion', 'Reforzamiento'].includes(session_type) ? session_type : 'Regular';

  verifyGroupAccess(req.user, group_id, (allowed) => {
    if (!allowed) return res.status(403).json({ error: 'No tienes permiso sobre este grupo' });

    if (!status || status === 'Clear') {
      db.run(
        `DELETE FROM attendance WHERE student_id = ? AND date = ? AND session_type = ?`,
        [student_id, date, sType],
        (err) => {
          if (err) return res.status(500).json({ error: 'Error limpiando registro' });
          res.json({ ok: true, deleted: true });
        }
      );
      return;
    }

    db.run(
      `INSERT INTO attendance (student_id, group_id, date, status, note, session_type, arrival_time, recorded_by_id, recorded_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(student_id, date, session_type) DO UPDATE SET
         status = excluded.status,
         note = excluded.note,
         group_id = excluded.group_id,
         arrival_time = excluded.arrival_time,
         recorded_by_id = excluded.recorded_by_id,
         recorded_by_name = excluded.recorded_by_name`,
      [
        student_id,
        group_id,
        date,
        status,
        note || '',
        sType,
        arrival_time || '',
        req.user.id,
        req.user.full_name
      ],
      function (err) {
        if (err) return res.status(500).json({ error: 'Error guardando asistencia' });
        res.json({ ok: true, recorded_by_name: req.user.full_name });
      }
    );
  });
});

// ================= RESUMEN DIARIO PARA EXPORTAR EN IMAGEN =================
router.get('/intranet/api/admin/daily-summary', authMiddleware, staffOnly, (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'Falta la fecha' });

  const monthPrefix = date.slice(0, 7);

  if (req.user.role === 'admin') {
    db.all(
      `SELECT a.id, a.student_id, a.group_id, a.date, a.status, a.note, a.session_type, a.arrival_time, a.recorded_by_name,
              u.full_name AS student_name, u.code AS student_code, u.schedule, u.monthly_quota,
              g.name AS group_name, g.category,
              (SELECT COUNT(*) FROM attendance a2
               WHERE a2.student_id = u.id
                 AND a2.session_type IN ('Regular', 'Recuperacion')
                 AND substr(a2.date, 1, 7) = ?
                 AND a2.status IN ('Presente', 'Tardanza', 'Justificado')) AS used_this_month
       FROM attendance a
       INNER JOIN users u ON a.student_id = u.id
       LEFT JOIN groups g ON a.group_id = g.id
       WHERE a.date = ?
       ORDER BY g.category ASC, g.name ASC, u.full_name ASC`,
      [monthPrefix, date],
      (err, rows) => res.json({ date, records: rows || [] })
    );
  } else {
    db.all(
      `SELECT a.id, a.student_id, a.group_id, a.date, a.status, a.note, a.session_type, a.arrival_time, a.recorded_by_name,
              u.full_name AS student_name, u.code AS student_code, u.schedule, u.monthly_quota,
              g.name AS group_name, g.category,
              (SELECT COUNT(*) FROM attendance a2
               WHERE a2.student_id = u.id
                 AND a2.session_type IN ('Regular', 'Recuperacion')
                 AND substr(a2.date, 1, 7) = ?
                 AND a2.status IN ('Presente', 'Tardanza', 'Justificado')) AS used_this_month
       FROM attendance a
       INNER JOIN users u ON a.student_id = u.id
       INNER JOIN groups g ON a.group_id = g.id
       WHERE a.date = ? AND g.category = 'Sol Music'
       ORDER BY g.name ASC, u.full_name ASC`,
      [monthPrefix, date],
      (err, rows) => res.json({ date, records: rows || [] })
    );
  }
});


module.exports = router;
