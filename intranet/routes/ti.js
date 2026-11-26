const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, tiDir, uploadTi } = require('../lib/config');
const { db } = require('../lib/db');
const { authMiddleware, adminOnly } = require('../lib/auth');

const router = express.Router();

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function removeTiFile(fileName) {
  if (!fileName) return;
  const full = path.join(tiDir, fileName);
  if (fs.existsSync(full)) {
    fs.unlink(full, () => {});
  }
}

async function computeNextNumber(prefix) {
  const rows = await dbAll(`SELECT doc_number FROM ti_invoices WHERE doc_number LIKE ?`, [`${prefix}%`]);
  let maxSeq = 0;
  for (const r of rows) {
    const m = String(r.doc_number || '').match(/(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxSeq) maxSeq = n;
    }
  }
  return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
}

// Resumen completo para el portal TI (solo Admin)
router.get('/intranet/api/ti/overview', authMiddleware, adminOnly, async (req, res) => {
  try {
    const [clients, assets, orders, evidences, invoices] = await Promise.all([
      dbAll(`SELECT * FROM ti_clients ORDER BY id DESC`),
      dbAll(
        `SELECT a.*, c.name AS client_name
         FROM ti_assets a
         LEFT JOIN ti_clients c ON a.client_id = c.id
         ORDER BY a.id DESC`
      ),
      dbAll(
        `SELECT o.*, c.name AS client_name, a.name AS asset_name, a.asset_code, a.category AS asset_category
         FROM ti_orders o
         LEFT JOIN ti_clients c ON o.client_id = c.id
         LEFT JOIN ti_assets a ON o.asset_id = a.id
         ORDER BY o.service_date DESC, o.id DESC`
      ),
      dbAll(`SELECT * FROM ti_evidences ORDER BY id DESC`),
      dbAll(`SELECT * FROM ti_invoices ORDER BY id DESC`)
    ]);

    const year = new Date().getFullYear();
    const nextRec = await computeNextNumber(`REC-${year}-`);
    const nextEst = await computeNextNumber('EST');

    res.json({
      clients,
      assets,
      orders,
      evidences,
      invoices,
      nextNumbers: { REC: nextRec, EST: nextEst }
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al cargar datos del módulo TI' });
  }
});

// --- CLIENTES ---
router.post('/intranet/api/ti/clients', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, subtitle, ruc_dni, location, contact_name, phone, notes } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre del cliente es obligatorio' });
    const shareToken = crypto.randomBytes(12).toString('hex');
    const result = await dbRun(
      `INSERT INTO ti_clients (name, subtitle, ruc_dni, location, contact_name, phone, notes, share_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name.trim(), (subtitle || '').trim(), (ruc_dni || '').trim(), (location || '').trim(), (contact_name || '').trim(), (phone || '').trim(), (notes || '').trim(), shareToken]
    );
    const created = await dbGet(`SELECT * FROM ti_clients WHERE id = ?`, [result.lastID]);
    res.json(created);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo crear el cliente' });
  }
});

router.put('/intranet/api/ti/clients/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, subtitle, ruc_dni, location, contact_name, phone, notes } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre del cliente es obligatorio' });
    await dbRun(
      `UPDATE ti_clients
       SET name = ?, subtitle = ?, ruc_dni = ?, location = ?, contact_name = ?, phone = ?, notes = ?
       WHERE id = ?`,
      [name.trim(), (subtitle || '').trim(), (ruc_dni || '').trim(), (location || '').trim(), (contact_name || '').trim(), (phone || '').trim(), (notes || '').trim(), Number(req.params.id)]
    );
    const updated = await dbGet(`SELECT * FROM ti_clients WHERE id = ?`, [Number(req.params.id)]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo actualizar el cliente' });
  }
});

router.delete('/intranet/api/ti/clients/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const evs = await dbAll(`SELECT file_name FROM ti_evidences WHERE client_id = ?`, [id]);
    evs.forEach(e => removeTiFile(e.file_name));
    await dbRun(`DELETE FROM ti_evidences WHERE client_id = ?`, [id]);
    await dbRun(`DELETE FROM ti_orders WHERE client_id = ?`, [id]);
    await dbRun(`DELETE FROM ti_assets WHERE client_id = ?`, [id]);
    await dbRun(`DELETE FROM ti_clients WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo eliminar el cliente' });
  }
});

