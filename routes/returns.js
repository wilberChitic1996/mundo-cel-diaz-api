const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');

// GET /api/returns
router.get('/', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('returns').select('*, return_items(*)')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/returns
router.post('/', auth, async (req, res) => {
  const { client, reason, refundMethod, refundAmount, itemCondition, items } = req.body;
  const total = (items||[]).reduce(function(s,i){return s+i.price*i.qty;},0);

  const { data: ret, error } = await supabase
    .from('returns')
    .insert({ client, reason,
      refund_method: refundMethod,
      refund_amount: refundAmount||0,
      item_condition: itemCondition||'bueno',
      total, user_id: req.user.userId })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Insertar items
  if (items && items.length) {
    await supabase.from('return_items').insert(
      items.map(function(i){ return { return_id:ret.id, code:i.code, name:i.name, price:i.price, qty:i.qty }; })
    );
  }

  // Manejar stock segun condicion del articulo
  if (itemCondition === 'bueno') {
    // Buen estado: devolver al inventario
    for (var item of items) {
      var { data: prod } = await supabase.from('products').select('stock').eq('code', item.code).single();
      if (prod) {
        await supabase.from('products').update({ stock: prod.stock + item.qty, updated_at: new Date() }).eq('code', item.code);
      }
    }
  } else {
    // Defectuoso: agregar a piezas defectuosas
    var defItems = items.map(function(i){ return { return_id:ret.id, code:i.code, name:i.name, qty:i.qty, price:i.price, reason:reason, status:'defectuoso' }; });
    await supabase.from('defectives').insert(defItems);
  }

  res.status(201).json(ret);
});

module.exports = router;
