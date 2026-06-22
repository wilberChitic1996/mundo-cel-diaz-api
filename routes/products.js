const express   = require('express');
const router    = express.Router();
const auth      = require('../middleware/auth');
const supabase  = require('../supabase');
const logAudit  = require('../utils/audit');

// GET /api/products
router.get('/', auth, async (req, res) => {
  var { data, error } = await supabase
    .from('products').select('*').eq('active', true).order('name');
  if (error) { console.error('[PRODUCTS]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data);
});

// POST /api/products — genera código automático
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });

  // Obtener código automático desde Supabase
  var { data: codeData, error: codeError } = await supabase.rpc('generate_product_code');
  if (codeError) { console.error('[PRODUCTS]', codeError.message); return res.status(500).json({ error: 'Error generando código' }); }

  var productData = Object.assign({}, req.body, { code: codeData });

  var { data, error } = await supabase
    .from('products').insert(productData).select().single();
  if (error) { console.error('[PRODUCTS]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  await logAudit(req.user, 'producto_creado', 'product', data.id, { name: data.name, code: data.code, price: data.price, stock: data.stock });
  res.status(201).json(data);
});

// PUT /api/products/:id
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });

  // Leer estado anterior para generar diff
  var { data: before } = await supabase.from('products').select('*').eq('id', req.params.id).single();

  var { data, error } = await supabase
    .from('products').update(Object.assign({}, req.body, { updated_at: new Date() }))
    .eq('id', req.params.id).select().single();
  if (error) { console.error('[PRODUCTS]', error.message); return res.status(500).json({ error: 'Error interno' }); }

  // Construir diff: solo campos que cambiaron
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
  res.json(data);
});

// DELETE /api/products/:id (soft delete)
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var { data: before } = await supabase.from('products').select('name,code').eq('id', req.params.id).single();
  var { error } = await supabase
    .from('products').update({ active: false, updated_at: new Date() })
    .eq('id', req.params.id);
  if (error) { console.error('[PRODUCTS]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  await logAudit(req.user, 'producto_eliminado', 'product', req.params.id, { nombre: before ? before.name : '—', codigo: before ? before.code : '—' });
  res.json({ success: true });
});

module.exports = router;
