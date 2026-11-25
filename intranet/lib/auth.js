const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./config');

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

module.exports = { authMiddleware, adminOnly, staffOnly };