// --- EQUIPOS E INFRAESTRUCTURA / REDES ---
router.post('/intranet/api/ti/assets', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { client_id, asset_code, category, name, brand_model, serial_number, area_level, network_info, specs, status, notes } = req.body;
    if (!client_id || !name || !name.trim()) {
      return res.status(400).json({ error: 'Cliente y nombre del equipo o red son obligatorios' });
    }
    const result = await dbRun(
      `INSERT INTO ti_assets (client_id, asset_code, category, name, brand_model, serial_number, area_level, network_info, specs, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(client_id),
        (asset_code || '').trim(),
        (category || 'PC').trim(),
        name.trim(),
        (brand_model || '').trim(),
        (serial_number || '').trim(),
        (area_level || '').trim(),
        (network_info || '').trim(),
        (specs || '').trim(),
        (status || 'Operativo').trim(),
        (notes || '').trim()
      ]
    );
    const created = await dbGet(
      `SELECT a.*, c.name AS client_name FROM ti_assets a LEFT JOIN ti_clients c ON a.client_id = c.id WHERE a.id = ?`,
      [result.lastID]
    );
    res.json(created);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo registrar el equipo/red' });
  }
});

router.put('/intranet/api/ti/assets/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { client_id, asset_code, category, name, brand_model, serial_number, area_level, network_info, specs, status, notes } = req.body;
    if (!client_id || !name || !name.trim()) {
      return res.status(400).json({ error: 'Cliente y nombre del equipo o red son obligatorios' });
    }
    await dbRun(
      `UPDATE ti_assets
       SET client_id = ?, asset_code = ?, category = ?, name = ?, brand_model = ?, serial_number = ?, area_level = ?, network_info = ?, specs = ?, status = ?, notes = ?
       WHERE id = ?`,
      [
        Number(client_id),
        (asset_code || '').trim(),
        (category || 'PC').trim(),
        name.trim(),
        (brand_model || '').trim(),
        (serial_number || '').trim(),
        (area_level || '').trim(),
        (network_info || '').trim(),
        (specs || '').trim(),
        (status || 'Operativo').trim(),
        (notes || '').trim(),
        Number(req.params.id)
      ]
    );
    const updated = await dbGet(
      `SELECT a.*, c.name AS client_name FROM ti_assets a LEFT JOIN ti_clients c ON a.client_id = c.id WHERE a.id = ?`,
      [Number(req.params.id)]
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo actualizar el equipo/red' });
  }
});

router.delete('/intranet/api/ti/assets/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const evs = await dbAll(`SELECT file_name FROM ti_evidences WHERE asset_id = ?`, [id]);
    evs.forEach(e => removeTiFile(e.file_name));
    await dbRun(`DELETE FROM ti_evidences WHERE asset_id = ?`, [id]);
    await dbRun(`UPDATE ti_orders SET asset_id = NULL WHERE asset_id = ?`, [id]);
    await dbRun(`DELETE FROM ti_assets WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo eliminar el equipo/red' });
  }
});

