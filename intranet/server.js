const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'DCCORP_INTRANET_SECRET_2026_VSC';

const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use(express.json());
app.use('/intranet', express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safeName = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safeName);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const db = new sqlite3.Database(path.join(dataDir, 'intranet.db'));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'student',
    group_id INTEGER,
    schedule TEXT,
    monthly_quota INTEGER DEFAULT 8,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`ALTER TABLE users ADD COLUMN schedule TEXT`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN monthly_quota INTEGER DEFAULT 8`, () => {});

  db.run(`CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL DEFAULT 'Particulares',
    description TEXT,
    created_by INTEGER
  )`);

  db.run(`ALTER TABLE groups ADD COLUMN category TEXT NOT NULL DEFAULT 'Particulares'`, () => {});
  db.run(`ALTER TABLE groups ADD COLUMN created_by INTEGER`, () => {});

  db.run(`CREATE TABLE IF NOT EXISTS teacher_groups (
    teacher_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    PRIMARY KEY (teacher_id, group_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    status TEXT NOT NULL,
    note TEXT,
    session_type TEXT NOT NULL DEFAULT 'Regular',
    arrival_time TEXT,
    recorded_by_id INTEGER,
    recorded_by_name TEXT,
    UNIQUE(student_id, date, session_type)
  )`);

  // Migración suave si attendance tenía el índice antiguo
  db.all(`PRAGMA table_info(attendance)`, [], (err, cols) => {
    if (!err && Array.isArray(cols)) {
      const hasSessionType = cols.some(c => c.name === 'session_type');
      if (!hasSessionType) {
        db.serialize(() => {
          db.run(`ALTER TABLE attendance RENAME TO attendance_old`);
          db.run(`CREATE TABLE attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            group_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            status TEXT NOT NULL,
            note TEXT,
            session_type TEXT NOT NULL DEFAULT 'Regular',
            arrival_time TEXT,
            recorded_by_id INTEGER,
            recorded_by_name TEXT,
            UNIQUE(student_id, date, session_type)
          )`);
          db.run(`INSERT INTO attendance (id, student_id, group_id, date, status, note, session_type)
                  SELECT id, student_id, group_id, date, status, note, 'Regular' FROM attendance_old`);
          db.run(`DROP TABLE attendance_old`);
        });
      }
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    file_name TEXT,
    original_name TEXT,
    external_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const adminCode = 'admin';
  const defaultPass = 'DcCorp2026!';
  db.get(`SELECT id FROM users WHERE code = ?`, [adminCode], (err, row) => {
    if (!row) {
      const hash = bcrypt.hashSync(defaultPass, 10);
      db.run(
        `INSERT INTO users (code, full_name, password_hash, role) VALUES (?, ?, ?, 'admin')`,
        [adminCode, 'Víctor Samuel Castro Delgado', hash]
      );
      console.log('Admin inicializado -> Usuario: admin | Clave: DcCorp2026!');
    }
  });
});

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Token requerido' });
  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Sesión expirada o inválida' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acceso solo para administrador' });
  next();
}

function staffOnly(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'teacher') {
    return res.status(403).json({ error: 'Acceso solo para docentes o administrador' });
  }
  next();
}

function verifyGroupAccess(user, groupId, cb) {
  if (user.role === 'admin') return cb(true);
  if (user.role === 'teacher') {
    db.get(`SELECT category FROM groups WHERE id = ?`, [groupId], (err, row) => {
      cb(!!(row && row.category === 'Sol Music'));
    });
    return;
  }
  cb(false);
}

// ================= AUTENTICACIÓN =================
app.post('/intranet/api/login', (req, res) => {
  const { code, password } = req.body;
  if (!code || !password) return res.status(400).json({ error: 'Completa usuario y contraseña' });

  db.get(`SELECT * FROM users WHERE LOWER(code) = LOWER(?)`, [code.trim()], (err, user) => {
    if (err || !user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    const token = jwt.sign(
      { id: user.id, code: user.code, full_name: user.full_name, role: user.role, group_id: user.group_id },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, role: user.role, full_name: user.full_name });
  });
});

app.post('/intranet/api/change-password', authMiddleware, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, req.user.id], (err) => {
    if (err) return res.status(500).json({ error: 'Error actualizando contraseña' });
    res.json({ ok: true });
  });
});

// ================= GRUPOS Y SUBGRUPOS =================
app.get('/intranet/api/admin/groups', authMiddleware, staffOnly, (req, res) => {
  if (req.user.role === 'admin') {
    db.all(`SELECT * FROM groups ORDER BY category ASC, name ASC`, [], (err, rows) => res.json(rows || []));
  } else {
    db.all(
      `SELECT * FROM groups WHERE category = 'Sol Music' ORDER BY name ASC`,
      [],
      (err, rows) => res.json(rows || [])
    );
  }
});

app.post('/intranet/api/admin/groups', authMiddleware, staffOnly, (req, res) => {
  const { name, category, description } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre del grupo o subgrupo es obligatorio' });

  const cat = req.user.role === 'admin'
    ? (category === 'Sol Music' ? 'Sol Music' : 'Particulares')
    : 'Sol Music';

  db.run(
    `INSERT INTO groups (name, category, description, created_by) VALUES (?, ?, ?, ?)`,
    [name.trim(), cat, description || '', req.user.id],
    function (err) {
      if (err) return res.status(400).json({ error: 'Ya existe un grupo o subgrupo con ese nombre' });
      res.json({ id: this.lastID, name: name.trim(), category: cat, description });
    }
  );
});

app.delete('/intranet/api/admin/groups/:id', authMiddleware, staffOnly, (req, res) => {
  verifyGroupAccess(req.user, req.params.id, (allowed) => {
    if (!allowed) return res.status(403).json({ error: 'No tienes permiso para eliminar este grupo' });
    db.run(`DELETE FROM groups WHERE id = ?`, [req.params.id], () => {
      db.run(`DELETE FROM teacher_groups WHERE group_id = ?`, [req.params.id], () => res.json({ ok: true }));
    });
  });
});

// ================= PROFESORES (Solo Admin) =================
app.get('/intranet/api/admin/teachers', authMiddleware, adminOnly, (req, res) => {
  db.all(`SELECT id, code, full_name FROM users WHERE role = 'teacher' ORDER BY full_name ASC`, [], (err, teachers) => {
    res.json(teachers || []);
  });
});

app.post('/intranet/api/admin/teachers', authMiddleware, adminOnly, (req, res) => {
  const { code, full_name, password } = req.body;
  if (!code || !full_name || !password) {
    return res.status(400).json({ error: 'Nombre, usuario y contraseña del profesor son obligatorios' });
  }
  const hash = bcrypt.hashSync(password, 10);
  db.run(
    `INSERT INTO users (code, full_name, password_hash, role) VALUES (?, ?, ?, 'teacher')`,
    [code.trim(), full_name.trim(), hash],
    function (err) {
      if (err) return res.status(400).json({ error: 'Ese usuario/código ya está en uso' });
      res.json({ id: this.lastID });
    }
  );
});

app.delete('/intranet/api/admin/teachers/:id', authMiddleware, adminOnly, (req, res) => {
  db.run(`DELETE FROM users WHERE id = ? AND role = 'teacher'`, [req.params.id], () => {
    db.run(`DELETE FROM teacher_groups WHERE teacher_id = ?`, [req.params.id], () => res.json({ ok: true }));
  });
});

// ================= ESTUDIANTES =================
app.get('/intranet/api/admin/students', authMiddleware, staffOnly, (req, res) => {
  const { group_id, category } = req.query;

  if (req.user.role === 'admin') {
    let sql = `SELECT u.id, u.code, u.full_name, u.group_id, u.schedule, u.monthly_quota, g.name AS group_name, g.category
               FROM users u LEFT JOIN groups g ON u.group_id = g.id
               WHERE u.role = 'student'`;
    const params = [];
    if (group_id) {
      sql += ` AND u.group_id = ?`;
      params.push(group_id);
    }
    if (category && category !== 'Todos') {
      sql += ` AND g.category = ?`;
      params.push(category);
    }
    sql += ` ORDER BY u.full_name ASC`;
    db.all(sql, params, (err, rows) => res.json(rows || []));
  } else {
    let sql = `SELECT u.id, u.code, u.full_name, u.group_id, u.schedule, u.monthly_quota, g.name AS group_name, g.category
               FROM users u
               INNER JOIN groups g ON u.group_id = g.id
               WHERE u.role = 'student' AND g.category = 'Sol Music'`;
    const params = [];
    if (group_id) {
      sql += ` AND u.group_id = ?`;
      params.push(group_id);
    }
    sql += ` ORDER BY u.full_name ASC`;
    db.all(sql, params, (err, rows) => res.json(rows || []));
  }
});

app.post('/intranet/api/admin/students', authMiddleware, staffOnly, (req, res) => {
  const { code, full_name, password, group_id, schedule, monthly_quota } = req.body;
  if (!code || !full_name || !password || !group_id) {
    return res.status(400).json({ error: 'Nombre, usuario, contraseña y grupo son obligatorios' });
  }
  const quota = parseInt(monthly_quota, 10) || 8;

  verifyGroupAccess(req.user, group_id, (allowed) => {
    if (!allowed) return res.status(403).json({ error: 'Solo puedes registrar alumnos en subgrupos de Sol Music' });

    const hash = bcrypt.hashSync(password, 10);
    db.run(
      `INSERT INTO users (code, full_name, password_hash, role, group_id, schedule, monthly_quota)
       VALUES (?, ?, ?, 'student', ?, ?, ?)`,
      [code.trim(), full_name.trim(), hash, group_id, (schedule || '').trim(), quota],
      function (err) {
        if (err) return res.status(400).json({ error: 'Ese código/usuario ya está registrado' });
        res.json({ id: this.lastID });
      }
    );
  });
});

app.delete('/intranet/api/admin/students/:id', authMiddleware, staffOnly, (req, res) => {
  db.get(`SELECT group_id FROM users WHERE id = ? AND role = 'student'`, [req.params.id], (err, row) => {
    if (!row) return res.status(404).json({ error: 'Estudiante no encontrado' });
    verifyGroupAccess(req.user, row.group_id, (allowed) => {
      if (!allowed) return res.status(403).json({ error: 'No tienes permiso para eliminar a este alumno' });
      db.run(`DELETE FROM users WHERE id = ?`, [req.params.id], () => {
        db.run(`DELETE FROM attendance WHERE student_id = ?`, [req.params.id], () => res.json({ ok: true }));
      });
    });
  });
});

// ================= ASISTENCIA SEMANAL GRÁFICA (Bloque 8/mes + Recuperación + Reforzamientos) =================
app.get('/intranet/api/admin/weekly-attendance', authMiddleware, staffOnly, (req, res) => {
  const { group_id, start_date, end_date } = req.query;
  if (!group_id || !start_date || !end_date) {
    return res.status(400).json({ error: 'Falta grupo o rango de semana' });
  }
  const monthPrefix = start_date.slice(0, 7);

  verifyGroupAccess(req.user, group_id, (allowed) => {
    if (!allowed) return res.status(403).json({ error: 'No tienes permiso sobre este grupo' });

    db.all(
      `SELECT u.id AS student_id, u.code, u.full_name, u.schedule, u.monthly_quota,
              (SELECT COUNT(*) FROM attendance a2
               WHERE a2.student_id = u.id
                 AND a2.session_type IN ('Regular', 'Recuperacion')
                 AND substr(a2.date, 1, 7) = ?
                 AND a2.status IN ('Presente', 'Tardanza', 'Justificado')) AS used_this_month
       FROM users u
       WHERE u.role = 'student' AND u.group_id = ?
       ORDER BY u.full_name ASC`,
      [monthPrefix, group_id],
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

// Guarda, actualiza o elimina un registro individual al hacer clic en una celda de la semana
app.post('/intranet/api/admin/attendance/cell', authMiddleware, staffOnly, (req, res) => {
  const { student_id, group_id, date, status, session_type, arrival_time, note } = req.body;
  if (!student_id || !group_id || !date) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }
  const sType = ['Regular', 'Recuperacion', 'Reforzamiento'].includes(session_type) ? session_type : 'Regular';

  verifyGroupAccess(req.user, group_id, (allowed) => {
    if (!allowed) return res.status(403).json({ error: 'No tienes permiso sobre este grupo' });

    // Si status viene vacío o 'Clear', borramos el registro de ese día/tipo
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

// ================= MATERIALES =================
app.get('/intranet/api/admin/materials', authMiddleware, staffOnly, (req, res) => {
  if (req.user.role === 'admin') {
    db.all(
      `SELECT m.*, g.name AS group_name, g.category FROM materials m
       LEFT JOIN groups g ON m.group_id = g.id
       ORDER BY m.created_at DESC`,
      [],
      (err, rows) => res.json(rows || [])
    );
  } else {
    db.all(
      `SELECT m.*, g.name AS group_name, g.category FROM materials m
       INNER JOIN groups g ON m.group_id = g.id
       WHERE g.category = 'Sol Music' ORDER BY m.created_at DESC`,
      [],
      (err, rows) => res.json(rows || [])
    );
  }
});

app.post('/intranet/api/admin/materials', authMiddleware, staffOnly, upload.single('file'), (req, res) => {
  const { group_id, title, description, external_url } = req.body;
  if (!group_id || !title) return res.status(400).json({ error: 'Grupo y título son obligatorios' });

  verifyGroupAccess(req.user, group_id, (allowed) => {
    if (!allowed) return res.status(403).json({ error: 'Solo puedes publicar en subgrupos de Sol Music' });

    const fileName = req.file ? req.file.filename : null;
    const originalName = req.file ? req.file.originalname : null;

    db.run(
      `INSERT INTO materials (group_id, title, description, file_name, original_name, external_url)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [group_id, title.trim(), description || '', fileName, originalName, external_url || ''],
      function (err) {
        if (err) return res.status(500).json({ error: 'Error al guardar el material' });
        res.json({ id: this.lastID });
      }
    );
  });
});

