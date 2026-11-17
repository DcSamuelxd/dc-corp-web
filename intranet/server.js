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
const avatarsDir = path.join(uploadsDir, 'avatars');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

app.use(express.json());
app.use('/intranet', express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safeName = Date.now() + '-' + Math.round(Math.random() * 1e6) + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safeName);
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, avatarsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `avatar-${req.user.id}-${Date.now()}${ext}`);
  }
});
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

const db = new sqlite3.Database(path.join(dataDir, 'intranet.db'));

// ================= BUS EN TIEMPO REAL (SSE - Server-Sent Events) =================
const sseClients = new Set();

function broadcastChatEvent(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.res.write(data);
    } catch {
      sseClients.delete(client);
    }
  }
}

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
    bio TEXT DEFAULT '',
    avatar_file TEXT DEFAULT '',
    plain_hint TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`ALTER TABLE users ADD COLUMN schedule TEXT`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN monthly_quota INTEGER DEFAULT 8`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN avatar_file TEXT DEFAULT ''`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN plain_hint TEXT DEFAULT ''`, () => {});

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

  db.run(`CREATE TABLE IF NOT EXISTS material_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id INTEGER NOT NULL,
    label TEXT NOT NULL DEFAULT 'General',
    file_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_type TEXT NOT NULL DEFAULT 'other'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS material_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    sender_role TEXT NOT NULL DEFAULT 'student',
    sender_name TEXT NOT NULL,
    note_type TEXT NOT NULL DEFAULT 'consulta',
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    target_category TEXT NOT NULL DEFAULT 'Todos',
    event_date TEXT DEFAULT '',
    created_by_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.all(`SELECT id, file_name, original_name FROM materials WHERE file_name IS NOT NULL AND file_name != ''`, [], (err, legacyRows) => {
    if (!err && Array.isArray(legacyRows)) {
      legacyRows.forEach(r => {
        db.get(`SELECT id FROM material_files WHERE material_id = ? AND file_name = ?`, [r.id, r.file_name], (e2, exists) => {
          if (!exists) {
            const ext = path.extname(r.original_name || '').toLowerCase();
            const fType = ext === '.pdf' ? 'pdf' : (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext) ? 'audio' : 'other');
            db.run(
              `INSERT INTO material_files (material_id, label, file_name, original_name, file_type) VALUES (?, 'General', ?, ?, ?)`,
              [r.id, r.file_name, r.original_name, fType]
            );
          }
        });
      });
    }
  });

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
  const queryToken = req.query.token;
  const token = authHeader ? authHeader.split(' ')[1] : queryToken;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
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