// --- ÓRDENES / HISTORIAL DE REPARACIONES E INSTALACIONES ---
router.post('/intranet/api/ti/orders', authMiddleware, adminOnly, async (req, res) => {
  try {
    const {
      client_id, asset_id, order_type, ref_code, act_code, area_level,
      title, diagnosis, work_done, parts_used, warranty_months, subtotal, status, service_date
    } = req.body;
    if (!client_id || !title || !title.trim()) {
      return res.status(400).json({ error: 'Cliente y título del trabajo son obligatorios' });
    }
    const today = new Date().toISOString().slice(0, 10);
    const result = await dbRun(
      `INSERT INTO ti_orders (client_id, asset_id, order_type, ref_code, act_code, area_level, title, diagnosis, work_done, parts_used, warranty_months, subtotal, status, service_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(client_id),
        asset_id ? Number(asset_id) : null,
        (order_type || 'Reparación').trim(),
        (ref_code || '').trim(),
        (act_code || '').trim(),
        (area_level || '').trim(),
        title.trim(),
        (diagnosis || '').trim(),
        (work_done || '').trim(),
        (parts_used || '').trim(),
        Number(warranty_months ?? 6),
        Number(subtotal || 0),
        (status || 'Completado').trim(),
        (service_date || today).trim()
      ]
    );
    const created = await dbGet(
      `SELECT o.*, c.name AS client_name, a.name AS asset_name, a.asset_code, a.category AS asset_category
       FROM ti_orders o
       LEFT JOIN ti_clients c ON o.client_id = c.id
       LEFT JOIN ti_assets a ON o.asset_id = a.id
       WHERE o.id = ?`,
      [result.lastID]
    );
    res.json(created);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo registrar la orden de trabajo' });
  }
});

router.put('/intranet/api/ti/orders/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const {
      client_id, asset_id, order_type, ref_code, act_code, area_level,
      title, diagnosis, work_done, parts_used, warranty_months, subtotal, status, service_date
    } = req.body;
    if (!client_id || !title || !title.trim()) {
      return res.status(400).json({ error: 'Cliente y título del trabajo son obligatorios' });
    }
    await dbRun(
      `UPDATE ti_orders
       SET client_id = ?, asset_id = ?, order_type = ?, ref_code = ?, act_code = ?, area_level = ?,
           title = ?, diagnosis = ?, work_done = ?, parts_used = ?, warranty_months = ?, subtotal = ?, status = ?, service_date = ?
       WHERE id = ?`,
      [
        Number(client_id),
        asset_id ? Number(asset_id) : null,
        (order_type || 'Reparación').trim(),
        (ref_code || '').trim(),
        (act_code || '').trim(),
        (area_level || '').trim(),
        title.trim(),
        (diagnosis || '').trim(),
        (work_done || '').trim(),
        (parts_used || '').trim(),
        Number(warranty_months ?? 6),
        Number(subtotal || 0),
        (status || 'Completado').trim(),
        (service_date || new Date().toISOString().slice(0, 10)).trim(),
        Number(req.params.id)
      ]
    );
    const updated = await dbGet(
      `SELECT o.*, c.name AS client_name, a.name AS asset_name, a.asset_code, a.category AS asset_category
       FROM ti_orders o
       LEFT JOIN ti_clients c ON o.client_id = c.id
       LEFT JOIN ti_assets a ON o.asset_id = a.id
       WHERE o.id = ?`,
      [Number(req.params.id)]
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo actualizar la orden de trabajo' });
  }
});

router.delete('/intranet/api/ti/orders/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const evs = await dbAll(`SELECT file_name FROM ti_evidences WHERE order_id = ?`, [id]);
    evs.forEach(e => removeTiFile(e.file_name));
    await dbRun(`DELETE FROM ti_evidences WHERE order_id = ?`, [id]);
    await dbRun(`DELETE FROM ti_orders WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo eliminar la orden' });
  }
});

// --- FOTOS Y EVIDENCIAS ---
router.post('/intranet/api/ti/evidences', authMiddleware, adminOnly, uploadTi.array('files', 12), async (req, res) => {
  try {
    const { client_id, asset_id, order_id, stage, caption } = req.body;
    const files = req.files || [];
    if (!client_id || !files.length) {
      files.forEach(f => removeTiFile(f.filename));
      return res.status(400).json({ error: 'Selecciona un cliente y al menos una foto o PDF' });
    }
    const inserted = [];
    for (const f of files) {
      const ext = path.extname(f.originalname || '').toLowerCase();
      const fileType = ext === '.pdf' ? 'pdf' : 'image';
      const r = await dbRun(
        `INSERT INTO ti_evidences (client_id, asset_id, order_id, stage, caption, file_name, original_name, file_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          Number(client_id),
          asset_id ? Number(asset_id) : null,
          order_id ? Number(order_id) : null,
          (stage || 'Después').trim(),
          (caption || '').trim(),
          f.filename,
          f.originalname,
          fileType
        ]
      );
      const row = await dbGet(`SELECT * FROM ti_evidences WHERE id = ?`, [r.lastID]);
      if (row) inserted.push(row);
    }
    res.json(inserted);
  } catch (err) {
    res.status(500).json({ error: 'No se pudieron subir las evidencias' });
  }
});

router.delete('/intranet/api/ti/evidences/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ev = await dbGet(`SELECT * FROM ti_evidences WHERE id = ?`, [id]);
    if (!ev) return res.status(404).json({ error: 'Evidencia no encontrada' });
    removeTiFile(ev.file_name);
    await dbRun(`DELETE FROM ti_evidences WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo eliminar la evidencia' });
  }
});

// Servir archivo de evidencia (con token admin JWT o share_token del cliente)
router.get('/intranet/api/ti/evidences/:id/file', async (req, res) => {
  try {
    const ev = await dbGet(`SELECT * FROM ti_evidences WHERE id = ?`, [Number(req.params.id)]);
    if (!ev) return res.status(404).json({ error: 'Archivo no encontrado' });

    const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : req.query.token;
    const share = req.query.share;
    let authorized = false;

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded && decoded.role === 'admin') authorized = true;
      } catch {}
    }

    if (!authorized && share) {
      const client = await dbGet(`SELECT id FROM ti_clients WHERE id = ? AND share_token = ?`, [ev.client_id, String(share)]);
      if (client) authorized = true;
    }

    if (!authorized) return res.status(401).json({ error: 'No autorizado' });

    const fullPath = path.join(tiDir, ev.file_name);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Archivo físico no encontrado' });
    res.sendFile(fullPath);
  } catch (err) {
    res.status(500).json({ error: 'Error al leer evidencia' });
  }
});