app.delete('/intranet/api/admin/materials/:id', authMiddleware, staffOnly, (req, res) => {
  db.get(`SELECT group_id, file_name FROM materials WHERE id = ?`, [req.params.id], (err, row) => {
    if (!row) return res.status(404).json({ error: 'Material no encontrado' });
    verifyGroupAccess(req.user, row.group_id, (allowed) => {
      if (!allowed) return res.status(403).json({ error: 'Sin permiso para eliminar este material' });
      if (row.file_name) {
        const fPath = path.join(uploadsDir, row.file_name);
        if (fs.existsSync(fPath)) fs.unlinkSync(fPath);
      }
      db.run(`DELETE FROM materials WHERE id = ?`, [req.params.id], () => res.json({ ok: true }));
    });
  });
});

// ================= PORTAL DEL ESTUDIANTE =================
app.get('/intranet/api/student/dashboard', authMiddleware, (req, res) => {
  db.get(
    `SELECT u.id, u.code, u.full_name, u.group_id, u.schedule, u.monthly_quota,
            g.name AS group_name, g.category, g.description AS group_desc
     FROM users u LEFT JOIN groups g ON u.group_id = g.id WHERE u.id = ?`,
    [req.user.id],
    (err, student) => {
      if (!student) return res.status(404).json({ error: 'Estudiante no encontrado' });

      db.all(
        `SELECT date, status, note, session_type, arrival_time, recorded_by_name
         FROM attendance WHERE student_id = ? ORDER BY date DESC, id DESC`,
        [student.id],
        (err2, attendances) => {
          db.all(
            `SELECT id, title, description, file_name, original_name, external_url, created_at
             FROM materials WHERE group_id = ? ORDER BY created_at DESC`,
            [student.group_id],
            (err3, materials) => {
              res.json({
                student,
                attendances: attendances || [],
                materials: materials || []
              });
            }
          );
        }
      );
    }
  );
});

app.get('/intranet/api/files/:filename', (req, res) => {
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

app.get('/intranet', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Intranet DC CORP corriendo en http://127.0.0.1:${PORT}/intranet`);
});
