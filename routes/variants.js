const logger  = require('../utils/logger');
const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');
const logAudit = require('../utils/audit');
const { withTenant, tid } = require('../utils/tenant');
const requireRole = require('../middleware/requireRole');
const enforceSubscription = require('../middleware/enforceSubscription');

// GET /api/products/:id/variants
router.get('/:id/variants', auth, async (req, res) => {
  var q = supabase.from('product_variants').select('*').eq('product_id', req.params.id).order('created_at');
  q = withTenant(q, req);
  var { data, error } = await q;
  if (error) { logger.error({ err: error }, '[VARIANTS]'); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data || []);
});

// POST /api/products/:id/variants
router.post('/:id/variants', auth, requireRole('admin'), enforceSubscription, async (req, res) => {
  var { color, capacity, sku, stock, price, cost } = req.body;
  var tenantId = tid(req);
  var { data, error } = await supabase.from('product_variants').insert({
    tenant_id: tenantId, product_id: req.params.id,
    color: color || null, capacity: capacity || null, sku: sku || null,
    stock: parseInt(stock) || 0, price: price ? parseFloat(price) : null, cost: cost ? parseFloat(cost) : null,
    active: true,
  }).select().single();
  if (error) { logger.error({ err: error }, '[VARIANTS]'); return res.status(500).json({ error: 'Error interno' }); }
  await logAudit(req.user, 'variante_creada', 'product_variant', data.id, { product_id: req.params.id, color, capacity, sku });
  res.status(201).json(data);
});

// PUT /api/products/:id/variants/:vid
router.put('/:id/variants/:vid', auth, requireRole('admin'), enforceSubscription, async (req, res) => {
  var { color, capacity, sku, stock, price, cost, active } = req.body;
  var { data, error } = await withTenant(
    supabase.from('product_variants').update({
      color: color || null, capacity: capacity || null, sku: sku || null,
      stock: parseInt(stock) || 0, price: price ? parseFloat(price) : null, cost: cost ? parseFloat(cost) : null,
      active: active !== undefined ? active : true, updated_at: new Date().toISOString(),
    }).eq('id', req.params.vid).eq('product_id', req.params.id),
    req
  ).select().single();
  if (error) { logger.error({ err: error }, '[VARIANTS]'); return res.status(500).json({ error: 'Error interno' }); }
  await logAudit(req.user, 'variante_editada', 'product_variant', req.params.vid, { product_id: req.params.id, color, capacity, sku });
  res.json(data);
});

// DELETE /api/products/:id/variants/:vid
router.delete('/:id/variants/:vid', auth, requireRole('admin'), enforceSubscription, async (req, res) => {
  var { error } = await withTenant(
    supabase.from('product_variants').delete().eq('id', req.params.vid).eq('product_id', req.params.id),
    req
  );
  if (error) { logger.error({ err: error }, '[VARIANTS]'); return res.status(500).json({ error: 'Error interno' }); }
  await logAudit(req.user, 'variante_eliminada', 'product_variant', req.params.vid, { product_id: req.params.id });
  res.json({ success: true });
});

module.exports = router;
