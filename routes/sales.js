const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');

// GET /api/sales
router.get('/', auth, async (req, res) => {
  var { data, error } = await supabase
    .from('sales').select('*, sale_items(*)')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/sales — maneja completo, parcial y pendiente
router.post('/', auth, async (req, res) => {
  var { client, total, method, items, payType, initialPay } = req.body;
  if (!client || !items || !items.length)
    return res.status(400).json({ error: 'Datos incompletos' });

  // Quien registra la operacion (tomado del token de sesion)
  var registradoPor = { name: req.user.name, role: req.user.role };

  payType = payType || 'completo';

  if (payType === 'completo') {
    // Venta normal
    var { data: sale, error: sErr } = await supabase
      .from('sales')
      .insert({ client, total, method: method||'Efectivo', status:'completado', user_id: req.user.userId, registrado_por: registradoPor })
      .select().single();
    if (sErr) return res.status(500).json({ error: sErr.message });

    await supabase.from('sale_items').insert(
      items.map(function(i){ return { sale_id:sale.id, product_id:i.id||null, code:i.code, name:i.name, price:i.price, qty:i.qty, subtotal:i.price*i.qty }; })
    );

    // Descontar stock
    for (var item of items) {
      if (item.id && item.unit !== 'serv') {
        var { data: prod } = await supabase.from('products').select('stock').eq('id', item.id).single();
        if (prod && prod.stock >= item.qty) {
          await supabase.from('products').update({ stock: prod.stock - item.qty, updated_at: new Date() }).eq('id', item.id);
        }
      }
    }
    return res.status(201).json(sale);

  } else {
    // Parcial o pendiente: crear cuenta por cobrar
    var paid    = payType === 'parcial' ? Math.min(parseFloat(initialPay)||0, total) : 0;
    var balance = total - paid;
    var status  = balance <= 0 ? 'pagado' : paid > 0 ? 'parcial' : 'pendiente';

    var { data: acc, error: aErr } = await supabase
      .from('accounts')
      .insert({ client, total, paid, balance, status, method: method||'Efectivo', user_id: req.user.userId, registrado_por: registradoPor })
      .select().single();
    if (aErr) return res.status(500).json({ error: aErr.message });

    await supabase.from('account_items').insert(
      items.map(function(i){ return { account_id:acc.id, code:i.code, name:i.name, price:i.price, qty:i.qty }; })
    );

    if (paid > 0) {
      await supabase.from('account_payments').insert({
        account_id: acc.id, amount: paid, method: method||'Efectivo', note: 'Abono inicial', registrado_por: registradoPor
      });
    }

    // Descontar stock
    for (var item2 of items) {
      if (item2.id && item2.unit !== 'serv') {
        var { data: prod2 } = await supabase.from('products').select('stock').eq('id', item2.id).single();
        if (prod2 && prod2.stock >= item2.qty) {
          await supabase.from('products').update({ stock: prod2.stock - item2.qty, updated_at: new Date() }).eq('id', item2.id);
        }
      }
    }

    return res.status(201).json({ type:'account', ...acc });
  }
});

module.exports = router;
