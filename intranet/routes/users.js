const express = require("express");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const { avatarsDir, uploadAvatar } = require("../lib/config");
const { db, verifyGroupAccess, syncStudentGroups, attachGroupsToStudents } = require("../lib/db");
const { authMiddleware, adminOnly, staffOnly } = require("../lib/auth");

const router = express.Router();

// ================= GRUPOS Y SUBGRUPOS (CREAR, EDITAR, ELIMINAR Y CONTEO) =================
router.get('/intranet/api/admin/groups', authMiddleware, staffOnly, (req, res) => {
  const baseSql = req.user.role === 'admin'
    ? `SELECT g.*,
              (SELECT COUNT(DISTINCT sg.student_id) FROM student_groups sg
               INNER JOIN users u ON u.id = sg.student_id AND u.role = 'student'
               WHERE sg.group_id = g.id) AS student_count
       FROM groups g ORDER BY g.category ASC, g.name ASC`
    : `SELECT g.*,
              (SELECT COUNT(DISTINCT sg.student_id) FROM student_groups sg
               INNER JOIN users u ON u.id = sg.student_id AND u.role = 'student'
               WHERE sg.group_id = g.id) AS student_count
       FROM groups g WHERE g.category = 'Sol Music' ORDER BY g.name ASC`;

  db.all(baseSql, [], (err, rows) => res.json(rows || []));
});

router.post('/intranet/api/admin/groups', authMiddleware, staffOnly, (req, res) => {
  const { name, category, description, schedule } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre del grupo o subgrupo es obligatorio' });

  const cat = req.user.role === 'admin'
    ? (category === 'Sol Music' ? 'Sol Music' : 'Particulares')
    : 'Sol Music';

  db.run(
    `INSERT INTO groups (name, category, description, schedule, created_by) VALUES (?, ?, ?, ?, ?)`,
    [name.trim(), cat, (description || '').trim(), (schedule || '').trim(), req.user.id],
    function (err) {
      if (err) return res.status(400).json({ error: 'Ya existe un grupo o subgrupo con ese nombre' });
      res.json({ id: this.lastID, name: name.trim(), category: cat, description, schedule });
    }
  );
});

router.put('/intranet/api/admin/groups/:id', authMiddleware, staffOnly, (req, res) => {
  const groupId = req.params.id;
  const { name, category, description, schedule } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre del grupo es obligatorio' });

  verifyGroupAccess(req.user, groupId, (allowed) => {
    if (!allowed) return res.status(403).json({ error: 'No tienes permiso para editar este grupo' });

    const cat = req.user.role === 'admin'
      ? (category === 'Sol Music' ? 'Sol Music' : 'Particulares')
      : 'Sol Music';

    db.run(
      `UPDATE groups SET name = ?, category = ?, description = ?, schedule = ? WHERE id = ?`,
      [name.trim(), cat, (description || '').trim(), (schedule || '').trim(), groupId],
      function (err) {
        if (err) return res.status(400).json({ error: 'No se pudo actualizar (posible nombre duplicado)' });
        res.json({ ok: true });
      }
    );
  });
});

router.delete('/intranet/api/admin/groups/:id', authMiddleware, staffOnly, (req, res) => {
  verifyGroupAccess(req.user, req.params.id, (allowed) => {
    if (!allowed) return res.status(403).json({ error: 'No tienes permiso para eliminar este grupo' });
    db.run(`DELETE FROM groups WHERE id = ?`, [req.params.id], () => {
      db.run(`DELETE FROM student_groups WHERE group_id = ?`, [req.params.id], () => {
        db.run(`DELETE FROM teacher_groups WHERE group_id = ?`, [req.params.id], () => res.json({ ok: true }));
      });
    });
  });
});

