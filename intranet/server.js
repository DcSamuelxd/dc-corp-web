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

// Directorios persistentes (ignorados en git)
const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use(express.json());
app.use('/intranet', express.static(path.join(__dirname, 'public')));

// Configuración de subida de archivos (PDF, Word, Excel, Audio, Partituras, Imágenes)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safeName = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safeName);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // hasta 50MB

// Inicialización de Base de Datos SQLite
const db = new sqlite3.Database(path.join(dataDir, 'intranet.db'));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'student',
    group_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    status TEXT NOT NULL,
    note TEXT,
    UNIQUE(student_id, date)
  )`);

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

  // Crear usuario administrador por defecto si no existe
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

// Middlewares de Seguridad
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

// ================= RUTAS DE AUTENTICACIÓN =================
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

// ================= RUTAS DE ADMINISTRADOR =================
app.get('/intranet/api/admin/groups', authMiddleware, adminOnly, (req, res) => {
  db.all(`SELECT * FROM groups ORDER BY name ASC`, [], (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/intranet/api/admin/groups', authMiddleware, adminOnly, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre del grupo es obligatorio' });
  db.run(`INSERT INTO groups (name, description) VALUES (?, ?)`, [name.trim(), description || ''], function (err) {
    if (err) return res.status(400).json({ error: 'Ya existe un grupo con ese nombre' });
    res.json({ id: this.lastID, name: name.trim(), description });
  });
});

app.delete('/intranet/api/admin/groups/:id', authMiddleware, adminOnly, (req, res) => {
  db.run(`DELETE FROM groups WHERE id = ?`, [req.params.id], () => res.json({ ok: true }));
});

app.get('/intranet/api/admin/students', authMiddleware, adminOnly, (req, res) => {
  const groupId = req.query.group_id;
  let sql = `SELECT u.id, u.code, u.full_name, u.group_id, g.name AS group_name
             FROM users u LEFT JOIN groups g ON u.group_id = g.id
             WHERE u.role = 'student'`;
  const params = [];
  if (groupId) {
    sql += ` AND u.group_id = ?`;
    params.push(groupId);
  }
  sql += ` ORDER BY u.full_name ASC`;
  db.all(sql, params, (err, rows) => res.json(rows || []));
});

app.post('/intranet/api/admin/students', authMiddleware, adminOnly, (req, res) => {
  const { code, full_name, password, group_id } = req.body;
  if (!code || !full_name || !password || !group_id) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }
  const hash = bcrypt.hashSync(password, 10);
  db.run(
    `INSERT INTO users (code, full_name, password_hash, role, group_id) VALUES (?, ?, ?, 'student', ?)`,
    [code.trim(), full_name.trim(), hash, group_id],
    function (err) {
      if (err) return res.status(400).json({ error: 'Ese código/usuario ya está registrado' });
      res.json({ id: this.lastID });
    }
  );
});

app.delete('/intranet/api/admin/students/:id', authMiddleware, adminOnly, (req, res) => {
  db.run(`DELETE FROM users WHERE id = ? AND role = 'student'`, [req.params.id], () => {
    db.run(`DELETE FROM attendance WHERE student_id = ?`, [req.params.id], () => res.json({ ok: true }));
  });
});

// Obtener asistencias de un grupo y fecha
app.get('/intranet/api/admin/attendance', authMiddleware, adminOnly, (req, res) => {
  const { group_id, date } = req.query;
  if (!group_id || !date) return res.status(400).json({ error: 'Falta grupo o fecha' });
  db.all(
    `SELECT u.id AS student_id, u.code, u.full_name, a.status, a.note
     FROM users u
     LEFT JOIN attendance a ON u.id = a.student_id AND a.date = ?
     WHERE u.role = 'student' AND u.group_id = ?
     ORDER BY u.full_name ASC`,
    [date, group_id],
    (err, rows) => res.json(rows || [])
  );
});

// Guardar asistencias en bloque
app.post('/intranet/api/admin/attendance', authMiddleware, adminOnly, (req, res) => {
  const { group_id, date, records } = req.body;
  if (!group_id || !date || !Array.isArray(records)) {
    return res.status(400).json({ error: 'Datos de asistencia incompletos' });
  }
  const stmt = db.prepare(`
    INSERT INTO attendance (student_id, group_id, date, status, note)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status, note = excluded.note, group_id = excluded.group_id
  `);
  records.forEach(r => {
    stmt.run(r.student_id, group_id, date, r.status, r.note || '');
  });
  stmt.finalize((err) => {
    if (err) return res.status(500).json({ error: 'Error guardando asistencias' });
    res.json({ ok: true });
  });
});

// Materiales (listar, subir archivo desde dashboard y eliminar)
app.get('/intranet/api/admin/materials', authMiddleware, adminOnly, (req, res) => {
  db.all(
    `SELECT m.*, g.name AS group_name FROM materials m
     LEFT JOIN groups g ON m.group_id = g.id
     ORDER BY m.created_at DESC`,
    [],
    (err, rows) => res.json(rows || [])
  );
});

app.post('/intranet/api/admin/materials', authMiddleware, adminOnly, upload.single('file'), (req, res) => {
  const { group_id, title, description, external_url } = req.body;
  if (!group_id || !title) return res.status(400).json({ error: 'Grupo y título son obligatorios' });

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

app.delete('/intranet/api/admin/materials/:id', authMiddleware, adminOnly, (req, res) => {
  db.get(`SELECT file_name FROM materials WHERE id = ?`, [req.params.id], (err, row) => {
    if (row && row.file_name) {
      const fPath = path.join(uploadsDir, row.file_name);
      if (fs.existsSync(fPath)) fs.unlinkSync(fPath);
    }
    db.run(`DELETE FROM materials WHERE id = ?`, [req.params.id], () => res.json({ ok: true }));
  });
});

// ================= RUTAS DEL ESTUDIANTE =================
app.get('/intranet/api/student/dashboard', authMiddleware, (req, res) => {
  db.get(
    `SELECT u.id, u.code, u.full_name, u.group_id, g.name AS group_name, g.description AS group_desc
     FROM users u LEFT JOIN groups g ON u.group_id = g.id WHERE u.id = ?`,
    [req.user.id],
    (err, student) => {
      if (!student) return res.status(404).json({ error: 'Estudiante no encontrado' });

      db.all(
        `SELECT date, status, note FROM attendance WHERE student_id = ? ORDER BY date DESC`,
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

// Descarga protegida de materiales (requiere sesión válida)
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
