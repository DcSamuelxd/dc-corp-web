const express = require("express");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const { JWT_SECRET, dataDir, uploadsDir, avatarsDir, upload, uploadAvatar } = require("../lib/config");
const { db, verifyGroupAccess, attachFilesToMaterials, attachFilesToSubmissions } = require("../lib/db");
const { authMiddleware, adminOnly, staffOnly } = require("../lib/auth");
const { broadcastChatEvent } = require("../lib/sse");
const { notifyAnnouncement, notifyNewMaterial, notifySubmission, notifyGrade } = require("../lib/notifications");

const router = express.Router();

router.get('/intranet/api/admin/materials', authMiddleware, staffOnly, (req, res) => {
  const sql = req.user.role === 'admin'
    ? `SELECT m.*, g.name AS group_name, g.category, g.schedule AS group_schedule
       FROM materials m LEFT JOIN groups g ON m.group_id = g.id
       ORDER BY m.created_at DESC`
    : `SELECT m.*, g.name AS group_name, g.category, g.schedule AS group_schedule
       FROM materials m INNER JOIN groups g ON m.group_id = g.id
       WHERE g.category = 'Sol Music' ORDER BY m.created_at DESC`;

  db.all(sql, [], (err, rows) => {
    attachFilesToMaterials(rows || [], (enriched) => {
      if (!enriched.length) return res.json([]);
      const ids = enriched.map(m => m.id);
      const placeholders = ids.map(() => '?').join(',');
      db.all(
        `SELECT mn.*, u.full_name AS student_name
         FROM material_notes mn
         LEFT JOIN users u ON mn.student_id = u.id
         WHERE mn.material_id IN (${placeholders}) AND mn.note_type = 'consulta'
         ORDER BY mn.created_at ASC`,
        ids,
        (err2, notes) => {
          const byMat = {};
          (notes || []).forEach(n => {
            if (!byMat[n.material_id]) byMat[n.material_id] = [];
            byMat[n.material_id].push(n);
          });
          db.all(
            `SELECT sb.*, u.full_name AS student_name, u.grade AS student_grade
             FROM submissions sb
             LEFT JOIN users u ON sb.student_id = u.id
             WHERE sb.material_id IN (${placeholders})
             ORDER BY sb.submitted_at DESC`,
            ids,
            (err3, allSubs) => {
              attachFilesToSubmissions(allSubs || [], (enrichedSubs) => {
                const subsByMat = {};
                enrichedSubs.forEach(s => {
                  if (!subsByMat[s.material_id]) subsByMat[s.material_id] = [];
                  subsByMat[s.material_id].push(s);
                });
                res.json(enriched.map(m => ({
                  ...m,
                  consultas: byMat[m.id] || [],
                  submissions: subsByMat[m.id] || []
                })));
              });
            }
          );
        }
      );
    });
  });
});

router.post('/intranet/api/admin/materials/:id/reply', authMiddleware, staffOnly, (req, res) => {
  const { student_id, content } = req.body;
  if (!student_id || !content || !content.trim()) {
    return res.status(400).json({ error: 'Escribe una respuesta' });
  }
  const matId = Number(req.params.id);
  const stuId = Number(student_id);

  db.get(`SELECT group_id FROM materials WHERE id = ?`, [matId], (err, mat) => {
    if (!mat) return res.status(404).json({ error: 'Material no encontrado' });
    verifyGroupAccess(req.user, mat.group_id, (allowed) => {
      if (!allowed) return res.status(403).json({ error: 'Sin permiso sobre este grupo' });
      db.run(
        `INSERT INTO material_notes (material_id, student_id, sender_role, sender_name, note_type, content)
         VALUES (?, ?, ?, ?, 'consulta', ?)`,
        [matId, stuId, req.user.role, req.user.full_name, content.trim()],
        function (err2) {
          if (err2) return res.status(500).json({ error: 'Error guardando respuesta' });
          const newMsg = {
            id: this.lastID,
            material_id: matId,
            student_id: stuId,
            sender_role: req.user.role,
            sender_name: req.user.full_name,
            note_type: 'consulta',
            content: content.trim(),
            created_at: new Date().toISOString()
          };
          broadcastChatEvent({ type: 'chat_message', message: newMsg });
          res.json(newMsg);
        }
      );
    });
  });
});