// ================= PLANA DOCENTE INTERACTIVA + PERFIL DEL ADMIN COMO DOCENTE =================
router.get('/intranet/api/admin/teachers', authMiddleware, adminOnly, (req, res) => {
  db.all(
    `SELECT id, code, full_name, role, plain_hint, bio, avatar_file, whatsapp, specialty, is_faculty
     FROM users
     WHERE role = 'teacher' OR role = 'admin'
     ORDER BY role ASC, full_name ASC`,
    [],
    (err, teachers) => res.json(teachers || [])
  );
});

router.post('/intranet/api/admin/teachers', authMiddleware, adminOnly, (req, res) => {
  const { code, full_name, password, bio, whatsapp, specialty } = req.body;
  if (!code || !full_name || !password) {
    return res.status(400).json({ error: 'Nombre, usuario y contraseña del profesor son obligatorios' });
  }
  const hash = bcrypt.hashSync(password, 10);
  db.run(
    `INSERT INTO users (code, full_name, password_hash, role, plain_hint, bio, whatsapp, specialty, is_faculty)
     VALUES (?, ?, ?, 'teacher', ?, ?, ?, ?, 1)`,
    [
      code.trim(),
      full_name.trim(),
      hash,
      password.trim(),
      (bio || '').trim(),
      (whatsapp || '').trim(),
      (specialty || 'Docente Sol Music').trim()
    ],
    function (err) {
      if (err) return res.status(400).json({ error: 'Ese usuario/código ya está en uso' });
      res.json({ id: this.lastID });
    }
  );
});

// Editar perfil de cualquier docente o del propio administrador en la plana docente
router.put('/intranet/api/admin/teachers/:id', authMiddleware, adminOnly, (req, res) => {
  const targetId = req.params.id;
  const { full_name, code, bio, whatsapp, specialty, new_password, enable_faculty } = req.body;

  if (!full_name || !full_name.trim()) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }

  db.get(`SELECT id, role FROM users WHERE id = ?`, [targetId], (err, u) => {
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });

    const newCode = (code || '').trim();
    const runUpdate = () => {
      const facVal = enable_faculty !== undefined ? (enable_faculty ? 1 : 0) : 1;
      const baseSql = new_password && new_password.trim().length >= 6
        ? `UPDATE users SET full_name = ?, code = COALESCE(NULLIF(?, ''), code), bio = ?, whatsapp = ?, specialty = ?, is_faculty = ?, password_hash = ?, plain_hint = ? WHERE id = ?`
        : `UPDATE users SET full_name = ?, code = COALESCE(NULLIF(?, ''), code), bio = ?, whatsapp = ?, specialty = ?, is_faculty = ? WHERE id = ?`;

      const params = new_password && new_password.trim().length >= 6
        ? [full_name.trim(), newCode, (bio || '').trim(), (whatsapp || '').trim(), (specialty || '').trim(), facVal, bcrypt.hashSync(new_password.trim(), 10), new_password.trim(), targetId]
        : [full_name.trim(), newCode, (bio || '').trim(), (whatsapp || '').trim(), (specialty || '').trim(), facVal, targetId];

      db.run(baseSql, params, (errUp) => {
        if (errUp) return res.status(500).json({ error: 'Error actualizando perfil docente' });
        res.json({ ok: true });
      });
    };

    if (newCode) {
      db.get(`SELECT id FROM users WHERE LOWER(code) = LOWER(?) AND id != ?`, [newCode, targetId], (eDup, dup) => {
        if (dup) return res.status(400).json({ error: 'Ese usuario ya está en uso' });
        runUpdate();
      });
    } else {
      runUpdate();
    }
  });
});

// Subir foto de perfil para un docente o para el admin en la plana docente
router.post('/intranet/api/admin/teachers/:id/avatar', authMiddleware, adminOnly, uploadAvatar.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Selecciona una imagen válida' });
  const targetId = req.params.id;
  db.get(`SELECT avatar_file FROM users WHERE id = ?`, [targetId], (err, row) => {
    if (row && row.avatar_file) {
      const oldPath = path.join(avatarsDir, row.avatar_file);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    db.run(`UPDATE users SET avatar_file = ?, is_faculty = 1 WHERE id = ?`, [req.file.filename, targetId], (err2) => {
      if (err2) return res.status(500).json({ error: 'Error guardando foto' });
      res.json({ ok: true, avatar_file: req.file.filename });
    });
  });
});

