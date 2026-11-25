const express = require('express');
const path = require('path');
const { PORT } = require('./lib/config');
require('./lib/db');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const attendanceRoutes = require('./routes/attendance');
const materialsRoutes = require('./routes/materials');

const app = express();
app.use(express.json());
app.use('/intranet', express.static(path.join(__dirname, 'public')));

app.use(authRoutes);
app.use(usersRoutes);
app.use(attendanceRoutes);
app.use(materialsRoutes);

app.get('/intranet', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Intranet DC CORP corriendo en http://127.0.0.1:${PORT}/intranet`);
});
