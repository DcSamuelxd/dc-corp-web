const express = require('express');
const path = require('path');
const { PORT } = require('./lib/config');
require('./lib/db');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const attendanceRoutes = require('./routes/attendance');
const materialsRoutes = require('./routes/materials');
const notificationsRoutes = require('./routes/notifications');
const messagesRoutes = require('./routes/messages');
const { startReminderScheduler } = require('./lib/notifications');

const app = express();
app.use(express.json());

// Redirecciones de URLs antiguas .html a rutas limpias
app.get('/intranet/admin.html', (req, res) => res.redirect(301, '/intranet/panel'));
app.get('/intranet/student.html', (req, res) => res.redirect(301, '/intranet/estudiante'));
app.get('/intranet/login.html', (req, res) => res.redirect(301, '/intranet'));

app.use('/intranet', express.static(path.join(__dirname, 'public')));

app.use(authRoutes);
app.use(usersRoutes);
app.use(attendanceRoutes);
app.use(materialsRoutes);
app.use(notificationsRoutes);
app.use(messagesRoutes);

startReminderScheduler();

app.get('/intranet', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/intranet/panel', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/intranet/estudiante', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student.html'));
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Intranet DC CORP corriendo en http://127.0.0.1:${PORT}/intranet`);
});
