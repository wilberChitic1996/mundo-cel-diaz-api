const logger = require('../utils/logger');
const express   = require('express');
const router    = express.Router();
const auth      = require('../middleware/auth');
const supabase  = require('../supabase');
const logAudit  = require('../utils/audit');
const { withTenant, tid } = require('../utils/tenant');
const requireRole = require('../middleware/requireRole');
const enforceSubscription = require('../middleware/enforceSubscription');
const felService = require('../services/felService');

/**
 * @openapi
 * /sales:
 *   get:
 *     tags: [Sales]
 *     summary: Ver documentación completa en /api-docs
 *     responses:
 *       200:
 *         description: OK
 */
// GET /api/sales
router.get('/', auth, async (req, res) => {
  var q = supabase.from('sales').select('*, sale_items(*)').order('created_at', { ascending: false });
  q = withTenant(q, req);
  var { data, error } = await q;
  if (error) { logger.error({ err: error }, '[SALES]'); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data);
});

// POST /api/sales
router.post('/', auth, requireRole('admin', 'cajero'), enforceSubscription, async (req, res) => {
  var { client, total, method, items, payType, initialPay, idempotencyKey, nota, ivaPct, secondMethod, secondAmount, repairId } = req.body;

  // Marca una reparación como entregada (cobrada) — evita cobros duplicados
  async function marcarReparacionEntregada() {
    if (!repairId) return;
    var { error: repErr } = await withTenant(
      supabase.from('repairs').update({ status: 'entregado', updated_at: new Date() }).eq('id', repairId),
      req
    );
    if (repErr) logger.error({ err: repErr }, '[SALES] marcar reparación entregada');
  }
  if (!client || !items || !items.length)
    return res.status(400).json({ error: 'Datos incompletos' });

  // Brecha #4: calcular IVA incluido (precios ya incluyen IVA)
  var ivaPercent = parseFloat(ivaPct) || 0;
  var ivaAmount  = ivaPercent > 0 ? total - total / (1 + ivaPercent / 100) : 0;
  var subtotalNeto = total - ivaAmount;

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

  // Validar stock, descuento y seriales
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
      // Validar serial si el ítem trae serial_id
      if (check.serial_id) {
        var { data: dbSerial } = await supabase.from('product_serials')
          .select('id, status, imei')
          .eq('id', check.serial_id)
          .eq('tenant_id', tenantId)
          .single();
        if (!dbSerial) return res.status(400).json({ error: 'Serial no encontrado: ' + check.imei });
        if (dbSerial.status !== 'disponible') {
          return res.status(409).json({ error: 'El serial ' + dbSerial.imei + ' ya fue vendido o no está disponible' });
        }
      }
    }
  }

  // Función interna para vincular seriales después de crear la venta
  async function linkSerials(saleId, itemsList) {
    for (var it of itemsList) {
      if (it.serial_id) {
        await supabase.from('product_serials').update({
          status: 'vendido',
          sale_id: saleId,
          updated_at: new Date().toISOString(),
        }).eq('id', it.serial_id).eq('tenant_id', tenantId);
      }
    }
  }

  if (payType === 'completo') {
    var insertData = { client, total, method: method||'Efectivo', status:'completado', user_id: req.user.userId, registrado_por: registradoPor, tenant_id: tenantId, iva_percent: ivaPercent, iva_amount: ivaAmount, subtotal_neto: subtotalNeto, second_method: secondMethod||null, second_amount: secondAmount ? parseFloat(secondAmount) : null };
    if (idempotencyKey) insertData.idempotency_key = idempotencyKey;
    if (nota) insertData.nota = nota;

    var { data: sale, error: sErr } = await supabase.from('sales').insert(insertData).select().single();
    if (sErr) { logger.error({ err: sErr }, '[SALES]'); return res.status(500).json({ error: 'Error interno' }); }

    var { error: siErr } = await supabase.from('sale_items').insert(
      items.map(function(i){ return { sale_id:sale.id, product_id:(i.unit==='serv'?null:(i.id||null)), code:i.code, name:i.name, price:i.price, qty:i.qty, subtotal:i.price*i.qty, tenant_id:tenantId }; })
    );
    if (siErr) {
      logger.error('[SALES] sale_items insert failed for sale');
      await supabase.from('sales').delete().eq('id', sale.id);
      return res.status(500).json({ error: 'Error al guardar ítems de venta' });
    }

    for (var item of items) {
      if (item.id && item.unit !== 'serv') {
        var { error: rpcErr } = await supabase.rpc('decrement_stock', {
          p_product_id: item.id,
          p_qty: item.qty,
          p_tenant_id: tenantId
        });
        if (rpcErr) logger.error({ err: rpcErr }, '[SALES] decrement_stock RPC error para producto ' + item.id);
      }
    }

    await linkSerials(sale.id, items);

    await marcarReparacionEntregada();

    // FEL (facturación electrónica): dormido por defecto; certifica solo si FEL_ENABLED=true.
    // Fail-safe: nunca rompe la venta (si falla, queda reintentable vía POST /:id/emit-fel).
    await felService.certifySale(sale.id, tenantId);

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
      user_id: req.user.userId, registrado_por: registradoPor, tenant_id: tenantId,
      iva_percent: ivaPercent, iva_amount: ivaAmount, subtotal_neto: subtotalNeto,
      second_method: secondMethod||null, second_amount: secondAmount ? parseFloat(secondAmount) : null
    };
    if (nota) saleInsert2.nota = nota;
    var { data: creditSale, error: csErr } = await supabase.from('sales').insert(saleInsert2).select().single();
    if (csErr) { logger.error({ err: csErr }, '[SALES credit]'); return res.status(500).json({ error: 'Error interno' }); }

    var { error: csiErr } = await supabase.from('sale_items').insert(
      items.map(function(i){ return { sale_id:creditSale.id, product_id:(i.unit==='serv'?null:(i.id||null)), code:i.code, name:i.name, price:i.price, qty:i.qty, subtotal:i.price*i.qty, tenant_id:tenantId }; })
    );
    if (csiErr) {
      logger.error('[SALES] sale_items (credit) insert failed for sale');
      await supabase.from('sales').delete().eq('id', creditSale.id);
      return res.status(500).json({ error: 'Error al guardar ítems de venta' });
    }

    var accInsert = { client, total, paid, balance, status, method: method||'Efectivo', sale_id: creditSale.id, user_id: req.user.userId, registrado_por: registradoPor, tenant_id: tenantId };
    if (idempotencyKey) accInsert.idempotency_key = idempotencyKey;

    var { data: acc, error: aErr } = await supabase.from('accounts').insert(accInsert).select().single();
    if (aErr) { logger.error({ err: aErr }, '[SALES]'); return res.status(500).json({ error: 'Error interno' }); }

    await supabase.from('account_items').insert(
      items.map(function(i){ return { account_id:acc.id, code:i.code, name:i.name, price:i.price, qty:i.qty, tenant_id:tenantId }; })
    );

    if (paid > 0) {
      await supabase.from('account_payments').insert({
        account_id: acc.id, amount: paid, method: method||'Efectivo', note: 'Abono inicial', registrado_por: registradoPor, tenant_id: tenantId
      });
    }

    for (var item2 of items) {
      if (item2.id && item2.unit !== 'serv') {
        var { error: rpcErr2 } = await supabase.rpc('decrement_stock', {
          p_product_id: item2.id,
          p_qty: item2.qty,
          p_tenant_id: tenantId
        });
        if (rpcErr2) logger.error({ err: rpcErr2 }, '[SALES] decrement_stock RPC error para producto ' + item2.id);
      }
    }

    await linkSerials(creditSale.id, items);

    await marcarReparacionEntregada();

    // FEL: dormido por defecto; certifica la venta a crédito solo si FEL_ENABLED=true.
    await felService.certifySale(creditSale.id, tenantId);

    await logAudit(req.user, 'cuenta_creada', 'account', acc.id, {
      cliente: client, total, abono_inicial: paid, tipo: payType,
      articulos: items.map(function(i){ return i.name+' x'+i.qty; }).join(', ')
    });
    return res.status(201).json({ type:'account', sale_id: creditSale.id, ...acc });
  }
});

// POST /api/sales/:id/emit-fel — reintentar la certificación FEL de una venta (si quedó en error).
router.post('/:id/emit-fel', auth, requireRole('admin', 'cajero'), enforceSubscription, async (req, res) => {
  // Verificar que la venta pertenece al tenant antes de certificar.
  var { data: sale } = await withTenant(supabase.from('sales').select('id').eq('id', req.params.id), req).maybeSingle();
  if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });

  var result = await felService.certifySale(req.params.id, tid(req));
  if (result.status === 'disabled') return res.status(503).json({ error: 'FEL no está habilitado', code: 'FEL_DISABLED' });
  if (!result.ok) return res.status(502).json({ error: 'No se pudo certificar', detail: result.error });
  res.json({ ok: true, fel: result.data });
});

module.exports = router;