router.delete('/intranet/api/admin/teachers/:id', authMiddleware, adminOnly, (req, res) => {
  db.get(`SELECT role FROM users WHERE id = ?`, [req.params.id], (err, u) => {
    if (!u) return res.json({ ok: true });
    if (u.role === 'admin') {
      db.run(`UPDATE users SET is_faculty = 0 WHERE id = ?`, [req.params.id], () => res.json({ ok: true }));
    } else {
      db.run(`DELETE FROM users WHERE id = ? AND role = 'teacher'`, [req.params.id], () => {
        db.run(`DELETE FROM teacher_groups WHERE teacher_id = ?`, [req.params.id], () => res.json({ ok: true }));
      });
    }
  });
});


router.get('/intranet/api/admin/students', authMiddleware, staffOnly, (req, res) => {
  const { group_id, category } = req.query;

  let sql = `SELECT DISTINCT u.id, u.code, u.full_name, u.group_id, u.schedule, u.monthly_quota,
                    u.bio, u.avatar_file, u.plain_hint, u.instrument, u.grade,
                    gMain.name AS group_name, gMain.category
             FROM users u
             LEFT JOIN groups gMain ON gMain.id = u.group_id
             LEFT JOIN student_groups sg ON sg.student_id = u.id
             LEFT JOIN groups gSub ON gSub.id = sg.group_id
             WHERE u.role = 'student'`;
  const params = [];

  if (req.user.role !== 'admin') {
    sql += ` AND (gMain.category = 'Sol Music' OR gSub.category = 'Sol Music')`;
  } else if (category && category !== 'Todos') {
    sql += ` AND (gMain.category = ? OR gSub.category = ?)`;
    params.push(category, category);
  }

  if (group_id) {
    sql += ` AND (sg.group_id = ? OR u.group_id = ?)`;
    params.push(group_id, group_id);
  }

  sql += ` ORDER BY u.full_name ASC`;

  db.all(sql, params, (err, rows) => {
    if (!rows || !rows.length) return res.json([]); attachGroupsToStudents(rows, (enriched) => res.json(enriched));
  });
});

router.post('/intranet/api/admin/students', authMiddleware, staffOnly, (req, res) => {
  const { code, full_name, password, group_id, group_ids, schedule, monthly_quota, instrument, grade } = req.body;
  const selectedIds = Array.isArray(group_ids) && group_ids.length
    ? group_ids.map(Number)
    : (group_id ? [Number(group_id)] : []);

  if (!code || !full_name || !password || !selectedIds.length) {
    return res.status(400).json({ error: 'Nombre, usuario, contraseña y al menos un grupo son obligatorios' });
  }

  const quota = parseInt(monthly_quota, 10) || 8;
  const inst = instrument || 'Guitarra acustica';

  const checkAll = (idx) => {
    if (idx >= selectedIds.length) {
      const hash = bcrypt.hashSync(password, 10);
      const primaryGid = selectedIds[0];
      db.run(
        `INSERT INTO users (code, full_name, password_hash, role, group_id, schedule, monthly_quota, plain_hint, instrument, grade)
         VALUES (?, ?, ?, 'student', ?, ?, ?, ?, ?, ?)`,
        [code.trim(), full_name.trim(), hash, primaryGid, (schedule || '').trim(), quota, password.trim(), inst, (grade || '').trim()],
        function (err) {
          if (err) return res.status(400).json({ error: 'Ese código/usuario ya está registrado' });
          const newStudentId = this.lastID;
          syncStudentGroups(newStudentId, selectedIds, primaryGid, () => {
            res.json({ id: newStudentId });
          });
        }
      );
      return;
    }

    verifyGroupAccess(req.user, selectedIds[idx], (allowed) => {
      if (!allowed) return res.status(403).json({ error: 'No tienes permiso para asignar uno de los grupos seleccionados' });
      checkAll(idx + 1);
    });
  };

  checkAll(0);
});

