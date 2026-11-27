const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');
const { dataDir } = require('./config');

const db = new sqlite3.Database(path.join(dataDir, 'intranet.db'));

db.serialize(() => {
  db.run(`PRAGMA journal_mode = WAL`);
  db.run(`PRAGMA synchronous = NORMAL`);
  db.run(`PRAGMA busy_timeout = 5000`);
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

  db.run(`CREATE TABLE IF NOT EXISTS submission_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_type TEXT NOT NULL DEFAULT 'image'
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

  db.run(`CREATE TABLE IF NOT EXISTS student_groups (
    student_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    PRIMARY KEY (student_id, group_id)
  )`);

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
    departure_time TEXT DEFAULT '',
    UNIQUE(student_id, date, session_type)
  )`);
  db.run(`ALTER TABLE attendance ADD COLUMN departure_time TEXT DEFAULT ''`, () => {});

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
    publish_format TEXT NOT NULL DEFAULT 'music',
    evaluation_enabled INTEGER NOT NULL DEFAULT 1,
    target_grade TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`ALTER TABLE materials ADD COLUMN publish_format TEXT NOT NULL DEFAULT 'music'`, () => {});
  db.run(`ALTER TABLE materials ADD COLUMN evaluation_enabled INTEGER NOT NULL DEFAULT 1`, () => {});
  db.run(`ALTER TABLE materials ADD COLUMN target_grade TEXT DEFAULT ''`, () => {});

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

  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'info',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    link_hash TEXT DEFAULT '',
    reference_id INTEGER,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, is_read, created_at DESC)`);

  db.run(`CREATE TABLE IF NOT EXISTS student_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_student_messages_pair ON student_messages (sender_id, receiver_id, created_at DESC)`);

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

  // --- Módulo DC CORP TI, Redes & Facturación ---
  db.run(`CREATE TABLE IF NOT EXISTS ti_clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    subtitle TEXT DEFAULT '',
    ruc_dni TEXT DEFAULT '',
    location TEXT DEFAULT '',
    contact_name TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    share_token TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ti_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    asset_code TEXT DEFAULT '',
    category TEXT NOT NULL DEFAULT 'PC',
    name TEXT NOT NULL,
    brand_model TEXT DEFAULT '',
    serial_number TEXT DEFAULT '',
    area_level TEXT DEFAULT '',
    network_info TEXT DEFAULT '',
    specs TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Operativo',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ti_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    asset_id INTEGER,
    order_type TEXT NOT NULL DEFAULT 'Reparación',
    ref_code TEXT DEFAULT '',
    act_code TEXT DEFAULT '',
    area_level TEXT DEFAULT '',
    title TEXT NOT NULL,
    diagnosis TEXT DEFAULT '',
    work_done TEXT DEFAULT '',
    parts_used TEXT DEFAULT '',
    warranty_months INTEGER DEFAULT 6,
    subtotal REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Completado',
    service_date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ti_evidences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    asset_id INTEGER,
    order_id INTEGER,
    stage TEXT NOT NULL DEFAULT 'Después',
    caption TEXT DEFAULT '',
    file_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_type TEXT NOT NULL DEFAULT 'image',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ti_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_type TEXT NOT NULL DEFAULT 'RECIBO DE CAJA / EGRESO',
    doc_number TEXT UNIQUE NOT NULL,
    issue_date TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'Soles Peruanos (S/)',
    client_id INTEGER,
    client_name TEXT NOT NULL,
    client_subtitle TEXT DEFAULT '',
    client_location TEXT DEFAULT '',
    general_concept TEXT NOT NULL,
    concept_subtitle TEXT DEFAULT '',
    actas_ref TEXT DEFAULT '',
    items_json TEXT NOT NULL DEFAULT '[]',
    total_amount REAL NOT NULL DEFAULT 0,
    amount_words TEXT DEFAULT '',
    payment_method TEXT DEFAULT 'Pago al contado / Transferencia contra entrega de conformidad.',
    warranty_text TEXT DEFAULT '',
    conformity_text TEXT DEFAULT '',
    sign_client_title TEXT DEFAULT 'POR CLIENTE / ENTIDAD (ENTREGUÉ CONFORME)',
    sign_client_sub TEXT DEFAULT 'Representante / Solicitante',
    sign_vb_title TEXT DEFAULT 'V.° B.° DIRECCIÓN / CONFORMIDAD',
    sign_vb_sub TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Emitido',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // --- Control de Mensualidades e Ingresos Academia ---
  db.run(`CREATE TABLE IF NOT EXISTS student_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    month_key TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Pagado',
    note TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, month_key)
  )`);

  // --- Índices de rendimiento para VPS 1x1 ---
  db.run(`CREATE INDEX IF NOT EXISTS idx_att_group_date ON attendance (group_id, date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sg_group ON student_groups (group_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sub_mat_stu ON submissions (material_id, student_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_notif_user_type ON notifications (user_id, type, reference_id)`);

  // --- Historial de Chats WhatsApp ---
  db.run(`CREATE TABLE IF NOT EXISTS wa_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    peer_phone TEXT NOT NULL,
    peer_name TEXT DEFAULT '',
    direction TEXT NOT NULL DEFAULT 'in',
    body TEXT NOT NULL DEFAULT '',
    wa_msg_id TEXT DEFAULT '',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_wa_messages_peer ON wa_messages (peer_phone, created_at DESC)`);
});

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

function attachFilesToSubmissions(subs, cb) {
  if (!subs || !subs.length) return cb([]);
  const subIds = subs.map(s => s.id);
  const placeholders = subIds.map(() => '?').join(',');
  db.all(
    `SELECT * FROM submission_files WHERE submission_id IN (${placeholders}) ORDER BY id ASC`,
    subIds,
    (err, fRows) => {
      const bySub = {};
      (fRows || []).forEach(fr => {
        if (!bySub[fr.submission_id]) bySub[fr.submission_id] = [];
        bySub[fr.submission_id].push(fr);
      });
      cb(subs.map(s => {
        let fl = bySub[s.id] || [];
        if (!fl.length && s.file_name) {
          const ext = path.extname(s.original_name || '').toLowerCase();
          const ft = ext === '.pdf' ? 'pdf' : 'image';
          fl = [{ id: s.id, submission_id: s.id, file_name: s.file_name, original_name: s.original_name, file_type: ft }];
        }
        return { ...s, files: fl };
      }));
    }
  );
}

module.exports = {
  db,
  verifyGroupAccess,
  syncStudentGroups,
  attachGroupsToStudents,
  attachFilesToMaterials,
  attachFilesToSubmissions
};
