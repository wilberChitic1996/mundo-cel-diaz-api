/**
 * routes/serials.js
 * Gestión de números de serie / IMEI por producto.
 *
 * GET    /api/products/:productId/serials          — lista seriales del producto
 * POST   /api/products/:productId/serials          — agregar serial(es) en bulk
 * PUT    /api/products/:productId/serials/:id      — actualizar notes/status
 * DELETE /api/products/:productId/serials/:id      — eliminar (solo si no vendido)
 * GET    /api/serials/search?q=...                 — buscar IMEI en todo el tenant
 */

'use strict';

const express = require('express');
const supabase = require('../supabase');
const authMiddleware = require('../middleware/auth');
const { tid } = require('../utils/tenant');
const logAudit = require('../utils/audit');
const logger = require('../utils/logger');

const router = express.Router();

// ── Helpers de validación ─────────────────────────────────────────────────────

// Algoritmo de Luhn para IMEI de 15 dígitos
function luhnCheck(imei) {
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = parseInt(imei[i], 10);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

function validateImei(value) {
  const v = (value || '').trim().toUpperCase();
  if (!v) return 'El IMEI/serial es requerido';
  if (v.length < 4 || v.length > 30) return 'El IMEI/serial debe tener entre 4 y 30 caracteres';
  if (!/^[A-Z0-9\-_./ ]+$/.test(v)) return 'Caracteres inválidos en IMEI/serial';
  // Si son 15 dígitos exactos, validar Luhn
  if (/^\d{15}$/.test(v) && !luhnCheck(v)) return 'IMEI inválido (falla verificación de dígito de control)';
  return null;
}

// ── GET /products/:productId/serials ─────────────────────────────────────────
router.get('/products/:productId/serials', authMiddleware, async function(req, res) {
  try {
    const tenantId = tid(req);
    const { productId } = req.params;
    const { status } = req.query;

    let query = supabase
      .from('product_serials')
      .select('id, imei, status, notes, sale_id, created_at, updated_at, sales(id, date:created_at, client)')
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    logger.error({ err }, 'Error listando seriales');
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── POST /products/:productId/serials ─────────────────────────────────────────
// Body: { imeis: string | string[], notes?: string }
router.post('/products/:productId/serials', authMiddleware, async function(req, res) {
  try {
    const tenantId = tid(req);
    const { productId } = req.params;
    const { imeis, notes } = req.body;

    if (!['superadmin', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Solo administradores pueden agregar seriales' });
    }

    // Normalizar a array (acepta string con saltos, comas o punto y coma)
    const raw = Array.isArray(imeis) ? imeis : String(imeis || '').split(/[\n,;]+/);
    const list = raw.map(function(s) { return s.trim().toUpperCase(); }).filter(Boolean);

    if (!list.length) return res.status(400).json({ error: 'Se requiere al menos un IMEI/serial' });
    if (list.length > 500) return res.status(400).json({ error: 'Máximo 500 seriales por lote' });

    // Verificar que el producto pertenece al tenant
    const { data: prod, error: prodErr } = await supabase
      .from('products')
      .select('id, name')
      .eq('id', productId)
      .eq('tenant_id', tenantId)
      .single();
    if (prodErr || !prod) return res.status(404).json({ error: 'Producto no encontrado' });

    // Validar cada serial
    const validRows = [];
    const skipped = [];
    for (const imei of list) {
      const err = validateImei(imei);
      if (err) { skipped.push({ imei, error: err }); continue; }
      validRows.push({ tenant_id: tenantId, product_id: productId, imei, status: 'disponible', notes: notes || null });
    }

    if (!validRows.length) {
      return res.status(400).json({ error: 'Ningún serial válido', details: skipped });
    }

    // Upsert ignorando duplicados por (tenant_id, imei)
    const { data: inserted, error: insErr } = await supabase
      .from('product_serials')
      .upsert(validRows, { onConflict: 'tenant_id,imei', ignoreDuplicates: true })
      .select('id, imei, status');

    if (insErr) throw insErr;

    await logAudit(req.user, 'serial_agregado', 'product', productId,
      { producto: prod.name, agregados: inserted ? inserted.length : 0, omitidos: skipped.length });

    res.status(201).json({
      inserted: inserted || [],
      skipped,
      message: (inserted ? inserted.length : 0) + ' serial(es) agregado(s)' + (skipped.length ? ', ' + skipped.length + ' omitido(s)' : ''),
    });
  } catch (err) {
    logger.error({ err }, 'Error agregando seriales');
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── PUT /products/:productId/serials/:id ──────────────────────────────────────
router.put('/products/:productId/serials/:id', authMiddleware, async function(req, res) {
  try {
    const tenantId = tid(req);
    const { productId, id } = req.params;
    const { notes, status } = req.body;

    if (!['superadmin', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Solo administradores pueden modificar seriales' });
    }

    const allowedStatuses = ['disponible', 'defectuoso', 'devuelto'];
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Status inválido. Permitidos: ' + allowedStatuses.join(', ') });
    }

    const update = { updated_at: new Date().toISOString() };
    if (notes !== undefined) update.notes = notes;
    if (status) {
      update.status = status;
      // Al revertir a disponible o devuelto, desvincula la venta
      if (['disponible', 'devuelto'].includes(status)) update.sale_id = null;
    }

    const { data, error } = await supabase
      .from('product_serials')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Serial no encontrado' });

    res.json(data);
  } catch (err) {
    logger.error({ err }, 'Error actualizando serial');
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── DELETE /products/:productId/serials/:id ───────────────────────────────────
router.delete('/products/:productId/serials/:id', authMiddleware, async function(req, res) {
  try {
    const tenantId = tid(req);
    const { productId, id } = req.params;

    if (!['superadmin', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Solo administradores pueden eliminar seriales' });
    }

    const { data: serial } = await supabase
      .from('product_serials')
      .select('status, imei')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .single();

    if (!serial) return res.status(404).json({ error: 'Serial no encontrado' });
    if (serial.status === 'vendido') {
      return res.status(409).json({
        error: 'No se puede eliminar un serial ya vendido. Cambia su estado a "devuelto" primero.',
      });
    }

    const { error } = await supabase
      .from('product_serials')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) throw error;
    res.json({ ok: true, imei: serial.imei });
  } catch (err) {
    logger.error({ err }, 'Error eliminando serial');
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── GET /serials/search?q=... ─────────────────────────────────────────────────
router.get('/serials/search', authMiddleware, async function(req, res) {
  try {
    const tenantId = tid(req);
    const q = (req.query.q || '').trim();

    if (q.length < 3) return res.status(400).json({ error: 'Ingresa al menos 3 caracteres' });

    const { data, error } = await supabase
      .from('product_serials')
      .select('id, imei, status, notes, sale_id, created_at, products(id, name, code), sales(id, date:created_at, client)')
      .eq('tenant_id', tenantId)
      .ilike('imei', '%' + q + '%')
      .limit(20);

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    logger.error({ err }, 'Error buscando serial');
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