// --- FACTURACIÓN / RECIBOS / COTIZACIONES ---
router.post('/intranet/api/ti/invoices', authMiddleware, adminOnly, async (req, res) => {
  try {
    const body = req.body;
    if (!body.doc_number || !body.client_name || !body.general_concept) {
      return res.status(400).json({ error: 'Número de documento, cliente y concepto son obligatorios' });
    }
    const itemsArr = Array.isArray(body.items) ? body.items : [];
    const total = itemsArr.reduce((acc, it) => acc + (Number(it.subtotal) || 0), 0);

    const result = await dbRun(
      `INSERT INTO ti_invoices (
        doc_type, doc_number, issue_date, currency, client_id, client_name, client_subtitle, client_location,
        general_concept, concept_subtitle, actas_ref, items_json, total_amount, amount_words,
        payment_method, warranty_text, conformity_text, sign_client_title, sign_client_sub, sign_vb_title, sign_vb_sub, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        (body.doc_type || 'RECIBO DE CAJA / EGRESO').trim(),
        body.doc_number.trim(),
        (body.issue_date || '').trim(),
        (body.currency || 'Soles Peruanos (S/)').trim(),
        body.client_id ? Number(body.client_id) : null,
        body.client_name.trim(),
        (body.client_subtitle || '').trim(),
        (body.client_location || '').trim(),
        body.general_concept.trim(),
        (body.concept_subtitle || '').trim(),
        (body.actas_ref || '').trim(),
        JSON.stringify(itemsArr),
        Number(body.total_amount ?? total),
        (body.amount_words || '').trim(),
        (body.payment_method || '').trim(),
        (body.warranty_text || '').trim(),
        (body.conformity_text || '').trim(),
        (body.sign_client_title || 'POR CLIENTE / ENTIDAD (ENTREGUÉ CONFORME)').trim(),
        (body.sign_client_sub || '').trim(),
        (body.sign_vb_title || 'V.° B.° DIRECCIÓN / CONFORMIDAD').trim(),
        (body.sign_vb_sub || '').trim(),
        (body.status || 'Emitido').trim()
      ]
    );

    // Marcar órdenes vinculadas como Facturado si aplica
    for (const it of itemsArr) {
      if (it.order_id) {
        await dbRun(`UPDATE ti_orders SET status = 'Facturado' WHERE id = ?`, [Number(it.order_id)]);
      }
    }

    const created = await dbGet(`SELECT * FROM ti_invoices WHERE id = ?`, [result.lastID]);
    res.json(created);
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'Ya existe un comprobante con ese número' });
    }
    res.status(500).json({ error: 'No se pudo guardar el comprobante' });
  }
});

router.put('/intranet/api/ti/invoices/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const body = req.body;
    const itemsArr = Array.isArray(body.items) ? body.items : [];
    const total = itemsArr.reduce((acc, it) => acc + (Number(it.subtotal) || 0), 0);

    await dbRun(
      `UPDATE ti_invoices SET
        doc_type = ?, doc_number = ?, issue_date = ?, currency = ?, client_id = ?, client_name = ?, client_subtitle = ?, client_location = ?,
        general_concept = ?, concept_subtitle = ?, actas_ref = ?, items_json = ?, total_amount = ?, amount_words = ?,
        payment_method = ?, warranty_text = ?, conformity_text = ?, sign_client_title = ?, sign_client_sub = ?, sign_vb_title = ?, sign_vb_sub = ?, status = ?
       WHERE id = ?`,
      [
        (body.doc_type || 'RECIBO DE CAJA / EGRESO').trim(),
        (body.doc_number || '').trim(),
        (body.issue_date || '').trim(),
        (body.currency || 'Soles Peruanos (S/)').trim(),
        body.client_id ? Number(body.client_id) : null,
        (body.client_name || '').trim(),
        (body.client_subtitle || '').trim(),
        (body.client_location || '').trim(),
        (body.general_concept || '').trim(),
        (body.concept_subtitle || '').trim(),
        (body.actas_ref || '').trim(),
        JSON.stringify(itemsArr),
        Number(body.total_amount ?? total),
        (body.amount_words || '').trim(),
        (body.payment_method || '').trim(),
        (body.warranty_text || '').trim(),
        (body.conformity_text || '').trim(),
        (body.sign_client_title || '').trim(),
        (body.sign_client_sub || '').trim(),
        (body.sign_vb_title || '').trim(),
        (body.sign_vb_sub || '').trim(),
        (body.status || 'Emitido').trim(),
        Number(req.params.id)
      ]
    );
    const updated = await dbGet(`SELECT * FROM ti_invoices WHERE id = ?`, [Number(req.params.id)]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo actualizar el comprobante' });
  }
});

router.delete('/intranet/api/ti/invoices/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await dbRun(`DELETE FROM ti_invoices WHERE id = ?`, [Number(req.params.id)]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo eliminar el comprobante' });
  }
});

// --- PORTAL PÚBLICO DE SOLO LECTURA PARA CLIENTE (OPCIONAL) ---
router.get('/intranet/api/ti/public/:shareToken', async (req, res) => {
  try {
    const client = await dbGet(
      `SELECT id, name, subtitle, location, share_token FROM ti_clients WHERE share_token = ?`,
      [String(req.params.shareToken)]
    );
    if (!client) return res.status(404).json({ error: 'Enlace no válido' });
    const [assets, orders, evidences] = await Promise.all([
      dbAll(`SELECT id, asset_code, category, name, brand_model, serial_number, area_level, network_info, specs, status FROM ti_assets WHERE client_id = ? ORDER BY id DESC`, [client.id]),
      dbAll(`SELECT id, asset_id, order_type, ref_code, act_code, area_level, title, diagnosis, work_done, parts_used, warranty_months, status, service_date FROM ti_orders WHERE client_id = ? ORDER BY service_date DESC, id DESC`, [client.id]),
      dbAll(`SELECT id, asset_id, order_id, stage, caption, original_name, file_type, created_at FROM ti_evidences WHERE client_id = ? ORDER BY id DESC`, [client.id])
    ]);
    res.json({ client, assets, orders, evidences });
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar historial' });
  }
});

module.exports = router;
