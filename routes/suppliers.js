const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');
const logAudit = require('../utils/audit');
const { withTenant, tid } = require('../utils/tenant');

// ── PROVEEDORES ───────────────────────────────────────

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
  var { name, phone, email, address, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  var { data, error } = await supabase
    .from('suppliers').insert({ name, phone, email, address, notes, tenant_id: tid(req) }).select().single();
  if (error) return res.status(500).json({ error: 'Error interno' });
  await logAudit(req.user, 'proveedor_creado', 'supplier', data.id, { nombre: name });
  res.status(201).json(data);
});

// PUT /api/suppliers/:id
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var { name, phone, email, address, notes, active } = req.body;
  var updates = {};
  if (name     !== undefined) updates.name    = name;
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
  var { supplierId, supplierName, items, notes } = req.body;
  if (!supplierName || !items || !items.length) {
    return res.status(400).json({ error: 'supplierName e items requeridos' });
  }

  var total = items.reduce(function(s, i) { return s + Number(i.subtotal || 0); }, 0);
  var tenantId = tid(req);

  var { data: purchase, error: pErr } = await supabase
    .from('purchases')
    .insert({ supplier_id: supplierId || null, supplier_name: supplierName, total, notes: notes || null, registered_by: req.user.name, tenant_id: tenantId })
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
    var { data: prod } = await withTenant(supabase.from('products').select('stock,cost').eq('id', it.productId), req).single();
    if (!prod) continue;
    var newStock = Number(prod.stock || 0) + Number(it.qty);
    var updateFields = { stock: newStock };
    if (it.updateCost && it.cost > 0) updateFields.cost = Number(it.cost);
    await withTenant(supabase.from('products').update(updateFields).eq('id', it.productId), req);
  }

  await logAudit(req.user, 'compra_registrada', 'purchase', purchase.id, {
    proveedor: supplierName, articulos: items.length, total: total,
  });

  var { data: full } = await supabase.from('purchases').select('*, purchase_items(*)').eq('id', purchase.id).single();
  res.status(201).json(full);
});

module.exports = router;
