const express = require('express');
const { db } = require('../lib/db');
const { authMiddleware, adminOnly } = require('../lib/auth');
const { broadcastToUser, broadcastToRole } = require('../lib/sse');
const { createNotification } = require('../lib/notifications');

const router = express.Router();

// Lista de compañeros disponibles para chatear (del mismo grupo o toda la comunidad Sol Music)
router.get('/intranet/api/student/messages/peers', authMiddleware, (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Solo para estudiantes' });
  const myId = Number(req.user.id);

  db.all(
    `SELECT DISTINCT g.id, g.category FROM groups g
     LEFT JOIN student_groups sg ON sg.group_id = g.id
     LEFT JOIN users u ON u.id = ?
     WHERE sg.student_id = ? OR u.group_id = g.id`,
    [myId, myId],
    (err, myGroups) => {
      const groupIds = (myGroups || []).map(g => g.id);
      const isSolMusic = (myGroups || []).some(g => g.category === 'Sol Music');

      if (!groupIds.length && !isSolMusic) return res.json([]);

      let peerSql = '';
      let peerParams = [];
      if (isSolMusic) {
        peerSql = `SELECT DISTINCT u.id, u.full_name, u.avatar_file, u.instrument, u.grade, g.category
                   FROM users u
                   LEFT JOIN student_groups sg ON sg.student_id = u.id
                   LEFT JOIN groups g ON g.id = COALESCE(sg.group_id, u.group_id)
                   WHERE u.role = 'student' AND u.id != ?
                     AND (g.category = 'Sol Music'${groupIds.length ? ` OR g.id IN (${groupIds.map(() => '?').join(',')})` : ''})
                   ORDER BY u.full_name ASC`;
        peerParams = [myId, ...groupIds];
      } else {
        const placeholders = groupIds.map(() => '?').join(',');
        peerSql = `SELECT DISTINCT u.id, u.full_name, u.avatar_file, u.instrument, u.grade, g.category
                   FROM users u
                   LEFT JOIN student_groups sg ON sg.student_id = u.id
                   LEFT JOIN groups g ON g.id = COALESCE(sg.group_id, u.group_id)
                   WHERE u.role = 'student' AND u.id != ?
                     AND (sg.group_id IN (${placeholders}) OR u.group_id IN (${placeholders}))
                   ORDER BY u.full_name ASC`;
        peerParams = [myId, ...groupIds, ...groupIds];
      }

      db.all(peerSql, peerParams, (err2, peers) => {
        if (err2 || !peers) return res.json([]);
        const uniqueMap = new Map();
        peers.forEach(p => { if (!uniqueMap.has(p.id)) uniqueMap.set(p.id, p); });
        const uniquePeers = Array.from(uniqueMap.values());

        db.all(
          `SELECT sender_id, receiver_id, content, is_read, created_at
           FROM student_messages
           WHERE sender_id = ? OR receiver_id = ?
           ORDER BY created_at DESC, id DESC`,
          [myId, myId],
          (err3, msgs) => {
            const metaByPeer = {};
            (msgs || []).forEach(m => {
              const peerId = Number(m.sender_id) === myId ? Number(m.receiver_id) : Number(m.sender_id);
              if (!metaByPeer[peerId]) {
                metaByPeer[peerId] = { last_message: m.content, last_at: m.created_at, unread_count: 0 };
              }
              if (Number(m.receiver_id) === myId && !m.is_read) {
                metaByPeer[peerId].unread_count += 1;
              }
            });

            const enriched = uniquePeers.map(p => ({
              ...p,
              ...(metaByPeer[p.id] || { last_message: '', last_at: null, unread_count: 0 })
            }));
            enriched.sort((a, b) => {
              if (a.last_at && b.last_at) return new Date(b.last_at) - new Date(a.last_at);
              if (a.last_at) return -1;
              if (b.last_at) return 1;
              return a.full_name.localeCompare(b.full_name);
            });
            res.json(enriched);
          }
        );
      });
    }
  );
});

// Historial con un compañero específico
router.get('/intranet/api/student/messages/:peerId', authMiddleware, (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Solo para estudiantes' });
  const myId = Number(req.user.id);
  const peerId = Number(req.params.peerId);
  if (!peerId) return res.status(400).json({ error: 'Destinatario inválido' });

  db.run(
    `UPDATE student_messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ? AND is_read = 0`,
    [peerId, myId],
    () => {
      db.all(
        `SELECT sm.*, u.full_name AS sender_name
         FROM student_messages sm
         INNER JOIN users u ON u.id = sm.sender_id
         WHERE (sm.sender_id = ? AND sm.receiver_id = ?) OR (sm.sender_id = ? AND sm.receiver_id = ?)
         ORDER BY sm.created_at ASC, sm.id ASC LIMIT 120`,
        [myId, peerId, peerId, myId],
        (err, rows) => {
          res.json(rows || []);
        }
      );
    }
  );
});

