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
    const uid = (req.user && req.user.id) ? req.user.id : 'user';
    cb(null, `avatar-${uid}-${Date.now()}${ext}`);
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
    instrument TEXT DEFAULT 'Guitarra acustica',
    whatsapp TEXT DEFAULT '',
    specialty TEXT DEFAULT '',
    is_faculty INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`ALTER TABLE users ADD COLUMN schedule TEXT`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN monthly_quota INTEGER DEFAULT 8`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN avatar_file TEXT DEFAULT ''`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN plain_hint TEXT DEFAULT ''`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN instrument TEXT DEFAULT 'Guitarra acustica'`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN whatsapp TEXT DEFAULT ''`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN specialty TEXT DEFAULT ''`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN is_faculty INTEGER DEFAULT 0`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN grade TEXT DEFAULT ''`, () => {});

  db.run(`CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    grade_score REAL,
    feedback TEXT DEFAULT '',
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(material_id, student_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL DEFAULT 'Particulares',
    description TEXT,
    schedule TEXT DEFAULT '',
    created_by INTEGER
  )`);

  db.run(`ALTER TABLE groups ADD COLUMN category TEXT NOT NULL DEFAULT 'Particulares'`, () => {});
  db.run(`ALTER TABLE groups ADD COLUMN description TEXT`, () => {});
  db.run(`ALTER TABLE groups ADD COLUMN schedule TEXT DEFAULT ''`, () => {});
  db.run(`ALTER TABLE groups ADD COLUMN created_by INTEGER`, () => {});

  // Tabla relacional para permitir que un estudiante pertenezca a varios subgrupos a la vez
  db.run(`CREATE TABLE IF NOT EXISTS student_groups (
    student_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    PRIMARY KEY (student_id, group_id)
  )`);

  // Migrar group_id existente hacia student_groups sin perder datos
  db.run(`INSERT OR IGNORE INTO student_groups (student_id, group_id)
          SELECT id, group_id FROM users WHERE role = 'student' AND group_id IS NOT NULL`, () => {});

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
        `INSERT INTO users (code, full_name, password_hash, role, specialty, bio, is_faculty) VALUES (?, ?, ?, 'admin', 'Dirección y Docencia', 'Fundador y docente de DC CORP y Sol Music.', 1)`,
        [adminCode, 'Víctor Samuel Castro Delgado', hash]
      );
      console.log('Admin inicializado -> Usuario: admin | Clave: DcCorp2026!');
  db.run(`UPDATE users SET is_faculty = 1 WHERE role = 'admin'`, () => {});
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

