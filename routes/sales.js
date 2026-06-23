const express   = require('express');
const router    = express.Router();
const auth      = require('../middleware/auth');
const supabase  = require('../supabase');
const logAudit  = require('../utils/audit');
const { withTenant, tid } = require('../utils/tenant');

// GET /api/sales
router.get('/', auth, async (req, res) => {
  var q = supabase.from('sales').select('*, sale_items(*)').order('created_at', { ascending: false });
  q = withTenant(q, req);
  var { data, error } = await q;
  if (error) { console.error('[SALES]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data);
});

// POST /api/sales
router.post('/', auth, async (req, res) => {
  var { client, total, method, items, payType, initialPay, idempotencyKey } = req.body;
  if (!client || !items || !items.length)
    return res.status(400).json({ error: 'Datos incompletos' });

  var registradoPor = { name: req.user.name, role: req.user.role };
  var tenantId = tid(req);
  payType = payType || 'completo';

  // Idempotency check para ventas completas
  if (idempotencyKey && payType === 'completo') {
    var { data: existing } = await withTenant(supabase.from('sales').select('id').eq('idempotency_key', idempotencyKey), req).maybeSingle();
    if (existing) return res.status(200).json(existing);
  }

  // Idempotency check para cuentas por cobrar
  if (idempotencyKey && payType !== 'completo') {
    var { data: existingAcc } = await withTenant(supabase.from('accounts').select('id').eq('idempotency_key', idempotencyKey), req).maybeSingle();
    if (existingAcc) return res.status(200).json(Object.assign({ type: 'account' }, existingAcc));
  }

  // Validar stock y descuento
  var DISCOUNT_LIMIT = { cajero: 0.20 };
  var userRole = req.user.role;
  for (var check of items) {
    if (check.id && check.unit !== 'serv') {
      var { data: dbProd } = await withTenant(supabase.from('products').select('name,stock,price').eq('id', check.id), req).single();
      if (dbProd) {
        if (dbProd.stock < check.qty) {
          return res.status(400).json({ error: 'Stock insuficiente: "' + dbProd.name + '" tiene ' + dbProd.stock + ' unidad(es) y se intenta vender ' + check.qty });
        }
        if (DISCOUNT_LIMIT[userRole] !== undefined && dbProd.price > 0 && check.price < dbProd.price) {
          var pct = (dbProd.price - check.price) / dbProd.price;
          if (pct > DISCOUNT_LIMIT[userRole]) {
            return res.status(403).json({ error: 'Descuento no autorizado: el rol "' + userRole + '" tiene un límite de ' + (DISCOUNT_LIMIT[userRole] * 100) + '% en "' + dbProd.name + '"' });
          }
        }
      }
    }
  }

  if (payType === 'completo') {
    var insertData = { client, total, method: method||'Efectivo', status:'completado', user_id: req.user.userId, registrado_por: registradoPor, tenant_id: tenantId };
    if (idempotencyKey) insertData.idempotency_key = idempotencyKey;

    var { data: sale, error: sErr } = await supabase.from('sales').insert(insertData).select().single();
    if (sErr) { console.error('[SALES]', sErr.message); return res.status(500).json({ error: 'Error interno' }); }

    await supabase.from('sale_items').insert(
      items.map(function(i){ return { sale_id:sale.id, product_id:i.id||null, code:i.code, name:i.name, price:i.price, qty:i.qty, subtotal:i.price*i.qty }; })
    );

    for (var item of items) {
      if (item.id && item.unit !== 'serv') {
        var { data: prod } = await withTenant(supabase.from('products').select('stock').eq('id', item.id), req).single();
        if (prod && prod.stock >= item.qty) {
          await withTenant(supabase.from('products').update({ stock: prod.stock - item.qty, updated_at: new Date() }).eq('id', item.id), req);
        }
      }
    }

    await logAudit(req.user, 'venta_completada', 'sale', sale.id, {
      cliente: client, total, metodo: method||'Efectivo',
      articulos: items.map(function(i){ return i.name+' x'+i.qty; }).join(', ')
    });
    return res.status(201).json(sale);

  } else {
    var paid    = payType === 'parcial' ? Math.min(parseFloat(initialPay)||0, total) : 0;
    var balance = total - paid;
    var status  = balance <= 0 ? 'pagado' : paid > 0 ? 'parcial' : 'pendiente';

    // Crear el registro en sales para que aparezca en reportes y respaldo
    var saleInsert2 = {
      client, total, method: method||'Efectivo', status: 'cuenta',
      pay_type: payType === 'parcial' ? 'parcial' : 'credito',
      user_id: req.user.userId, registrado_por: registradoPor, tenant_id: tenantId
    };
    var { data: creditSale, error: csErr } = await supabase.from('sales').insert(saleInsert2).select().single();
    if (csErr) { console.error('[SALES credit]', csErr.message); return res.status(500).json({ error: 'Error interno' }); }

    await supabase.from('sale_items').insert(
      items.map(function(i){ return { sale_id:creditSale.id, product_id:i.id||null, code:i.code, name:i.name, price:i.price, qty:i.qty, subtotal:i.price*i.qty }; })
    );

    var accInsert = { client, total, paid, balance, status, method: method||'Efectivo', sale_id: creditSale.id, user_id: req.user.userId, registrado_por: registradoPor, tenant_id: tenantId };
    if (idempotencyKey) accInsert.idempotency_key = idempotencyKey;

    var { data: acc, error: aErr } = await supabase.from('accounts').insert(accInsert).select().single();
    if (aErr) { console.error('[SALES]', aErr.message); return res.status(500).json({ error: 'Error interno' }); }

    await supabase.from('account_items').insert(
      items.map(function(i){ return { account_id:acc.id, code:i.code, name:i.name, price:i.price, qty:i.qty }; })
    );

    if (paid > 0) {
      await supabase.from('account_payments').insert({
        account_id: acc.id, amount: paid, method: method||'Efectivo', note: 'Abono inicial', registrado_por: registradoPor
      });
    }

    for (var item2 of items) {
      if (item2.id && item2.unit !== 'serv') {
        var { data: prod2 } = await withTenant(supabase.from('products').select('stock').eq('id', item2.id), req).single();
        if (prod2 && prod2.stock >= item2.qty) {
          await withTenant(supabase.from('products').update({ stock: prod2.stock - item2.qty, updated_at: new Date() }).eq('id', item2.id), req);
        }
      }
    }

    await logAudit(req.user, 'cuenta_creada', 'account', acc.id, {
      cliente: client, total, abono_inicial: paid, tipo: payType,
      articulos: items.map(function(i){ return i.name+' x'+i.qty; }).join(', ')
    });
    return res.status(201).json({ type:'account', sale_id: creditSale.id, ...acc });
  }
});

module.exports = router;
