const express = require("express");
const { db, verifyGroupAccess } = require("../lib/db");
const { authMiddleware, staffOnly } = require("../lib/auth");
const { getWhatsAppStatus, enqueueWhatsAppMessage } = require("../lib/whatsapp");

const router = express.Router();

function formatNowLima() {
  try {
    return new Date().toLocaleTimeString('es-PE', {
      timeZone: 'America/Lima',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return new Date().toTimeString().slice(0, 5);
  }
}

function sendSolMusicAttendanceWhatsApp({ studentId, groupId, date, timeStr, mode }, cb) {
  db.get(
    `SELECT u.full_name, u.whatsapp, g.name AS group_name, g.category
     FROM users u, groups g
     WHERE u.id = ? AND g.id = ?`,
    [studentId, groupId],
    (err, row) => {
      if (err || !row || row.category !== 'Sol Music' || !String(row.whatsapp || '').trim()) {
        if (cb) cb({ queued: false, reason: !row?.whatsapp ? 'Sin número de apoderado' : 'No aplica' });
        return;
      }
      const wa = getWhatsAppStatus();
      if (wa.status !== 'connected') {
        if (cb) cb({ queued: false, reason: 'WhatsApp no conectado' });
        return;
      }

      const msg = mode === 'exit'
        ? `🎵 *SOL MUSIC · Aviso de Salida*\n\nEstimado padre/madre de familia, le informamos que *${row.full_name}* ha *finalizado su clase y salido* de *${row.group_name}*.\n• Fecha: ${date}\n• Hora de salida: *${timeStr}*\n\n¡Gracias por su confianza! — *Sol Music*`
        : `🎵 *SOL MUSIC · Aviso de Ingreso*\n\nEstimado padre/madre de familia, le informamos que *${row.full_name}* acaba de *ingresar a su clase* en *${row.group_name}*.\n• Fecha: ${date}\n• Hora de llegada: *${timeStr}*\n\n— *Sol Music*`;

      const queued = enqueueWhatsAppMessage(row.whatsapp, msg, 'tareas');
      if (cb) cb({ queued, to: row.whatsapp });
    }
  );
}

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
          `SELECT id, student_id, date, status, note, session_type, arrival_time, departure_time, recorded_by_name
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
  const { student_id, group_id, date, status, session_type, arrival_time, note, notify_arrival } = req.body;
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

    const isEntranceStatus = ['Presente', 'Tardanza', 'Reforzamiento'].includes(status);
    const shouldNotifyArrival = notify_arrival !== false && isEntranceStatus;
    const finalArrival = (shouldNotifyArrival && !arrival_time) ? formatNowLima() : (arrival_time || '');

    db.run(
      `INSERT INTO attendance (student_id, group_id, date, status, note, session_type, arrival_time, recorded_by_id, recorded_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(student_id, date, session_type) DO UPDATE SET
         status = excluded.status,
         note = excluded.note,
         group_id = excluded.group_id,
         arrival_time = CASE WHEN excluded.arrival_time != '' THEN excluded.arrival_time ELSE attendance.arrival_time END,
         recorded_by_id = excluded.recorded_by_id,
         recorded_by_name = excluded.recorded_by_name`,
      [
        student_id,
        group_id,
        date,
        status,
        note || '',
        sType,
        finalArrival,
        req.user.id,
        req.user.full_name
      ],
      function (err) {
        if (err) return res.status(500).json({ error: 'Error guardando asistencia' });
        if (shouldNotifyArrival) {
          sendSolMusicAttendanceWhatsApp(
            { studentId: student_id, groupId: group_id, date, timeStr: finalArrival, mode: 'arrival' },
            (waRes) => res.json({ ok: true, recorded_by_name: req.user.full_name, arrival_time: finalArrival, wa: waRes })
          );
          return;
        }
        res.json({ ok: true, recorded_by_name: req.user.full_name });
      }
    );
  });
});

router.post('/intranet/api/admin/attendance/notify-exit', authMiddleware, staffOnly, (req, res) => {
  const { student_id, group_id, date, session_type } = req.body;
  if (!student_id || !group_id || !date) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }
  const sType = ['Regular', 'Recuperacion', 'Reforzamiento'].includes(session_type) ? session_type : 'Regular';
  const exitTime = formatNowLima();

  verifyGroupAccess(req.user, group_id, (allowed) => {
    if (!allowed) return res.status(403).json({ error: 'No tienes permiso sobre este grupo' });

    db.run(
      `INSERT INTO attendance (student_id, group_id, date, status, note, session_type, departure_time, recorded_by_id, recorded_by_name)
       VALUES (?, ?, ?, 'Presente', '', ?, ?, ?, ?)
       ON CONFLICT(student_id, date, session_type) DO UPDATE SET
         departure_time = excluded.departure_time,
         recorded_by_id = excluded.recorded_by_id,
         recorded_by_name = excluded.recorded_by_name`,
      [student_id, group_id, date, sType, exitTime, req.user.id, req.user.full_name],
      (err) => {
        if (err) return res.status(500).json({ error: 'Error registrando salida' });
        sendSolMusicAttendanceWhatsApp(
          { studentId: student_id, groupId: group_id, date, timeStr: exitTime, mode: 'exit' },
          (waRes) => res.json({ ok: true, departure_time: exitTime, wa: waRes })
        );
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