// ================= CANAL SSE TIEMPO REAL (CHAT CONSULTAS) =================
app.get('/intranet/api/chat/stream', authMiddleware, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const client = { id: Date.now() + Math.random(), user: req.user, res };
  sseClients.add(client);
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  const keepAlive = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      clearInterval(keepAlive);
      sseClients.delete(client);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(client);
  });
});

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
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }

  db.get(`SELECT password_hash FROM users WHERE id = ?`, [req.user.id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (currentPassword !== undefined) {
      if (!bcrypt.compareSync(currentPassword, row.password_hash)) {
        return res.status(400).json({ error: 'La contraseña actual es incorrecta' });
      }
    }

    const hash = bcrypt.hashSync(newPassword, 10);
    db.run(`UPDATE users SET password_hash = ?, plain_hint = ? WHERE id = ?`, [hash, newPassword, req.user.id], (err2) => {
      if (err2) return res.status(500).json({ error: 'Error actualizando contraseña' });
      res.json({ ok: true });
    });
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
  db.all(`SELECT id, code, full_name, plain_hint FROM users WHERE role = 'teacher' ORDER BY full_name ASC`, [], (err, teachers) => {
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
    `INSERT INTO users (code, full_name, password_hash, role, plain_hint) VALUES (?, ?, ?, 'teacher', ?)`,
    [code.trim(), full_name.trim(), hash, password.trim()],
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
    let sql = `SELECT u.id, u.code, u.full_name, u.group_id, u.schedule, u.monthly_quota, u.bio, u.avatar_file, u.plain_hint,
                      g.name AS group_name, g.category
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
    let sql = `SELECT u.id, u.code, u.full_name, u.group_id, u.schedule, u.monthly_quota, u.bio, u.avatar_file, u.plain_hint,
                      g.name AS group_name, g.category
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
      `INSERT INTO users (code, full_name, password_hash, role, group_id, schedule, monthly_quota, plain_hint)
       VALUES (?, ?, ?, 'student', ?, ?, ?, ?)`,
      [code.trim(), full_name.trim(), hash, group_id, (schedule || '').trim(), quota, password.trim()],
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

// ================= ASISTENCIA SEMANAL GRÁFICA =================
app.get('/intranet/api/admin/weekly-attendance', authMiddleware, staffOnly, (req, res) => {
  const { group_id, start_date, end_date } = req.query;
  if (!group_id || !start_date || !end_date) {
    return res.status(400).json({ error: 'Falta grupo o rango de semana' });
  }
  const monthPrefix = start_date.slice(0, 7);

  verifyGroupAccess(req.user, group_id, (allowed) => {
    if (!allowed) return res.status(403).json({ error: 'No tienes permiso sobre este grupo' });

    db.all(
      `SELECT u.id AS student_id, u.code, u.full_name, u.schedule, u.monthly_quota, u.avatar_file,
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

app.post('/intranet/api/admin/attendance/cell', authMiddleware, staffOnly, (req, res) => {
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
app.get('/intranet/api/admin/daily-summary', authMiddleware, staffOnly, (req, res) => {
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

// ================= MATERIALES MÚLTIPLES Y CONSULTAS EN TIEMPO REAL =================
function attachFilesToMaterials(materials, cb) {
  if (!materials || !materials.length) return cb([]);
  const ids = materials.map(m => m.id);
  const placeholders = ids.map(() => '?').join(',');
  db.all(
    `SELECT * FROM material_files WHERE material_id IN (${placeholders}) ORDER BY id ASC`,
    ids,
    (err, files) => {
      const byMat = {};
      (files || []).forEach(f => {
        if (!byMat[f.material_id]) byMat[f.material_id] = [];
        byMat[f.material_id].push(f);
      });
      cb(materials.map(m => ({ ...m, files: byMat[m.id] || [] })));
    }
  );
}

app.get('/intranet/api/admin/materials', authMiddleware, staffOnly, (req, res) => {
  const sql = req.user.role === 'admin'
    ? `SELECT m.*, g.name AS group_name, g.category FROM materials m
       LEFT JOIN groups g ON m.group_id = g.id
       ORDER BY m.created_at DESC`
    : `SELECT m.*, g.name AS group_name, g.category FROM materials m
       INNER JOIN groups g ON m.group_id = g.id
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
          res.json(enriched.map(m => ({ ...m, consultas: byMat[m.id] || [] })));
        }
      );
    });
  });
});

app.post('/intranet/api/admin/materials/:id/reply', authMiddleware, staffOnly, (req, res) => {
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

app.post('/intranet/api/admin/materials', authMiddleware, staffOnly, upload.array('files', 30), (req, res) => {
  const { group_id, title, description, external_url, labels } = req.body;
  if (!group_id || !title) return res.status(400).json({ error: 'Grupo y título son obligatorios' });

  verifyGroupAccess(req.user, group_id, (allowed) => {
    if (!allowed) return res.status(403).json({ error: 'Solo puedes publicar en subgrupos de Sol Music' });

    let parsedLabels = [];
    try {
      parsedLabels = labels ? JSON.parse(labels) : [];
    } catch {
      parsedLabels = [];
    }

    db.run(
      `INSERT INTO materials (group_id, title, description, external_url) VALUES (?, ?, ?, ?)`,
      [group_id, title.trim(), description || '', (external_url || '').trim()],
      function (err) {
        if (err) return res.status(500).json({ error: 'Error al guardar el material' });
        const materialId = this.lastID;
        const uploadedFiles = req.files || [];

        if (!uploadedFiles.length) return res.json({ id: materialId });

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

        stmt.finalize(() => res.json({ id: materialId }));
      }
    );
  });
});

app.delete('/intranet/api/admin/materials/:id', authMiddleware, staffOnly, (req, res) => {
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
app.get('/intranet/api/admin/announcements', authMiddleware, staffOnly, (req, res) => {
  if (req.user.role === 'admin') {
    db.all(`SELECT * FROM announcements ORDER BY created_at DESC`, [], (err, rows) => res.json(rows || []));
  } else {
    db.all(
      `SELECT * FROM announcements WHERE target_category IN ('Todos', 'Sol Music') ORDER BY created_at DESC`,
      [],
      (err, rows) => res.json(rows || [])
    );
  }
});

app.post('/intranet/api/admin/announcements', authMiddleware, staffOnly, (req, res) => {
  const { title, message, target_category, event_date } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'Título y mensaje del aviso son obligatorios' });

  const target = req.user.role === 'admin'
    ? (['Todos', 'Particulares', 'Sol Music'].includes(target_category) ? target_category : 'Todos')
    : 'Sol Music';

  db.run(
    `INSERT INTO announcements (title, message, target_category, event_date, created_by_name)
     VALUES (?, ?, ?, ?, ?)`,
    [title.trim(), message.trim(), target, (event_date || '').trim(), req.user.full_name],
    function (err) {
      if (err) return res.status(500).json({ error: 'Error publicando anuncio' });
      res.json({ id: this.lastID });
    }
  );
});

app.delete('/intranet/api/admin/announcements/:id', authMiddleware, staffOnly, (req, res) => {
  if (req.user.role === 'admin') {
    db.run(`DELETE FROM announcements WHERE id = ?`, [req.params.id], () => res.json({ ok: true }));
  } else {
    db.run(`DELETE FROM announcements WHERE id = ? AND target_category = 'Sol Music'`, [req.params.id], () => res.json({ ok: true }));
  }
});

// ================= COPIA DE SEGURIDAD SQLITE (SOLO ADMIN) =================
app.get('/intranet/api/admin/backup', authMiddleware, adminOnly, (req, res) => {
  const dbPath = path.join(dataDir, 'intranet.db');
  if (!fs.existsSync(dbPath)) return res.status(404).json({ error: 'Base de datos no encontrada' });
  const stamp = new Date().toISOString().slice(0, 10);
  res.download(dbPath, `intranet_dccorp_backup_${stamp}.db`);
});

// ================= PORTAL DEL ESTUDIANTE =================

app.get('/intranet/api/student/dashboard', authMiddleware, (req, res) => {
  db.get(
    `SELECT u.id, u.code, u.full_name, u.group_id, u.schedule, u.monthly_quota, u.bio, u.avatar_file,
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
              attachFilesToMaterials(materials || [], (enrichedMats) => {
                if (!enrichedMats.length) {
                  const stuCat = student.category || 'Particulares';
                  return db.all(
                    `SELECT * FROM announcements WHERE target_category IN ('Todos', ?) ORDER BY created_at DESC LIMIT 5`,
                    [stuCat],
                    (err5, anns) => {
                      res.json({
                        student,
                        announcements: anns || [],
                        attendances: attendances || [],
                        materials: []
                      });
                    }
                  );
                }
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
                    const stuCat = student.category || 'Particulares';
                    db.all(
                      `SELECT * FROM announcements WHERE target_category IN ('Todos', ?) ORDER BY created_at DESC LIMIT 5`,
                      [stuCat],
                      (err5, anns) => {
                        res.json({
                          student,
                          announcements: anns || [],
                          attendances: attendances || [],
                          materials: enrichedMats.map(m => ({ ...m, notes: byMat[m.id] || [] }))
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
});

app.post('/intranet/api/student/profile', authMiddleware, (req, res) => {
  const { bio } = req.body;
  db.run(`UPDATE users SET bio = ? WHERE id = ?`, [(bio || '').trim().slice(0, 400), req.user.id], (err) => {
    if (err) return res.status(500).json({ error: 'Error actualizando descripción' });
    res.json({ ok: true });
  });
});

app.post('/intranet/api/student/avatar', authMiddleware, uploadAvatar.single('avatar'), (req, res) => {
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

app.post('/intranet/api/student/materials/:id/notes', authMiddleware, (req, res) => {
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

app.delete('/intranet/api/student/notes/:noteId', authMiddleware, (req, res) => {
  db.run(`DELETE FROM material_notes WHERE id = ? AND student_id = ?`, [req.params.noteId, req.user.id], () => {
    res.json({ ok: true });
  });
});

app.get('/intranet/api/avatars/:filename', (req, res) => {
  const safeFile = path.basename(req.params.filename);
  const fullPath = path.join(avatarsDir, safeFile);
  if (!fs.existsSync(fullPath)) return res.status(404).send('Imagen no encontrada');
  res.sendFile(fullPath);
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
