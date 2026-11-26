const { db } = require('./db');
const { broadcastToUser } = require('./sse');
const { getWhatsAppStatus, enqueueWhatsAppMessage } = require('./whatsapp');

function createNotification({ userId, type = 'info', title, message, linkHash = '', referenceId = null }, cb) {
  if (!userId || !title || !message) {
    if (cb) cb();
    return;
  }
  db.run(
    `INSERT INTO notifications (user_id, type, title, message, link_hash, reference_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [Number(userId), type, title, message, linkHash, referenceId],
    function (err) {
      if (!err) {
        const notif = {
          id: this.lastID,
          user_id: Number(userId),
          type,
          title,
          message,
          link_hash: linkHash,
          reference_id: referenceId,
          is_read: 0,
          created_at: new Date().toISOString()
        };
        broadcastToUser(userId, { type: 'notification', notification: notif });
      }
      if (cb) cb(err);
    }
  );
}

function notifyAnnouncement({ title, message, targetCategory, senderName, senderRole }) {
  const cleanMsg = String(message || '').trim().slice(0, 140);
  const notifTitle = `Aviso: ${title}`;
  const notifBody = `${senderName}: ${cleanMsg}`;

  if (targetCategory === 'Solo Profesores' || targetCategory === 'Profesores y Alumnos') {
    db.all(`SELECT id FROM users WHERE role = 'teacher'`, [], (err, teachers) => {
      (teachers || []).forEach(t => {
        createNotification({
          userId: t.id,
          type: 'announcement',
          title: notifTitle,
          message: notifBody,
          linkHash: '#avisos'
        });
      });
    });
  }

  if (targetCategory === 'Solo Profesores') return;

  // Notificar a estudiantes según modalidad
  let sql = `SELECT DISTINCT u.id FROM users u
             LEFT JOIN student_groups sg ON sg.student_id = u.id
             LEFT JOIN groups g ON g.id = COALESCE(sg.group_id, u.group_id)
             WHERE u.role = 'student'`;
  const params = [];

  if (targetCategory === 'Sol Music' || targetCategory === 'Particulares') {
    sql += ` AND g.category = ?`;
    params.push(targetCategory);
  }

  db.all(sql, params, (err, students) => {
    (students || []).forEach(s => {
      createNotification({
        userId: s.id,
        type: 'announcement',
        title: notifTitle,
        message: notifBody,
        linkHash: '#materiales'
      });
    });
  });
}

function notifyNewMaterial({ groupId, materialId, title, targetGrade, evaluationEnabled }) {
  db.get(`SELECT name, category FROM groups WHERE id = ?`, [groupId], (err, grp) => {
    if (err || !grp) return;
    db.all(
      `SELECT DISTINCT u.id, u.grade FROM users u
       LEFT JOIN student_groups sg ON sg.student_id = u.id
       WHERE u.role = 'student' AND (sg.group_id = ? OR u.group_id = ?)`,
      [groupId, groupId],
      (err2, students) => {
        (students || []).forEach(s => {
          if (grp.category === 'Particulares' && targetGrade && targetGrade !== 'Todos') {
            const stuGrade = (s.grade || '').trim();
            if (stuGrade && stuGrade !== targetGrade) return;
          }
          createNotification({
            userId: s.id,
            type: 'new_task',
            title: evaluationEnabled ? `Nueva tarea: ${title}` : `Nuevo material: ${title}`,
            message: `Publicado en ${grp.name}${evaluationEnabled ? ' • Recuerda subir tu entrega.' : ''}`,
            linkHash: `#materiales/tema/${materialId}`,
            referenceId: materialId
          });
        });
      }
    );
  });
}

function notifySubmission({ materialId, studentId, studentName }) {
  db.get(
    `SELECT m.id, m.title, m.group_id, g.name AS group_name, g.category
     FROM materials m LEFT JOIN groups g ON g.id = m.group_id WHERE m.id = ?`,
    [materialId],
    (err, mat) => {
      if (err || !mat) return;
      const roleFilter = mat.category === 'Sol Music' ? `role IN ('admin', 'teacher')` : `role = 'admin'`;
      db.all(`SELECT id FROM users WHERE ${roleFilter}`, [], (err2, staffRows) => {
        (staffRows || []).forEach(staff => {
          createNotification({
            userId: staff.id,
            type: 'submission',
            title: `Entrega recibida: ${studentName}`,
            message: `Subió su tarea en "${mat.title}" (${mat.group_name || 'Aula'})`,
            linkHash: `#materiales/aula/${mat.group_id}`,
            referenceId: mat.id
          });
        });
      });
    }
  );
}

function notifyGrade({ submissionId, gradeScore }) {
  db.get(
    `SELECT s.student_id, s.material_id, m.title
     FROM submissions s INNER JOIN materials m ON m.id = s.material_id
     WHERE s.id = ?`,
    [submissionId],
    (err, row) => {
      if (err || !row) return;
      createNotification({
        userId: row.student_id,
        type: 'grade',
        title: `Tarea calificada: ${gradeScore}/20`,
        message: `Tu entrega en "${row.title}" ya tiene calificación.`,
        linkHash: `#materiales/tema/${row.material_id}`,
        referenceId: row.material_id
      });
    }
  );
}

