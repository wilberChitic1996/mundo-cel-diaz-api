const logger   = require('../utils/logger');
const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');
const logAudit = require('../utils/audit');
const { withTenant, tid } = require('../utils/tenant');

// ── PROVEEDORES ───────────────────────────────────────

/**
 * @openapi
 * /suppliers:
 *   get:
 *     tags: [Suppliers]
 *     summary: Ver documentación completa en /api-docs
 *     responses:
 *       200:
 *         description: OK
 */
// GET /api/suppliers
router.get('/', auth, async (req, res) => {
  var q = supabase.from('suppliers').select('*').eq('active', true).order('name');
  q = withTenant(q, req);
  var { data, error } = await q;
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.json(data || []);
});

// POST /api/suppliers
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var { name, nit, phone, email, address, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  var { data, error } = await supabase
    .from('suppliers').insert({ name, nit: nit||null, phone, email, address, notes, tenant_id: tid(req) }).select().single();
  if (error) return res.status(500).json({ error: 'Error interno' });
  await logAudit(req.user, 'proveedor_creado', 'supplier', data.id, { nombre: name });
  res.status(201).json(data);
});

// PUT /api/suppliers/:id
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var { name, nit, phone, email, address, notes, active } = req.body;
  var updates = {};
  if (name     !== undefined) updates.name    = name;
  if (nit      !== undefined) updates.nit     = nit||null;
  if (phone    !== undefined) updates.phone   = phone;
  if (email    !== undefined) updates.email   = email;
  if (address  !== undefined) updates.address = address;
  if (notes    !== undefined) updates.notes   = notes;
  if (active   !== undefined) updates.active  = active;
  var { data, error } = await withTenant(supabase.from('suppliers').update(updates).eq('id', req.params.id), req).select().single();
  if (error) return res.status(500).json({ error: 'Error interno' });
  await logAudit(req.user, 'proveedor_editado', 'supplier', req.params.id, updates);
  res.json(data);
});

// ── COMPRAS ───────────────────────────────────────────

// GET /api/suppliers/purchases
router.get('/purchases', auth, async (req, res) => {
  var q = supabase.from('purchases').select('*, purchase_items(*)').order('created_at', { ascending: false }).limit(200);
  q = withTenant(q, req);
  var { data, error } = await q;
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.json(data || []);
});

// POST /api/suppliers/purchases
router.post('/purchases', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var { supplierId, supplierName, items, notes, hasFactura, supplierNit, facturaNumero, ivaAmount } = req.body;
  if (!supplierName || !items || !items.length) {
    return res.status(400).json({ error: 'supplierName e items requeridos' });
  }

  var total = items.reduce(function(s, i) { return s + Number(i.subtotal || 0); }, 0);
  var tenantId = tid(req);

  // Crédito fiscal: solo se guarda IVA/NIT/N° factura si la compra tuvo factura.
  var conFactura = !!hasFactura;

  var { data: purchase, error: pErr } = await supabase
    .from('purchases')
    .insert({
      supplier_id: supplierId || null, supplier_name: supplierName, total, notes: notes || null,
      registered_by: req.user.name, tenant_id: tenantId,
      has_factura: conFactura,
      supplier_nit: conFactura ? (supplierNit || null) : null,
      factura_numero: conFactura ? (facturaNumero || null) : null,
      iva_amount: conFactura ? (Number(ivaAmount) || 0) : 0,
    })
    .select().single();
  if (pErr) return res.status(500).json({ error: 'Error interno al crear compra' });

  var rows = items.map(function(it) {
    return { purchase_id: purchase.id, product_id: it.productId || null, product_name: it.productName, product_code: it.productCode || null, qty: Number(it.qty), cost: Number(it.cost), subtotal: Number(it.subtotal), tenant_id: tenantId };
  });
  var { error: iErr } = await supabase.from('purchase_items').insert(rows);
  if (iErr) return res.status(500).json({ error: 'Error al guardar items' });

  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it.productId) continue;
    // B4: suma de stock ATÓMICA (evita race en compras concurrentes) en vez de leer-y-escribir.
    var { data: newStock, error: incErr } = await supabase.rpc('increment_stock', { p_product_id: it.productId, p_qty: Number(it.qty), p_tenant_id: tenantId });
    if (incErr) { logger.error({ err: incErr }, '[SUPPLIERS] increment_stock compra'); continue; }
    // El costo se actualiza aparte (la función de stock no lo toca), solo si se pidió.
    if (it.updateCost && it.cost > 0) {
      await withTenant(supabase.from('products').update({ cost: Number(it.cost) }).eq('id', it.productId), req);
    }
    // B4: registrar el movimiento de inventario (entrada por compra).
    await supabase.from('stock_movements').insert({
      tenant_id: tenantId, product_id: it.productId, type: 'compra',
      qty_before: Number(newStock) - Number(it.qty), qty_change: Number(it.qty), qty_after: Number(newStock),
      reason: 'Compra a ' + supplierName, reference_id: purchase.id,
      user_name: req.user.name, user_role: req.user.role,
    });
  }

  await logAudit(req.user, 'compra_registrada', 'purchase', purchase.id, {
    proveedor: supplierName, articulos: items.length, total: total,
  });

  var { data: full } = await supabase.from('purchases').select('*, purchase_items(*)').eq('id', purchase.id).single();
  res.status(201).json(full);
});

module.exports = router;
