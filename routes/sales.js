const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');

// GET /api/sales
router.get('/', auth, async (req, res) => {
  var { data, error } = await supabase
    .from('sales').select('*, sale_items(*)')
    .order('created_at', { ascending: false });
  if (error) { console.error('[SALES]', error.message); return res.status(500).json({ error: 'Error interno' }); }
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

  // Validar stock y descuento contra precios reales en BD
  var DISCOUNT_LIMIT = { cajero: 0.20 };
  var userRole = req.user.role;
  for (var check of items) {
    if (check.id && check.unit !== 'serv') {
      var { data: dbProd } = await supabase.from('products').select('name,stock,price').eq('id', check.id).single();
      if (dbProd) {
        if (dbProd.stock < check.qty) {
          return res.status(400).json({
            error: 'Stock insuficiente: "' + dbProd.name + '" tiene ' + dbProd.stock + ' unidad(es) y se intenta vender ' + check.qty
          });
        }
        if (DISCOUNT_LIMIT[userRole] !== undefined && dbProd.price > 0 && check.price < dbProd.price) {
          var pct = (dbProd.price - check.price) / dbProd.price;
          if (pct > DISCOUNT_LIMIT[userRole]) {
            return res.status(403).json({
              error: 'Descuento no autorizado: el rol "' + userRole + '" tiene un límite de ' + (DISCOUNT_LIMIT[userRole] * 100) + '% en "' + dbProd.name + '" (precio catálogo: Q' + dbProd.price.toFixed(2) + ', precio cobrado: Q' + Number(check.price).toFixed(2) + ')'
            });
          }
        }
      }
    }
  }

  if (payType === 'completo') {
    // Venta normal
    var { data: sale, error: sErr } = await supabase
      .from('sales')
      .insert({ client, total, method: method||'Efectivo', status:'completado', user_id: req.user.userId, registrado_por: registradoPor })
      .select().single();
    if (sErr) { console.error('[SALES]', sErr.message); return res.status(500).json({ error: 'Error interno' }); }

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
    if (aErr) { console.error('[SALES]', aErr.message); return res.status(500).json({ error: 'Error interno' }); }

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