function runPendingTaskReminders() {
  db.all(
    `SELECT m.id AS material_id, m.title, m.group_id, m.target_grade, g.name AS group_name, g.category
     FROM materials m
     INNER JOIN groups g ON g.id = m.group_id
     WHERE m.evaluation_enabled = 1
       AND m.created_at >= datetime('now', '-30 days')
       AND m.created_at <= datetime('now', '-12 hours')`,
    [],
    (err, mats) => {
      if (err || !mats || !mats.length) return;
      mats.forEach(m => {
        db.all(
          `SELECT DISTINCT u.id, u.grade
           FROM users u
           LEFT JOIN student_groups sg ON sg.student_id = u.id
           WHERE u.role = 'student'
             AND (sg.group_id = ? OR u.group_id = ?)
             AND NOT EXISTS (
               SELECT 1 FROM submissions s WHERE s.material_id = ? AND s.student_id = u.id
             )
             AND NOT EXISTS (
               SELECT 1 FROM notifications n
               WHERE n.user_id = u.id
                 AND n.type = 'task_reminder'
                 AND n.reference_id = ?
                 AND n.created_at >= datetime('now', '-12 hours')
             )`,
          [m.group_id, m.group_id, m.material_id, m.material_id],
          (err2, pendingStudents) => {
            if (err2 || !pendingStudents) return;
            pendingStudents.forEach(s => {
              if (m.category === 'Particulares' && m.target_grade && m.target_grade !== 'Todos') {
                const stuGrade = (s.grade || '').trim();
                if (stuGrade && stuGrade !== m.target_grade) return;
              }
              createNotification({
                userId: s.id,
                type: 'task_reminder',
                title: `Recordatorio de tarea: ${m.title}`,
                message: `Aún tienes pendiente entregar esta actividad en ${m.group_name}.`,
                linkHash: `#materiales/tema/${m.material_id}`,
                referenceId: m.material_id
              });
            });
          }
        );
      });
    }
  );
}

function runParentWhatsAppReminders(manualTrigger = false, cb) {
  const wa = getWhatsAppStatus();
  if (wa.status !== 'connected') {
    if (cb) cb({ ok: false, reason: 'WhatsApp no conectado', queued: 0 });
    return;
  }

  const ageClause = manualTrigger ? '' : `AND m.created_at <= datetime('now', '-12 hours')`;
  const cooldown = manualTrigger ? '-2 hours' : '-24 hours';

  db.all(
    `SELECT m.id AS material_id, m.title, m.group_id, m.target_grade, g.name AS group_name
     FROM materials m
     INNER JOIN groups g ON g.id = m.group_id
     WHERE m.evaluation_enabled = 1
       AND g.category = 'Particulares'
       AND m.created_at >= datetime('now', '-30 days')
       ${ageClause}`,
    [],
    (err, mats) => {
      if (err || !mats || !mats.length) {
        if (cb) cb({ ok: true, queued: 0 });
        return;
      }

      let queued = 0;
      let pendingQueries = mats.length;

      mats.forEach(m => {
        db.all(
          `SELECT DISTINCT u.id, u.full_name, u.grade, u.whatsapp
           FROM users u
           LEFT JOIN student_groups sg ON sg.student_id = u.id
           WHERE u.role = 'student'
             AND TRIM(COALESCE(u.whatsapp, '')) != ''
             AND (sg.group_id = ? OR u.group_id = ?)
             AND NOT EXISTS (
               SELECT 1 FROM submissions s WHERE s.material_id = ? AND s.student_id = u.id
             )
             AND NOT EXISTS (
               SELECT 1 FROM notifications n
               WHERE n.user_id = u.id
                 AND n.type = 'wa_parent_reminder'
                 AND n.reference_id = ?
                 AND n.created_at >= datetime('now', '${cooldown}')
             )`,
          [m.group_id, m.group_id, m.material_id, m.material_id],
          (err2, students) => {
            if (!err2 && students && students.length) {
              students.forEach(s => {
                if (m.target_grade && m.target_grade !== 'Todos') {
                  const stuGrade = (s.grade || '').trim();
                  if (stuGrade && stuGrade !== m.target_grade) return;
                }
                const text =
                  `📚 *DC CORP · Recordatorio de Tarea*\n\n` +
                  `Estimado padre/madre de familia, le recordamos que *${s.full_name}* aún tiene pendiente subir su entrega de:\n` +
                  `• *${m.title}* (${m.group_name})\n\n` +
                  `Por favor, subir la foto o archivo ingresando a la intranet. ¡Muchas gracias!`;

                if (enqueueWhatsAppMessage(s.whatsapp, text)) {
                  queued++;
                  db.run(
                    `INSERT INTO notifications (user_id, type, title, message, link_hash, reference_id, is_read)
                     VALUES (?, 'wa_parent_reminder', ?, ?, ?, ?, 1)`,
                    [s.id, `WhatsApp enviado (${m.title})`, `Recordatorio enviado a ${s.whatsapp}`, `#materiales/tema/${m.material_id}`, m.material_id]
                  );
                }
              });
            }
            pendingQueries--;
            if (pendingQueries === 0 && cb) cb({ ok: true, queued });
          }
        );
      });
    }
  );
}

let reminderTimerStarted = false;
function startReminderScheduler() {
  if (reminderTimerStarted) return;
  reminderTimerStarted = true;
  setTimeout(() => {
    runPendingTaskReminders();
    runParentWhatsAppReminders(false);
  }, 10000);
  setInterval(() => {
    runPendingTaskReminders();
    runParentWhatsAppReminders(false);
  }, 30 * 60 * 1000);
}

module.exports = {
  createNotification,
  notifyAnnouncement,
  notifyNewMaterial,
  notifySubmission,
  notifyGrade,
  runPendingTaskReminders,
  runParentWhatsAppReminders,
  startReminderScheduler
};
