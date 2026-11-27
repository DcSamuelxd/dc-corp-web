const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../lib/config");
const { db } = require("../lib/db");
const { authMiddleware } = require("../lib/auth");
const { sseClients } = require("../lib/sse");

const router = express.Router();

// ================= CANAL SSE TIEMPO REAL (CHAT CONSULTAS) =================
router.get('/intranet/api/chat/stream', authMiddleware, (req, res) => {
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

// ================= AUTENTICACIÓN (CON LÍMITE ANTI-FUERZA BRUTA) =================
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

router.post('/intranet/api/login', (req, res) => {
  const ip = getClientIp(req);
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (rec && now < rec.resetAt && rec.count >= LOGIN_MAX_FAILS) {
    return res.status(429).json({ error: 'Demasiados intentos fallidos. Espera 15 minutos.' });
  }

  const { code, password } = req.body;
  if (!code || !password) return res.status(400).json({ error: 'Completa usuario y contraseña' });

  db.get(`SELECT * FROM users WHERE LOWER(code) = LOWER(?)`, [code.trim()], (err, user) => {
    const recordFail = () => {
      const current = loginAttempts.get(ip);
      if (!current || now >= current.resetAt) {
        loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
      } else {
        current.count += 1;
      }
    };

    if (err || !user) {
      recordFail();
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    if (!bcrypt.compareSync(password, user.password_hash)) {
      recordFail();
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    loginAttempts.delete(ip);
    const token = jwt.sign(
      { id: user.id, code: user.code, full_name: user.full_name, role: user.role, group_id: user.group_id },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, role: user.role, full_name: user.full_name });
  });
});

router.post('/intranet/api/change-password', authMiddleware, (req, res) => {
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


module.exports = router;
