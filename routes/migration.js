const logger = require('../utils/logger');
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const auth = require('../middleware/auth');
const supabase = require('../supabase');
const logAudit = require('../utils/audit');
const { withTenant, tid } = require('../utils/tenant');
const requireRole = require('../middleware/requireRole');
const enforceSubscription = require('../middleware/enforceSubscription');

// ──────────────────────────────────────────────────────────────────────────────
// Migración del cuaderno → sistema (Fase 1: DEUDAS históricas).
//
// Concepto contable: lo del cuaderno entra como "saldo inicial / foto de apertura",
// NO como ventas nuevas. Por eso estas cuentas se crean por INSERT directo (acá),
// nunca por POST /api/sales → no descuentan stock, no tocan la caja del día, no
// generan IVA del período. Quedan marcadas origin='migracion' + migration_batch_id
// para poder deshacer una carga completa. Los abonos FUTUROS a estas deudas sí entran
// por el flujo normal (/accounts/:id/payments) y sí tocan la caja el día que se cobren.
// ──────────────────────────────────────────────────────────────────────────────

// Borra un lote completo en orden FK-safe (items → payments → cuentas).
async function rollbackBatch(tenantId, batchId, accountIds) {
  if (accountIds && accountIds.length) {
    await supabase.from('account_items').delete().eq('tenant_id', tenantId).in('account_id', accountIds);
    await supabase.from('account_payments').delete().eq('tenant_id', tenantId).in('account_id', accountIds);
  }
  await supabase.from('accounts').delete()
    .eq('tenant_id', tenantId).eq('origin', 'migracion').eq('migration_batch_id', batchId);
}

/**
 * @openapi
 * /migration/debts:
 *   post:
 *     tags: [Migration]
 *     summary: Carga masiva de deudas históricas (del cuaderno). Ver /api-docs.
 *     responses:
 *       201: { description: Lote creado }
 */
// POST /api/migration/debts — { debts: [{ client, total, paid?, items?, date?, note? }] }
router.post('/debts', auth, requireRole('admin'), enforceSubscription, async (req, res) => {
  var debts = req.body && req.body.debts;
  if (!Array.isArray(debts) || debts.length === 0) {
    return res.status(400).json({ error: 'Enviá al menos una deuda en "debts".' });
  }
  if (debts.length > 500) {
    return res.status(400).json({ error: 'Máximo 500 deudas por carga. Dividí el archivo en partes.' });
  }

  var tenantId = tid(req);
  var batchId = crypto.randomUUID();
  var nowIso = new Date().toISOString();
  var registradoPor = { name: req.user.name, role: req.user.role };

  // 1) Validar y normalizar TODO antes de insertar nada (mensajes por fila, en lenguaje de tienda).
  var rows = [];
  for (var i = 0; i < debts.length; i++) {
    var d = debts[i] || {};
    var client = (d.client == null ? '' : String(d.client)).trim();
    var total = Number(d.total);
    var paid = Number(d.paid) || 0;
    var fila = i + 1;
    if (!client) return res.status(400).json({ error: 'Fila ' + fila + ': falta el nombre del cliente.' });
    if (!isFinite(total) || total <= 0) return res.status(400).json({ error: 'Fila ' + fila + ' (' + client + '): el total debe ser un número mayor que 0.' });
    if (paid < 0) return res.status(400).json({ error: 'Fila ' + fila + ' (' + client + '): lo abonado no puede ser negativo.' });
    if (paid > total) return res.status(400).json({ error: 'Fila ' + fila + ' (' + client + '): lo abonado (Q' + paid + ') no puede ser mayor que el total (Q' + total + ').' });

    var balance = Math.max(0, total - paid);
    var status = balance <= 0 ? 'pagado' : paid > 0 ? 'parcial' : 'pendiente';

    // Fecha del cuaderno (opcional). Se fija a mediodía local para evitar saltos de huso
    // al convertir a TIMESTAMPTZ. Si no es válida, usa el momento actual.
    var createdAt = nowIso;
    if (d.date) {
      var parsed = new Date(d.date);
      if (!isNaN(parsed.getTime())) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(d.date))) parsed = new Date(String(d.date) + 'T12:00:00');
        createdAt = parsed.toISOString();
      }
    }

    rows.push({
      items: Array.isArray(d.items) ? d.items : null,
      note: (d.note == null ? '' : String(d.note)).trim() || null,
      account: {
        client: client, total: total, paid: paid, balance: balance, status: status,
        method: 'Efectivo', sale_id: null, user_id: req.user.userId, registrado_por: registradoPor,
        tenant_id: tenantId, origin: 'migracion', migrated_at: nowIso, migration_batch_id: batchId,
        created_at: createdAt,
      },
    });
  }

  // 2) Insertar secuencialmente (cuenta + su detalle) para correlacionar bien el id.
  //    Si algo falla, se revierte TODO el lote (no deja cuentas a medias).
  var insertedIds = [];
  for (var j = 0; j < rows.length; j++) {
    var r = rows[j];
    var { data: acc, error: aErr } = await supabase.from('accounts').insert(r.account).select().single();
    if (aErr) {
      await rollbackBatch(tenantId, batchId, insertedIds);
      logger.error({ err: aErr }, '[MIGRATION] account insert failed');
      return res.status(500).json({ error: 'Error al guardar la deuda de ' + r.account.client + '. Se revirtió la carga. (¿Falta correr la migración 026 en la base?)' });
    }
    insertedIds.push(acc.id);

    var items;
    if (r.items && r.items.length) {
      items = r.items.map(function(it) {
        return { account_id: acc.id, code: it.code || null, name: it.name || 'Artículo',
          price: Number(it.price) || 0, qty: Number(it.qty) || 1, tenant_id: tenantId };
      });
    } else {
      // Línea genérica para que la cuenta no muestre "0 artículos".
      items = [{ account_id: acc.id, code: null, name: r.note || 'Deuda histórica (del cuaderno)',
        price: Number(acc.total), qty: 1, tenant_id: tenantId }];
    }
    var { error: itErr } = await supabase.from('account_items').insert(items);
    if (itErr) {
      await rollbackBatch(tenantId, batchId, insertedIds);
      logger.error({ err: itErr }, '[MIGRATION] account_items insert failed');
      return res.status(500).json({ error: 'Error al guardar el detalle de ' + r.account.client + '. Se revirtió la carga.' });
    }
  }

  var totalDebt = rows.reduce(function(s, r) { return s + Number(r.account.balance); }, 0);
  await logAudit(req.user, 'migracion_historica', 'migracion', batchId, {
    tipo: 'deudas', conteo: insertedIds.length, total_deuda: totalDebt,
  });
  res.status(201).json({ batchId: batchId, created: insertedIds.length, totalDebt: totalDebt });
});