router.put('/intranet/api/admin/students/:id', authMiddleware, staffOnly, (req, res) => {
  const studentId = req.params.id;
  const { code, full_name, group_id, group_ids, schedule, monthly_quota, instrument, grade, new_password } = req.body;
  const selectedIds = Array.isArray(group_ids) && group_ids.length
    ? group_ids.map(Number)
    : (group_id ? [Number(group_id)] : []);

  if (!full_name || !selectedIds.length || !code) {
    return res.status(400).json({ error: 'Usuario, nombre y al menos un grupo son obligatorios' });
  }

  const quota = parseInt(monthly_quota, 10) || 8;
  const inst = instrument || 'Guitarra acustica';
  const newCode = code.trim();

  db.get(`SELECT id, group_id FROM users WHERE id = ? AND role = 'student'`, [studentId], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'Estudiante no encontrado' });

    const checkTargets = (idx) => {
      if (idx >= selectedIds.length) {
        db.get(`SELECT id FROM users WHERE LOWER(code) = LOWER(?) AND id != ?`, [newCode, studentId], (errDup, dup) => {
          if (dup) return res.status(400).json({ error: 'Ese usuario ya está en uso por otro miembro' });

          const primaryGid = selectedIds[0];
          const doneUpdate = (errUp) => {
            if (errUp) return res.status(500).json({ error: 'Error actualizando estudiante' });
            syncStudentGroups(studentId, selectedIds, primaryGid, () => res.json({ ok: true }));
          };

          if (new_password && new_password.trim().length >= 6) {
            const hash = bcrypt.hashSync(new_password.trim(), 10);
            db.run(
              `UPDATE users SET code = ?, full_name = ?, group_id = ?, schedule = ?, monthly_quota = ?, instrument = ?, grade = ?, password_hash = ?, plain_hint = ? WHERE id = ?`,
              [newCode, full_name.trim(), primaryGid, (schedule || '').trim(), quota, inst, (grade || '').trim(), hash, new_password.trim(), studentId],
              doneUpdate
            );
          } else {
            db.run(
              `UPDATE users SET code = ?, full_name = ?, group_id = ?, schedule = ?, monthly_quota = ?, instrument = ?, grade = ? WHERE id = ?`,
              [newCode, full_name.trim(), primaryGid, (schedule || '').trim(), quota, inst, (grade || '').trim(), studentId],
              doneUpdate
            );
          }
        });
        return;
      }

      verifyGroupAccess(req.user, selectedIds[idx], (allowed) => {
        if (!allowed) return res.status(403).json({ error: 'No tienes permiso para asignar uno de los subgrupos elegidos' });
        checkTargets(idx + 1);
      });
    };

    checkTargets(0);
  });
});

router.delete('/intranet/api/admin/students/:id', authMiddleware, staffOnly, (req, res) => {
  db.get(`SELECT group_id FROM users WHERE id = ? AND role = 'student'`, [req.params.id], (err, row) => {
    if (!row) return res.status(404).json({ error: 'Estudiante no encontrado' });
    verifyGroupAccess(req.user, row.group_id, (allowed) => {
      if (!allowed) return res.status(403).json({ error: 'No tienes permiso para eliminar a este alumno' });
      db.run(`DELETE FROM users WHERE id = ?`, [req.params.id], () => {
        db.run(`DELETE FROM student_groups WHERE student_id = ?`, [req.params.id], () => {
          db.run(`DELETE FROM attendance WHERE student_id = ?`, [req.params.id], () => res.json({ ok: true }));
        });
      });
    });
  });
});


module.exports = router;
