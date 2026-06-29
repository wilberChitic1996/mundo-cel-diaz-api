const logger = require('../utils/logger');
const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');
const logAudit = require('../utils/audit');
const { withTenant, tid } = require('../utils/tenant');

/**
 * @openapi
 * /defectives:
 *   get:
 *     tags: [Defectives]
 *     summary: Ver documentación completa en /api-docs
 *     responses:
 *       200:
 *         description: OK
 */
// GET /api/defectives
router.get('/', auth, async (req, res) => {
  var q = supabase.from('defectives').select('*').order('created_at', { ascending: false });
  q = withTenant(q, req);
  const { data, error } = await q;
  if (error) { logger.error({ err: error }, '[DEFECTIVES]'); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data);
});

// PUT /api/defectives/:id
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var { status } = req.body;

  var { data: def } = await withTenant(supabase.from('defectives').select('*').eq('id', req.params.id), req).single();

  if (status === 'reingresado' && def && def.code) {
    // B4/B5: reingreso robusto (sin .single()) + atómico + movimiento de inventario.
    var { data: pRows } = await withTenant(supabase.from('products').select('id').eq('code', def.code).limit(1), req);
    var pid = (pRows && pRows.length) ? pRows[0].id : null;
    if (pid) {
      var { data: newStock, error: incErr } = await supabase.rpc('increment_stock', { p_product_id: pid, p_qty: Number(def.qty), p_tenant_id: tid(req) });
      if (incErr) {
        logger.error({ err: incErr }, '[DEFECTIVES] increment_stock reingreso');
      } else if (newStock != null) {
        await supabase.from('stock_movements').insert({
          tenant_id: tid(req), product_id: pid, type: 'devolucion',
          qty_before: Number(newStock) - Number(def.qty), qty_change: Number(def.qty), qty_after: Number(newStock),
          reason: 'Reingreso de defectuoso', reference_id: req.params.id,
          user_name: req.user.name, user_role: req.user.role,
        });
      }
    }
  }

  var { data, error } = await withTenant(
    supabase.from('defectives').update({ status: status, updated_at: new Date() }).eq('id', req.params.id),
    req
  ).select().single();
  if (error) { logger.error({ err: error }, '[DEFECTIVES]'); return res.status(500).json({ error: 'Error interno' }); }

  await logAudit(req.user, 'defectuoso_estado', 'defective', req.params.id, {
    _articulo: def ? (def.name||def.code||req.params.id) : req.params.id,
    Estado: { antes: def ? def.status : '—', despues: status },
    ...(status === 'reingresado' ? { cantidad_reingresada: def ? def.qty : '—' } : {})
  });
  res.json(data);
});

module.exports = router;