// Enviar mensaje a otro estudiante (tiempo real + visible para Admin)
router.post('/intranet/api/student/messages/:peerId', authMiddleware, (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Solo para estudiantes' });
  const myId = Number(req.user.id);
  const peerId = Number(req.params.peerId);
  const content = (req.body && req.body.content ? String(req.body.content) : '').trim();
  if (!peerId || !content) return res.status(400).json({ error: 'Escribe un mensaje válido' });
  if (peerId === myId) return res.status(400).json({ error: 'No puedes enviarte mensajes a ti mismo' });

  db.get(`SELECT id, full_name FROM users WHERE id = ? AND role = 'student'`, [peerId], (err, peer) => {
    if (err || !peer) return res.status(404).json({ error: 'Estudiante no encontrado' });

    db.run(
      `INSERT INTO student_messages (sender_id, receiver_id, content) VALUES (?, ?, ?)`,
      [myId, peerId, content.slice(0, 800)],
      function (err2) {
        if (err2) return res.status(500).json({ error: 'Error enviando mensaje' });
        const msgObj = {
          id: this.lastID,
          sender_id: myId,
          receiver_id: peerId,
          sender_name: req.user.full_name,
          receiver_name: peer.full_name,
          content: content.slice(0, 800),
          is_read: 0,
          created_at: new Date().toISOString()
        };

        broadcastToUser(peerId, { type: 'student_dm', message: msgObj });
        broadcastToUser(myId, { type: 'student_dm', message: msgObj });
        broadcastToRole('admin', { type: 'student_dm_audit', message: msgObj });

        createNotification({
          userId: peerId,
          type: 'student_dm',
          title: `Mensaje de ${req.user.full_name}`,
          message: content.slice(0, 120),
          linkHash: '#mensajes',
          referenceId: myId
        });

        res.json(msgObj);
      }
    );
  });
});

// ================= SUPERVISIÓN DE MENSAJES ENTRE ALUMNOS (SOLO ADMIN) =================
router.get('/intranet/api/admin/student-messages', authMiddleware, adminOnly, (req, res) => {
  db.all(
    `SELECT sm.*, u1.full_name AS sender_name, u1.avatar_file AS sender_avatar,
            u2.full_name AS receiver_name, u2.avatar_file AS receiver_avatar
     FROM student_messages sm
     INNER JOIN users u1 ON u1.id = sm.sender_id
     INNER JOIN users u2 ON u2.id = sm.receiver_id
     ORDER BY sm.created_at DESC, sm.id DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Error cargando mensajes' });
      const convMap = new Map();
      (rows || []).forEach(r => {
        const minId = Math.min(r.sender_id, r.receiver_id);
        const maxId = Math.max(r.sender_id, r.receiver_id);
        const key = `${minId}-${maxId}`;
        if (!convMap.has(key)) {
          const isMinSender = r.sender_id === minId;
          convMap.set(key, {
            key,
            user_a_id: minId,
            user_a_name: isMinSender ? r.sender_name : r.receiver_name,
            user_a_avatar: isMinSender ? r.sender_avatar : r.receiver_avatar,
            user_b_id: maxId,
            user_b_name: isMinSender ? r.receiver_name : r.sender_name,
            user_b_avatar: isMinSender ? r.receiver_avatar : r.sender_avatar,
            last_message: r.content,
            last_sender_name: r.sender_name,
            last_at: r.created_at,
            total_messages: 1
          });
        } else {
          convMap.get(key).total_messages += 1;
        }
      });
      res.json(Array.from(convMap.values()));
    }
  );
});

router.get('/intranet/api/admin/student-messages/:userA/:userB', authMiddleware, adminOnly, (req, res) => {
  const userA = Number(req.params.userA);
  const userB = Number(req.params.userB);
  db.all(
    `SELECT sm.*, u1.full_name AS sender_name, u2.full_name AS receiver_name
     FROM student_messages sm
     INNER JOIN users u1 ON u1.id = sm.sender_id
     INNER JOIN users u2 ON u2.id = sm.receiver_id
     WHERE (sm.sender_id = ? AND sm.receiver_id = ?) OR (sm.sender_id = ? AND sm.receiver_id = ?)
     ORDER BY sm.created_at ASC, sm.id ASC LIMIT 200`,
    [userA, userB, userB, userA],
    (err, rows) => {
      res.json(rows || []);
    }
  );
});

module.exports = router;
