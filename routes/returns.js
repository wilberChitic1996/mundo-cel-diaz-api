const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');
const logAudit = require('../utils/audit');

// GET /api/returns
router.get('/', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('returns').select('*, return_items(*)')
    .order('created_at', { ascending: false });
  if (error) { console.error('[RETURNS]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data);
});

// POST /api/returns
router.post('/', auth, async (req, res) => {
  const { client, saleId, reason, refundMethod, refundAmount, itemCondition, items } = req.body;
  const total = (items||[]).reduce(function(s,i){return s+i.price*i.qty;},0);

  const { data: ret, error } = await supabase
    .from('returns')
    .insert({ client, sale_id: saleId||null, reason,
      refund_method: refundMethod,
      refund_amount: refundAmount||0,
      item_condition: itemCondition||'bueno',
      total, user_id: req.user.userId })
    .select().single();
  if (error) { console.error('[RETURNS]', error.message); return res.status(500).json({ error: 'Error interno' }); }

  if (items && items.length) {
    await supabase.from('return_items').insert(
      items.map(function(i){ return { return_id:ret.id, code:i.code, name:i.name, price:i.price, qty:i.qty }; })
    );
  }

  if (itemCondition === 'bueno') {
    for (var item of items) {
      var { data: prod } = await supabase.from('products').select('stock').eq('code', item.code).single();
      if (prod) {
        await supabase.from('products').update({ stock: prod.stock + item.qty, updated_at: new Date() }).eq('code', item.code);
      }
    }
  } else {
    var defItems = items.map(function(i){ return { return_id:ret.id, code:i.code, name:i.name, qty:i.qty, price:i.price, reason:reason, status:'defectuoso' }; });
    await supabase.from('defectives').insert(defItems);
  }

  await logAudit(req.user, 'devolucion_registrada', 'return', ret.id, {
    cliente: client,
    motivo: reason,
    condicion: itemCondition||'bueno',
    reembolso_metodo: refundMethod||'—',
    reembolso_monto: refundAmount||0,
    total,
    articulos: (items||[]).map(function(i){ return i.name+' x'+i.qty; }).join(', ')
  });
  res.status(201).json(ret);
});

module.exports = router;