// GET /api/migration/batches — lotes de migración del tenant (para revisar / deshacer).
router.get('/batches', auth, requireRole('admin'), async (req, res) => {
  var { data, error } = await withTenant(
    supabase.from('accounts').select('migration_batch_id, migrated_at, balance').eq('origin', 'migracion'),
    req
  );
  if (error) { logger.error({ err: error }, '[MIGRATION] batches'); return res.status(500).json({ error: 'Error interno' }); }
  var map = {};
  (data || []).forEach(function(a) {
    var k = a.migration_batch_id;
    if (!k) return;
    if (!map[k]) map[k] = { batchId: k, migratedAt: a.migrated_at, count: 0, totalDebt: 0 };
    map[k].count += 1;
    map[k].totalDebt += Number(a.balance) || 0;
  });
  res.json(Object.values(map).sort(function(a, b) { return String(b.migratedAt || '').localeCompare(String(a.migratedAt || '')); }));
});

// DELETE /api/migration/debts/:batchId — deshacer una carga completa (solo lo marcado migración).
router.delete('/debts/:batchId', auth, requireRole('admin'), enforceSubscription, async (req, res) => {
  var tenantId = tid(req);
  var batchId = req.params.batchId;
  var { data: toDelete, error: selErr } = await supabase.from('accounts')
    .select('id').eq('tenant_id', tenantId).eq('origin', 'migracion').eq('migration_batch_id', batchId);
  if (selErr) { logger.error({ err: selErr }, '[MIGRATION] undo select'); return res.status(500).json({ error: 'Error interno' }); }
  if (!toDelete || !toDelete.length) return res.status(404).json({ error: 'No se encontró esa carga.' });

  var ids = toDelete.map(function(a) { return a.id; });
  await rollbackBatch(tenantId, batchId, ids);
  await logAudit(req.user, 'migracion_revertida', 'migracion', batchId, { conteo: toDelete.length });
  res.json({ deleted: toDelete.length });
});

module.exports = router;