router.post('/intranet/api/admin/materials', authMiddleware, staffOnly, upload.array('files', 30), (req, res) => {
  const { group_id, group_ids, title, description, external_url, labels, publish_format, evaluation_enabled, target_grade } = req.body;

  let targetGroupIds = [];
  if (group_ids) {
    try {
      const parsed = typeof group_ids === 'string' ? JSON.parse(group_ids) : group_ids;
      if (Array.isArray(parsed)) targetGroupIds = parsed.map(Number).filter(n => Number.isInteger(n) && n > 0);
    } catch {
      targetGroupIds = [];
    }
  }
  if (!targetGroupIds.length && group_id) {
    const singleId = Number(group_id);
    if (Number.isInteger(singleId) && singleId > 0) targetGroupIds = [singleId];
  }
  targetGroupIds = [...new Set(targetGroupIds)];

  if (!targetGroupIds.length || !title || !title.trim()) {
    return res.status(400).json({ error: 'Selecciona al menos un subgrupo y escribe el título' });
  }

  let checkIdx = 0;
  function verifyNextGroup() {
    if (checkIdx >= targetGroupIds.length) {
      return insertMaterialsForGroups();
    }
    const gid = targetGroupIds[checkIdx++];
    verifyGroupAccess(req.user, gid, (allowed) => {
      if (!allowed) return res.status(403).json({ error: 'Solo puedes publicar en subgrupos de Sol Music' });
      verifyNextGroup();
    });
  }

  function insertMaterialsForGroups() {
    let parsedLabels = [];
    try {
      parsedLabels = labels ? JSON.parse(labels) : [];
    } catch {
      parsedLabels = [];
    }

    const fmt = publish_format === 'classroom' ? 'classroom' : 'music';
    const evalFlag = (evaluation_enabled === '1' || evaluation_enabled === 1 || evaluation_enabled === true) ? 1 : 0;
    const tGrade = (target_grade && target_grade !== 'Todos') ? String(target_grade).trim() : '';
    const uploadedFiles = req.files || [];
    const createdIds = [];
    let insertIdx = 0;

    function insertNext() {
      if (insertIdx >= targetGroupIds.length) {
        return res.json({ id: createdIds[0], ids: createdIds });
      }
      const gid = targetGroupIds[insertIdx++];
      db.run(
        `INSERT INTO materials (group_id, title, description, external_url, publish_format, evaluation_enabled, target_grade) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [gid, title.trim(), description || '', (external_url || '').trim(), fmt, evalFlag, tGrade],
        function (err) {
          if (err) return res.status(500).json({ error: 'Error al guardar el material' });
          const materialId = this.lastID;
          createdIds.push(materialId);

          if (!uploadedFiles.length) {
            notifyNewMaterial({ groupId: gid, materialId, title: title.trim(), targetGrade: tGrade, evaluationEnabled: evalFlag });
            return insertNext();
          }

          const stmt = db.prepare(
            `INSERT INTO material_files (material_id, label, file_name, original_name, file_type) VALUES (?, ?, ?, ?, ?)`
          );
          uploadedFiles.forEach((f, idx) => {
            const ext = path.extname(f.originalname || '').toLowerCase();
            const fType = ext === '.pdf'
              ? 'pdf'
              : (['.mp3', '.wav', '.ogg', '.m4a', '.aac'].includes(ext) ? 'audio' : 'other');
            const lbl = (parsedLabels[idx] && parsedLabels[idx].trim()) ? parsedLabels[idx].trim() : 'General';
            stmt.run(materialId, lbl, f.filename, f.originalname, fType);
          });
          stmt.finalize(() => {
            notifyNewMaterial({ groupId: gid, materialId, title: title.trim(), targetGrade: tGrade, evaluationEnabled: evalFlag });
            insertNext();
          });
        }
      );
    }

    insertNext();
  }

  verifyNextGroup();
});

router.put('/intranet/api/admin/materials/:id', authMiddleware, staffOnly, upload.array('files', 30), (req, res) => {
  const materialId = req.params.id;
  const { title, description, external_url, deleted_file_ids, updated_files_meta, labels, publish_format, evaluation_enabled, target_grade } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'El título es obligatorio' });
  }

  db.get(`SELECT id, group_id FROM materials WHERE id = ?`, [materialId], (err, mat) => {
    if (err || !mat) return res.status(404).json({ error: 'Material no encontrado' });

    verifyGroupAccess(req.user, mat.group_id, (allowed) => {
      if (!allowed) return res.status(403).json({ error: 'Sin permiso sobre este material' });

      const fmt = publish_format === 'classroom' ? 'classroom' : 'music';
      const evalFlag = (evaluation_enabled === '1' || evaluation_enabled === 1 || evaluation_enabled === true) ? 1 : 0;
      const tGrade = (target_grade && target_grade !== 'Todos') ? String(target_grade).trim() : '';

      db.run(
        `UPDATE materials SET title = ?, description = ?, external_url = ?, publish_format = ?, evaluation_enabled = ?, target_grade = ? WHERE id = ?`,
        [title.trim(), (description || '').trim(), (external_url || '').trim(), fmt, evalFlag, tGrade, materialId],
        (errUp) => {
          if (errUp) return res.status(500).json({ error: 'Error actualizando el material' });

          let delIds = [];
          try { delIds = deleted_file_ids ? JSON.parse(deleted_file_ids) : []; } catch { delIds = []; }

          let updMeta = [];
          try { updMeta = updated_files_meta ? JSON.parse(updated_files_meta) : []; } catch { updMeta = []; }

          let newLabels = [];
          try { newLabels = labels ? JSON.parse(labels) : []; } catch { newLabels = []; }

          const processUpdatesAndUploads = () => {
            if (Array.isArray(updMeta) && updMeta.length) {
              const uStmt = db.prepare(`UPDATE material_files SET label = ? WHERE id = ? AND material_id = ?`);
              updMeta.forEach(item => {
                if (item && item.id && item.label) {
                  uStmt.run(item.label.trim(), item.id, materialId);
                }
              });
              uStmt.finalize();
            }

            const uploadedFiles = req.files || [];
            if (uploadedFiles.length) {
              const iStmt = db.prepare(
                `INSERT INTO material_files (material_id, label, file_name, original_name, file_type) VALUES (?, ?, ?, ?, ?)`
              );
              uploadedFiles.forEach((f, idx) => {
                const ext = path.extname(f.originalname || '').toLowerCase();
                const fType = ext === '.pdf'
                  ? 'pdf'
                  : (['.mp3', '.wav', '.ogg', '.m4a', '.aac'].includes(ext) ? 'audio' : 'other');
                const lbl = (newLabels[idx] && newLabels[idx].trim()) ? newLabels[idx].trim() : 'General';
                iStmt.run(materialId, lbl, f.filename, f.originalname, fType);
              });
              iStmt.finalize(() => res.json({ ok: true }));
            } else {
              res.json({ ok: true });
            }
          };

          if (Array.isArray(delIds) && delIds.length) {
            const placeholders = delIds.map(() => '?').join(',');
            db.all(
              `SELECT id, file_name FROM material_files WHERE material_id = ? AND id IN (${placeholders})`,
              [materialId, ...delIds],
              (errF, rowsToDel) => {
                (rowsToDel || []).forEach(rf => {
                  const fullP = path.join(uploadsDir, rf.file_name);
                  if (fs.existsSync(fullP)) fs.unlinkSync(fullP);
                });
                db.run(
                  `DELETE FROM material_files WHERE material_id = ? AND id IN (${placeholders})`,
                  [materialId, ...delIds],
                  () => processUpdatesAndUploads()
                );
              }
            );
          } else {
            processUpdatesAndUploads();
          }
        }
      );
    });
  });
});

router.delete('/intranet/api/admin/materials/:id', authMiddleware, staffOnly, (req, res) => {
  db.get(`SELECT group_id, file_name FROM materials WHERE id = ?`, [req.params.id], (err, row) => {
    if (!row) return res.status(404).json({ error: 'Material no encontrado' });
    verifyGroupAccess(req.user, row.group_id, (allowed) => {
      if (!allowed) return res.status(403).json({ error: 'Sin permiso para eliminar este material' });

      db.all(`SELECT file_name FROM material_files WHERE material_id = ?`, [req.params.id], (err2, mFiles) => {
        (mFiles || []).forEach(mf => {
          const fPath = path.join(uploadsDir, mf.file_name);
          if (fs.existsSync(fPath)) fs.unlinkSync(fPath);
        });
        if (row.file_name) {
          const oldPath = path.join(uploadsDir, row.file_name);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
        db.run(`DELETE FROM material_files WHERE material_id = ?`, [req.params.id], () => {
          db.run(`DELETE FROM material_notes WHERE material_id = ?`, [req.params.id], () => {
            db.run(`DELETE FROM materials WHERE id = ?`, [req.params.id], () => res.json({ ok: true }));
          });
        });
      });
    });
  });
});

// ================= TABLÓN DE AVISOS Y EVENTOS =================
router.get('/intranet/api/admin/announcements', authMiddleware, staffOnly, (req, res) => {
  if (req.user.role === 'admin') {
    db.all(`SELECT * FROM announcements ORDER BY created_at DESC`, [], (err, rows) => res.json(rows || []));
  } else {
    db.all(
      `SELECT * FROM announcements WHERE target_category IN ('Todos', 'Sol Music', 'Solo Profesores', 'Profesores y Alumnos') ORDER BY created_at DESC`,
      [],
      (err, rows) => res.json(rows || [])
    );
  }
});

router.post('/intranet/api/admin/announcements', authMiddleware, staffOnly, (req, res) => {
  const { title, message, target_category, event_date } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'Título y mensaje del aviso son obligatorios' });

  const allowedAdminTargets = ['Todos', 'Particulares', 'Sol Music', 'Solo Profesores', 'Profesores y Alumnos'];
  const target = req.user.role === 'admin'
    ? (allowedAdminTargets.includes(target_category) ? target_category : 'Todos')
    : 'Sol Music';

  db.run(
    `INSERT INTO announcements (title, message, target_category, event_date, created_by_name)
     VALUES (?, ?, ?, ?, ?)`,
    [title.trim(), message.trim(), target, (event_date || '').trim(), req.user.full_name],
    function (err) {
      if (err) return res.status(500).json({ error: 'Error publicando anuncio' });
      notifyAnnouncement({
        title: title.trim(),
        message: message.trim(),
        targetCategory: target,
        senderName: req.user.full_name,
        senderRole: req.user.role
      });
      res.json({ id: this.lastID });
    }
  );
});

router.delete('/intranet/api/admin/announcements/:id', authMiddleware, staffOnly, (req, res) => {
  if (req.user.role === 'admin') {
    db.run(`DELETE FROM announcements WHERE id = ?`, [req.params.id], () => res.json({ ok: true }));
  } else {
    db.run(`DELETE FROM announcements WHERE id = ? AND target_category = 'Sol Music'`, [req.params.id], () => res.json({ ok: true }));
  }
});

// ================= COPIA DE SEGURIDAD SQLITE (SOLO ADMIN) =================
router.get('/intranet/api/admin/backup', authMiddleware, adminOnly, (req, res) => {
  const dbPath = path.join(dataDir, 'intranet.db');
  if (!fs.existsSync(dbPath)) return res.status(404).json({ error: 'Base de datos no encontrada' });
  const stamp = new Date().toISOString().slice(0, 10);
  res.download(dbPath, `intranet_dccorp_backup_${stamp}.db`);
});



router.post('/intranet/api/student/materials/:id/submission', authMiddleware, upload.array('resolutions', 8), (req, res) => {
  const matId = Number(req.params.id);
  const uploaded = req.files || [];
  if (!uploaded.length) return res.status(400).json({ error: 'Adjunta al menos un archivo o imagen (máximo 8)' });
  if (uploaded.length > 8) return res.status(400).json({ error: 'Máximo 8 archivos por entrega' });

  const firstFile = uploaded[0];

  db.get(`SELECT id, file_name FROM submissions WHERE material_id = ? AND student_id = ?`, [matId, req.user.id], (err, existing) => {
    const saveFilesForSubmission = (subId) => {
      if (existing && existing.file_name) {
        const oldMain = path.join(uploadsDir, existing.file_name);
        if (fs.existsSync(oldMain)) fs.unlinkSync(oldMain);
      }
      db.all(`SELECT file_name FROM submission_files WHERE submission_id = ?`, [subId], (eOld, oldList) => {
        (oldList || []).forEach(of => {
          const p = path.join(uploadsDir, of.file_name);
          if (fs.existsSync(p)) fs.unlinkSync(p);
        });
        db.run(`DELETE FROM submission_files WHERE submission_id = ?`, [subId], () => {
          const stmt = db.prepare(`INSERT INTO submission_files (submission_id, file_name, original_name, file_type) VALUES (?, ?, ?, ?)`);
          const filesPayload = uploaded.map((f, idx) => {
            const ext = path.extname(f.originalname || '').toLowerCase();
            const fType = ext === '.pdf' ? 'pdf' : 'image';
            stmt.run(subId, f.filename, f.originalname, fType);
            return { id: idx + 1, submission_id: subId, file_name: f.filename, original_name: f.originalname, file_type: fType };
          });
          stmt.finalize(() => {
            notifySubmission({ materialId: matId, studentId: req.user.id, studentName: req.user.full_name });
            res.json({
              ok: true,
              submission: {
                id: subId,
                material_id: matId,
                student_id: req.user.id,
                file_name: firstFile.filename,
                original_name: firstFile.originalname,
                files: filesPayload,
                grade_score: null,
                feedback: '',
                submitted_at: new Date().toISOString()
              }
            });
          });
        });
      });
    };

    db.run(
      `INSERT INTO submissions (material_id, student_id, file_name, original_name, grade_score, feedback, submitted_at)
       VALUES (?, ?, ?, ?, NULL, '', CURRENT_TIMESTAMP)
       ON CONFLICT(material_id, student_id) DO UPDATE SET
         file_name = excluded.file_name,
         original_name = excluded.original_name,
         submitted_at = CURRENT_TIMESTAMP`,
      [matId, req.user.id, firstFile.filename, firstFile.originalname],
      function (err2) {
        if (err2) return res.status(500).json({ error: 'Error guardando la resolución' });
        const targetSubId = existing ? existing.id : this.lastID;
        saveFilesForSubmission(targetSubId);
      }
    );
  });
});

router.post('/intranet/api/admin/submissions/:subId/grade', authMiddleware, staffOnly, (req, res) => {
  const subId = Number(req.params.subId);
  const { grade_score, feedback } = req.body;
  const numScore = parseFloat(grade_score);
  if (isNaN(numScore) || numScore < 0 || numScore > 20) {
    return res.status(400).json({ error: 'La nota debe estar entre 0 y 20' });
  }

  db.run(
    `UPDATE submissions SET grade_score = ?, feedback = ? WHERE id = ?`,
    [numScore, (feedback || '').trim(), subId],
    function (err) {
      if (err) return res.status(500).json({ error: 'Error guardando calificación' });
      notifyGrade({ submissionId: subId, gradeScore: numScore });
      res.json({ ok: true, grade_score: numScore, feedback: (feedback || '').trim() });
    }
  );
});

// ================= PORTAL DEL ESTUDIANTE (SOPORTE MÚLTIPLES SUBGRUPOS) =================
router.get('/intranet/api/student/dashboard', authMiddleware, (req, res) => {
  const requestedGroupId = req.query.group_id ? Number(req.query.group_id) : null;

  db.get(
    `SELECT u.id, u.code, u.full_name, u.group_id, u.schedule, u.monthly_quota, u.bio, u.avatar_file, u.instrument, u.grade,
            g.name AS group_name, g.category, g.description AS group_desc, g.schedule AS group_schedule
     FROM users u LEFT JOIN groups g ON u.group_id = g.id WHERE u.id = ?`,
    [req.user.id],
    (err, student) => {
      if (!student) return res.status(404).json({ error: 'Estudiante no encontrado' });

      db.all(
        `SELECT g.id, g.name, g.category, g.description, g.schedule
         FROM groups g
         INNER JOIN student_groups sg ON sg.group_id = g.id
         WHERE sg.student_id = ?
         ORDER BY g.name ASC`,
        [student.id],
        (errG, enrolledGroups) => {
          let myGroups = enrolledGroups || [];
          if (!myGroups.length && student.group_id) {
            myGroups = [{
              id: student.group_id,
              name: student.group_name || 'Grupo',
              category: student.category || 'Particulares',
              description: student.group_desc || '',
              schedule: student.group_schedule || student.schedule || ''
            }];
          }

          const activeGroup = (requestedGroupId && myGroups.some(g => Number(g.id) === requestedGroupId))
            ? myGroups.find(g => Number(g.id) === requestedGroupId)
            : (myGroups[0] || {
                id: student.group_id,
                name: student.group_name || 'Sin grupo',
                category: student.category || 'Particulares',
                description: student.group_desc || '',
                schedule: student.group_schedule || student.schedule || ''
              });

          const activeGroupId = activeGroup ? activeGroup.id : student.group_id;
          const activeStudentView = {
            ...student,
            active_group_id: activeGroupId,
            group_name: activeGroup ? activeGroup.name : student.group_name,
            category: activeGroup ? activeGroup.category : student.category,
            group_desc: activeGroup ? activeGroup.description : student.group_desc,
            group_schedule: activeGroup ? activeGroup.schedule : student.schedule
          };

          db.all(
            `SELECT date, status, note, session_type, arrival_time, recorded_by_name
             FROM attendance WHERE student_id = ? AND group_id = ? ORDER BY date DESC, id DESC`,
            [student.id, activeGroupId],
            (err2, attendances) => {
              db.all(
                `SELECT id, title, description, file_name, original_name, external_url, publish_format, evaluation_enabled, target_grade, created_at
                 FROM materials WHERE group_id = ? ORDER BY created_at DESC`,
                [activeGroupId],
                (err3, materials) => {
                  const stuCat = activeStudentView.category || 'Particulares';
                  const stuGrade = (student.grade || '').trim();
                  const visibleMaterials = (materials || []).filter(m => {
                    if (stuCat !== 'Particulares' || !stuGrade) return true;
                    const tg = (m.target_grade || '').trim();
                    return !tg || tg === 'Todos' || tg === stuGrade;
                  });
                  attachFilesToMaterials(visibleMaterials, (enrichedMats) => {
                    const finishPayload = (matsWithNotes) => {
                      db.all(
                        `SELECT * FROM announcements WHERE target_category IN ('Todos', 'Profesores y Alumnos', ?) ORDER BY created_at DESC LIMIT 5`,
                        [stuCat],
                        (err5, anns) => {
                          db.all(
                            `SELECT DISTINCT u.id, u.full_name, u.schedule, u.bio, u.avatar_file, u.instrument, u.grade
                             FROM users u
                             LEFT JOIN student_groups sg ON sg.student_id = u.id
                             WHERE u.role = 'student' AND (sg.group_id = ? OR u.group_id = ?)
                             ORDER BY u.full_name ASC`,
                            [activeGroupId, activeGroupId],
                            (err6, classmates) => {
                              const isSolStudent = myGroups.some(g => g.category === 'Sol Music');
                              const finishCommunityAndTeachers = (solCommunity) => {
                                db.all(
                                  `SELECT id, full_name, role, specialty, bio, avatar_file
                                   FROM users
                                   WHERE role = 'teacher' OR is_faculty = 1
                                   ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, full_name ASC`,
                                  [],
                                  (err7, teachers) => {
                                    res.json({
                                      student: activeStudentView,
                                      enrolledGroups: myGroups,
                                      classmates: classmates || [],
                                      solMusicCommunity: solCommunity || [],
                                      teachers: teachers || [],
                                      announcements: anns || [],
                                      attendances: attendances || [],
                                      materials: matsWithNotes
                                    });
                                  }
                                );
                              };

                              if (!isSolStudent) {
                                return finishCommunityAndTeachers([]);
                              }

                              db.all(
                                `SELECT DISTINCT u.id, u.full_name, u.schedule, u.bio, u.avatar_file, u.instrument, u.grade
                                 FROM users u
                                 LEFT JOIN student_groups sg ON sg.student_id = u.id
                                 INNER JOIN groups g ON g.id = COALESCE(sg.group_id, u.group_id)
                                 WHERE u.role = 'student' AND g.category = 'Sol Music'
                                 ORDER BY u.full_name ASC`,
                                [],
                                (errSol, solRows) => {
                                  finishCommunityAndTeachers(solRows || []);
                                }
                              );
                            }
                          );
                        }
                      );
                    };

                    if (!enrichedMats.length) return finishPayload([]);

                    const ids = enrichedMats.map(m => m.id);
                    const placeholders = ids.map(() => '?').join(',');
                    db.all(
                      `SELECT * FROM material_notes
                       WHERE material_id IN (${placeholders}) AND student_id = ?
                       ORDER BY created_at ASC`,
                      [...ids, student.id],
                      (err4, notes) => {
                        const byMat = {};
                        (notes || []).forEach(n => {
                          if (!byMat[n.material_id]) byMat[n.material_id] = [];
                          byMat[n.material_id].push(n);
                        });
                        db.all(
                          `SELECT * FROM submissions WHERE material_id IN (${placeholders}) AND student_id = ?`,
                          [...ids, student.id],
                          (errSub, subs) => {
                            attachFilesToSubmissions(subs || [], (enrichedSubs) => {
                              const subByMat = {};
                              enrichedSubs.forEach(sb => { subByMat[sb.material_id] = sb; });
                              finishPayload(enrichedMats.map(m => ({
                                ...m,
                                notes: byMat[m.id] || [],
                                submission: subByMat[m.id] || null
                              })));
                            });
                          }
                        );
                      }
                    );
                  });
                }
              );
            }
          );
        }
      );
    }
  );
});

router.post('/intranet/api/student/profile', authMiddleware, (req, res) => {
  const { bio } = req.body;
  db.run(`UPDATE users SET bio = ? WHERE id = ?`, [(bio || '').trim().slice(0, 400), req.user.id], (err) => {
    if (err) return res.status(500).json({ error: 'Error actualizando descripción' });
    res.json({ ok: true });
  });
});

router.post('/intranet/api/student/avatar', authMiddleware, uploadAvatar.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Selecciona una imagen válida (JPG, PNG, WEBP)' });

  db.get(`SELECT avatar_file FROM users WHERE id = ?`, [req.user.id], (err, row) => {
    if (row && row.avatar_file) {
      const oldPath = path.join(avatarsDir, row.avatar_file);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    db.run(`UPDATE users SET avatar_file = ? WHERE id = ?`, [req.file.filename, req.user.id], (err2) => {
      if (err2) return res.status(500).json({ error: 'Error guardando foto de perfil' });
      res.json({ ok: true, avatar_file: req.file.filename });
    });
  });
});

router.post('/intranet/api/student/materials/:id/notes', authMiddleware, (req, res) => {
  const { note_type, content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Escribe tu nota o consulta' });
  const nType = note_type === 'personal' ? 'personal' : 'consulta';
  const matId = Number(req.params.id);

  db.run(
    `INSERT INTO material_notes (material_id, student_id, sender_role, sender_name, note_type, content)
     VALUES (?, ?, 'student', ?, ?, ?)`,
    [matId, req.user.id, req.user.full_name, nType, content.trim()],
    function (err) {
      if (err) return res.status(500).json({ error: 'Error guardando mensaje' });
      const newMsg = {
        id: this.lastID,
        material_id: matId,
        student_id: req.user.id,
        student_name: req.user.full_name,
        sender_role: 'student',
        sender_name: req.user.full_name,
        note_type: nType,
        content: content.trim(),
        created_at: new Date().toISOString()
      };
      if (nType === 'consulta') {
        broadcastChatEvent({ type: 'chat_message', message: newMsg });
      }
      res.json(newMsg);
    }
  );
});

router.delete('/intranet/api/student/notes/:noteId', authMiddleware, (req, res) => {
  db.run(`DELETE FROM material_notes WHERE id = ? AND student_id = ?`, [req.params.noteId, req.user.id], () => {
    res.json({ ok: true });
  });
});

router.get('/intranet/api/avatars/:filename', (req, res) => {
  const safeFile = path.basename(req.params.filename);
  const fullPath = path.join(avatarsDir, safeFile);
  if (!fs.existsSync(fullPath)) return res.status(404).send('Imagen no encontrada');
  res.sendFile(fullPath);
});

router.get('/intranet/api/files/:filename', (req, res) => {
  const token = req.query.token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
  if (!token) return res.status(401).send('No autorizado');
  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).send('Sesión inválida');
  }
  const safeFile = path.basename(req.params.filename);
  const fullPath = path.join(uploadsDir, safeFile);
  if (!fs.existsSync(fullPath)) return res.status(404).send('Archivo no encontrado');
  res.sendFile(fullPath);
});


module.exports = router;
