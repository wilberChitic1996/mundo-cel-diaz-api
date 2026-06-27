const logger = require('../utils/logger');
const express   = require('express');
const router    = express.Router();
const auth      = require('../middleware/auth');
const supabase  = require('../supabase');
const logAudit  = require('../utils/audit');
const { withTenant, tid } = require('../utils/tenant');
const cache     = require('../utils/cache');

/**
 * @openapi
 * /products:
 *   get:
 *     tags: [Products]
 *     summary: Listar productos activos del tenant
 *     responses:
 *       200:
 *         description: Lista de productos
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Product'
 */
router.get('/', auth, async (req, res) => {
  var cacheKey = 'products:' + tid(req);
  var cached = await cache.get(cacheKey);
  if (cached) return res.json(cached);

  var q = supabase.from('products').select('*').eq('active', true).order('name');
  q = withTenant(q, req);
  var { data, error } = await q;
  if (error) { logger.error({ err: error }, '[PRODUCTS]'); return res.status(500).json({ error: 'Error interno' }); }
  await cache.set(cacheKey, data, 120); // 2 minutos
  res.json(data);
});

var PRODUCT_FIELDS = ['name','price','cost','stock','min_stock','unit','category','shelf','category_id','location_id','position','description','active'];

// POST /api/products
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });

  var { data: codeData, error: codeError } = await supabase.rpc('generate_product_code');
  if (codeError) { logger.error({ err: codeError }, '[PRODUCTS]'); return res.status(500).json({ error: 'Error generando código' }); }

  var body = {};
  PRODUCT_FIELDS.forEach(function(f){ if (req.body[f] !== undefined) body[f] = req.body[f]; });
  var productData = Object.assign(body, { code: codeData, tenant_id: tid(req) });

  var { data, error } = await supabase
    .from('products').insert(productData).select().single();
  if (error) { logger.error({ err: error }, '[PRODUCTS]'); return res.status(500).json({ error: 'Error interno' }); }
  await logAudit(req.user, 'producto_creado', 'product', data.id, { name: data.name, code: data.code, price: data.price, stock: data.stock });
  await cache.del('products:' + tid(req));
  res.status(201).json(data);
});

// PUT /api/products/:id
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });

  var q = supabase.from('products').select('*').eq('id', req.params.id);
  var { data: before } = await withTenant(q, req).single();

  var body = {};
  PRODUCT_FIELDS.forEach(function(f){ if (req.body[f] !== undefined) body[f] = req.body[f]; });
  var upd = withTenant(
    supabase.from('products').update(Object.assign(body, { updated_at: new Date() })).eq('id', req.params.id),
    req
  );
  var { data, error } = await upd.select().single();
  if (error) { logger.error({ err: error }, '[PRODUCTS]'); return res.status(500).json({ error: 'Error interno' }); }

  var CAMPOS = { name:'Nombre', code:'Código', price:'Precio', cost:'Costo', stock:'Stock', category:'Categoría', shelf:'Ubicación', unit:'Unidad', min_stock:'Stock mínimo' };
  var diff = {};
  if (before) {
    Object.keys(CAMPOS).forEach(function(k){
      if (req.body[k] !== undefined && String(req.body[k]) !== String(before[k])) {
        diff[CAMPOS[k]] = { antes: before[k], despues: req.body[k] };
      }
    });
  }
  diff._producto = before ? before.name : req.params.id;

  await logAudit(req.user, 'producto_editado', 'product', req.params.id, diff);
  await cache.del('products:' + tid(req));
  res.json(data);
});

// POST /api/products/:id/adjust-stock
router.post('/:id/adjust-stock', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var { new_stock, reason } = req.body;
  if (new_stock === undefined || isNaN(parseInt(new_stock))) return res.status(400).json({ error: 'new_stock requerido' });
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'Motivo del ajuste requerido' });

  var { data: prod } = await withTenant(supabase.from('products').select('stock,name').eq('id', req.params.id), req).single();
  if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });

  var qty_before = Number(prod.stock);
  var qty_after  = parseInt(new_stock);
  var qty_change = qty_after - qty_before;

  var { data, error } = await withTenant(
    supabase.from('products').update({ stock: qty_after, updated_at: new Date() }).eq('id', req.params.id), req
  ).select().single();
  if (error) { logger.error({ err: error }, '[PRODUCTS:adjust]'); return res.status(500).json({ error: 'Error interno' }); }

  await supabase.from('stock_movements').insert({
    tenant_id: tid(req), product_id: req.params.id,
    type: 'ajuste', qty_before, qty_change, qty_after,
    reason: reason.trim(), user_name: req.user.name, user_role: req.user.role,
  });
  await logAudit(req.user, 'stock_ajustado', 'product', req.params.id, {
    _producto: prod.name, antes: qty_before, despues: qty_after, motivo: reason.trim(),
  });
  res.json(data);
});

// GET /api/products/:id/stock-history
router.get('/:id/stock-history', auth, async (req, res) => {
  var q = supabase.from('stock_movements')
    .select('*').eq('product_id', req.params.id)
    .order('created_at', { ascending: false }).limit(100);
  q = withTenant(q, req);
  var { data, error } = await q;
  if (error) { logger.error({ err: error }, '[PRODUCTS:stock-history]'); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data || []);
});

// GET /api/products/:id/price-history
router.get('/:id/price-history', auth, async (req, res) => {
  var q = supabase
    .from('audit_logs')
    .select('created_at, user_name, user_role, details')
    .eq('entity_type', 'product')
    .eq('entity_id', req.params.id)
    .eq('action', 'producto_editado')
    .order('created_at', { ascending: false })
    .limit(100);
  q = withTenant(q, req);
  var { data, error } = await q;
  if (error) { logger.error({ err: error }, '[PRICE-HISTORY]'); return res.status(500).json({ error: 'Error interno' }); }
  var history = (data || [])
    .filter(function(r) { return r.details && r.details['Precio']; })
    .map(function(r) {
      return { date: r.created_at, user: r.user_name, role: r.user_role, before: r.details['Precio'].antes, after: r.details['Precio'].despues };
    });
  res.json(history);
});

// DELETE /api/products/:id (soft delete)
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var { data: before } = await withTenant(supabase.from('products').select('name,code').eq('id', req.params.id), req).single();
  var { error } = await withTenant(
    supabase.from('products').update({ active: false, updated_at: new Date() }).eq('id', req.params.id),
    req
  );
  if (error) { logger.error({ err: error }, '[PRODUCTS]'); return res.status(500).json({ error: 'Error interno' }); }
  await logAudit(req.user, 'producto_eliminado', 'product', req.params.id, { nombre: before ? before.name : '—', codigo: before ? before.code : '—' });
  res.json({ success: true });
});

module.exports = router;