function syncStudentGroups(studentId, groupIds, primaryGroupId, cb) {
  const cleanIds = Array.from(new Set((groupIds || []).map(Number).filter(n => n > 0)));
  if (primaryGroupId && !cleanIds.includes(Number(primaryGroupId))) {
    cleanIds.unshift(Number(primaryGroupId));
  }
  const mainGroup = cleanIds.length ? cleanIds[0] : (primaryGroupId || null);

  db.serialize(() => {
    db.run(`UPDATE users SET group_id = ? WHERE id = ?`, [mainGroup, studentId]);
    db.run(`DELETE FROM student_groups WHERE student_id = ?`, [studentId], () => {
      if (!cleanIds.length) return cb();
      const stmt = db.prepare(`INSERT OR IGNORE INTO student_groups (student_id, group_id) VALUES (?, ?)`);
      cleanIds.forEach(gid => stmt.run(studentId, gid));
      stmt.finalize(() => cb());
    });
  });
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

// ================= GRUPOS Y SUBGRUPOS (CREAR, EDITAR, ELIMINAR Y CONTEO) =================
app.get('/intranet/api/admin/groups', authMiddleware, staffOnly, (req, res) => {
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

app.post('/intranet/api/admin/groups', authMiddleware, staffOnly, (req, res) => {
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

app.put('/intranet/api/admin/groups/:id', authMiddleware, staffOnly, (req, res) => {
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

app.delete('/intranet/api/admin/groups/:id', authMiddleware, staffOnly, (req, res) => {
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
app.get('/intranet/api/admin/teachers', authMiddleware, adminOnly, (req, res) => {
  db.all(
    `SELECT id, code, full_name, role, plain_hint, bio, avatar_file, whatsapp, specialty, is_faculty
     FROM users
     WHERE role = 'teacher' OR role = 'admin'
     ORDER BY role ASC, full_name ASC`,
    [],
    (err, teachers) => res.json(teachers || [])
  );
});

app.post('/intranet/api/admin/teachers', authMiddleware, adminOnly, (req, res) => {
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
app.put('/intranet/api/admin/teachers/:id', authMiddleware, adminOnly, (req, res) => {
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
app.post('/intranet/api/admin/teachers/:id/avatar', authMiddleware, adminOnly, uploadAvatar.single('avatar'), (req, res) => {
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

app.delete('/intranet/api/admin/teachers/:id', authMiddleware, adminOnly, (req, res) => {
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

// ================= ESTUDIANTES (SOPORTE MÚLTIPLES SUBGRUPOS) =================
function attachGroupsToStudents(rows, cb) {
  if (!rows || !rows.length) return cb([]);
  const ids = rows.map(r => r.id);
  const placeholders = ids.map(() => '?').join(',');
  db.all(
    `SELECT sg.student_id, g.id, g.name, g.category, g.schedule
     FROM student_groups sg
     INNER JOIN groups g ON g.id = sg.group_id
     WHERE sg.student_id IN (${placeholders})`,
    ids,
    (err, links) => {
      const mapByStu = {};
      (links || []).forEach(l => {
        if (!mapByStu[l.student_id]) mapByStu[l.student_id] = [];
        mapByStu[l.student_id].push(l);
      });

      const enriched = rows.map(r => {
        let gList = mapByStu[r.id] || [];
        if (!gList.length && r.group_id) {
          gList = [{ student_id: r.id, id: r.group_id, name: r.group_name || 'Sin grupo', category: r.category || 'Particulares' }];
        }
        return {
          ...r,
          groups: gList,
          group_ids: gList.map(x => Number(x.id)),
          group_names: gList.map(x => x.name).join(', ')
        };
      });
      cb(enriched);
    }
  );
}

app.get('/intranet/api/admin/students', authMiddleware, staffOnly, (req, res) => {
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

app.post('/intranet/api/admin/students', authMiddleware, staffOnly, (req, res) => {
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

app.put('/intranet/api/admin/students/:id', authMiddleware, staffOnly, (req, res) => {
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

app.delete('/intranet/api/admin/students/:id', authMiddleware, staffOnly, (req, res) => {
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

// ================= ASISTENCIA SEMANAL GRÁFICA (SOPORTE MÚLTIPLES SUBGRUPOS) =================
app.get('/intranet/api/admin/weekly-attendance', authMiddleware, staffOnly, (req, res) => {
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
                 AND a2.status IN ('Presente', 'Tardanza', 'Justificado')) AS used_this_month
       FROM users u
       LEFT JOIN student_groups sg ON sg.student_id = u.id
       WHERE u.role = 'student' AND (sg.group_id = ? OR u.group_id = ?)
       ORDER BY u.full_name ASC`,
      [monthPrefix, group_id, group_id],
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
       WHERE a.date = ? AND (gMain.category = 'Sol Music' OR gSub.category = 'Sol Music')
       ORDER BY g.name ASC, u.full_name ASC`,
      [monthPrefix, date],
      (err, rows) => res.json({ date, records: rows || [] })
    );
  }
});

// ================= MATERIALES MÚLTIPLES, EDICIÓN Y CONSULTAS EN TIEMPO REAL =================
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
              const subsByMat = {};
              (allSubs || []).forEach(s => {
                if (!subsByMat[s.material_id]) subsByMat[s.material_id] = [];
                subsByMat[s.material_id].push(s);
              });
              res.json(enriched.map(m => ({
                ...m,
                consultas: byMat[m.id] || [],
                submissions: subsByMat[m.id] || []
              })));
            }
          );
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

app.put('/intranet/api/admin/materials/:id', authMiddleware, staffOnly, upload.array('files', 30), (req, res) => {
  const materialId = req.params.id;
  const { title, description, external_url, deleted_file_ids, updated_files_meta, labels } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'El título es obligatorio' });
  }

  db.get(`SELECT id, group_id FROM materials WHERE id = ?`, [materialId], (err, mat) => {
    if (err || !mat) return res.status(404).json({ error: 'Material no encontrado' });

    verifyGroupAccess(req.user, mat.group_id, (allowed) => {
      if (!allowed) return res.status(403).json({ error: 'Sin permiso sobre este material' });

      db.run(
        `UPDATE materials SET title = ?, description = ?, external_url = ? WHERE id = ?`,
        [title.trim(), (description || '').trim(), (external_url || '').trim(), materialId],
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


// ================= ENTREGAS DE RESOLUCIONES (ALUMNO) Y CALIFICACIÓN 0-20 (DOCENTE/ADMIN) =================
app.post('/intranet/api/student/materials/:id/submission', authMiddleware, upload.single('resolution'), (req, res) => {
  const matId = Number(req.params.id);
  if (!req.file) return res.status(400).json({ error: 'Adjunta tu archivo de resolución (PDF o imagen)' });

  db.get(`SELECT id, file_name FROM submissions WHERE material_id = ? AND student_id = ?`, [matId, req.user.id], (err, existing) => {
    if (existing && existing.file_name) {
      const oldP = path.join(uploadsDir, existing.file_name);
      if (fs.existsSync(oldP)) fs.unlinkSync(oldP);
    }

    db.run(
      `INSERT INTO submissions (material_id, student_id, file_name, original_name, grade_score, feedback, submitted_at)
       VALUES (?, ?, ?, ?, NULL, '', CURRENT_TIMESTAMP)
       ON CONFLICT(material_id, student_id) DO UPDATE SET
         file_name = excluded.file_name,
         original_name = excluded.original_name,
         submitted_at = CURRENT_TIMESTAMP`,
      [matId, req.user.id, req.file.filename, req.file.originalname],
      function (err2) {
        if (err2) return res.status(500).json({ error: 'Error guardando la resolución' });
        res.json({
          ok: true,
          submission: {
            id: existing ? existing.id : this.lastID,
            material_id: matId,
            student_id: req.user.id,
            file_name: req.file.filename,
            original_name: req.file.originalname,
            grade_score: null,
            feedback: '',
            submitted_at: new Date().toISOString()
          }
        });
      }
    );
  });
});

app.post('/intranet/api/admin/submissions/:subId/grade', authMiddleware, staffOnly, (req, res) => {
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
      res.json({ ok: true, grade_score: numScore, feedback: (feedback || '').trim() });
    }
  );
});

// ================= PORTAL DEL ESTUDIANTE (SOPORTE MÚLTIPLES SUBGRUPOS) =================
app.get('/intranet/api/student/dashboard', authMiddleware, (req, res) => {
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
                `SELECT id, title, description, file_name, original_name, external_url, created_at
                 FROM materials WHERE group_id = ? ORDER BY created_at DESC`,
                [activeGroupId],
                (err3, materials) => {
                  attachFilesToMaterials(materials || [], (enrichedMats) => {
                    const stuCat = activeStudentView.category || 'Particulares';
                    const finishPayload = (matsWithNotes) => {
                      db.all(
                        `SELECT * FROM announcements WHERE target_category IN ('Todos', ?) ORDER BY created_at DESC LIMIT 5`,
                        [stuCat],
                        (err5, anns) => {
                          db.all(
                            `SELECT DISTINCT u.id, u.full_name, u.schedule, u.bio, u.avatar_file, u.instrument
                             FROM users u
                             LEFT JOIN student_groups sg ON sg.student_id = u.id
                             WHERE u.role = 'student' AND (sg.group_id = ? OR u.group_id = ?)
                             ORDER BY u.full_name ASC`,
                            [activeGroupId, activeGroupId],
                            (err6, classmates) => {
                              res.json({
                                student: activeStudentView,
                                enrolledGroups: myGroups,
                                classmates: classmates || [],
                                announcements: anns || [],
                                attendances: attendances || [],
                                materials: matsWithNotes
                              });
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
                            const subByMat = {};
                            (subs || []).forEach(sb => { subByMat[sb.material_id] = sb; });
                            finishPayload(enrichedMats.map(m => ({
                              ...m,
                              notes: byMat[m.id] || [],
                              submission: subByMat[m.id] || null
                            })));
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
