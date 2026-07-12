const logger = require('../utils/logger');
const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');
const logAudit = require('../utils/audit');
const { withTenant, tid } = require('../utils/tenant');
const { validateRefund } = require('../utils/validate');
const requireRole = require('../middleware/requireRole');
const enforceSubscription = require('../middleware/enforceSubscription');
const cache    = require('../utils/cache');

/**
 * @openapi
 * /returns:
 *   get:
 *     tags: [Returns]
 *     summary: Ver documentación completa en /api-docs
 *     responses:
 *       200:
 *         description: OK
 */
// GET /api/returns
router.get('/', auth, async (req, res) => {
  var q = supabase.from('returns').select('*, return_items(*)').order('created_at', { ascending: false });
  q = withTenant(q, req);
  const { data, error } = await q;
  if (error) { logger.error({ err: error }, '[RETURNS]'); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data);
});

// POST /api/returns
router.post('/', auth, requireRole('admin', 'cajero'), enforceSubscription, async (req, res) => {
  const { client, saleId, reason, refundMethod, refundAmount, itemCondition, items } = req.body;
  if (!['bueno', 'defectuoso'].includes(itemCondition)) {
    return res.status(400).json({ error: 'itemCondition debe ser "bueno" o "defectuoso"' });
  }
  const total = (items||[]).reduce(function(s,i){return s+i.price*i.qty;},0);
  const tenantId = tid(req);

  // Blindaje de dinero: monto de reembolso numérico, >= 0 y <= valor de los ítems devueltos.
  var vRef = validateRefund({ refundAmount: refundAmount, itemsTotal: total });
  if (!vRef.ok) return res.status(400).json({ error: vRef.error });

  // B5 + anti-doble-devolución: si referencia una venta, validar contra lo vendido
  // DESCONTANDO las devoluciones anteriores de esa misma venta (dinero y cantidades).
  if (saleId) {
    var { data: origSale } = await withTenant(supabase.from('sales').select('id,total').eq('id', saleId), req).maybeSingle();
    if (!origSale) return res.status(404).json({ error: 'Venta original no encontrada' });

    // Devoluciones previas de esta venta
    var { data: prevRets } = await withTenant(
      supabase.from('returns').select('id,refund_amount').eq('sale_id', saleId), req
    );
    var prevRefunded = (prevRets||[]).reduce(function(s2,r){ return s2 + Number(r.refund_amount||0); }, 0);
    var vRef2 = validateRefund({ refundAmount: refundAmount, saleTotal: origSale.total, prevRefunded: prevRefunded });
    if (!vRef2.ok) return res.status(400).json({ error: vRef2.error });

    // Venta a CREDITO: si el reembolso SALE de caja (Efectivo/Tarjeta), no puede superar
    // lo realmente COBRADO de esa venta (abonos), no lo vendido. Lo no cobrado se
    // resuelve con 'Credito en cuenta' (reduce la deuda, no saca dinero).
    if (refundMethod === 'Efectivo' || refundMethod === 'Tarjeta') {
      var { data: accOfSale } = await withTenant(
        supabase.from('accounts').select('paid').eq('sale_id', saleId), req
      ).maybeSingle();
      if (accOfSale) {
        var cobrado = Number(accOfSale.paid) || 0;
        if (Number(refundAmount) > cobrado - prevRefunded + 0.01) {
          return res.status(400).json({ error: 'De esta venta a credito solo se han cobrado Q' + (cobrado - prevRefunded).toFixed(2) + '. No se puede devolver mas que eso en ' + refundMethod + ' - usa "Credito en cuenta" para reducir la deuda.' });
        }
      }
    }

    var { data: soldItems } = await withTenant(supabase.from('sale_items').select('code,qty').eq('sale_id', saleId), req);
    var soldByCode = {};
    (soldItems||[]).forEach(function(si){ soldByCode[si.code] = (soldByCode[si.code]||0) + Number(si.qty); });

    // Restar cantidades ya devueltas en devoluciones previas
    var prevIds = (prevRets||[]).map(function(r){ return r.id; });
    if (prevIds.length) {
      var { data: prevItems } = await withTenant(
        supabase.from('return_items').select('code,qty').in('return_id', prevIds), req
      );
      (prevItems||[]).forEach(function(pi){
        if (pi.code && soldByCode[pi.code] !== undefined) soldByCode[pi.code] -= Number(pi.qty);
      });
    }

    for (var ri of (items||[])) {
      if (ri.code && soldByCode[ri.code] !== undefined && Number(ri.qty) > soldByCode[ri.code] + 0.01) {
        return res.status(400).json({ error: 'No se puede devolver más de lo vendido (contando devoluciones anteriores) de "' + (ri.name||ri.code) + '"' });
      }
    }
  }

  const { data: ret, error } = await supabase
    .from('returns')
    .insert({ client, sale_id: saleId||null, reason,
      refund_method: refundMethod,
      refund_amount: refundAmount||0,
      item_condition: itemCondition||'bueno',
      total, user_id: req.user.userId, tenant_id: tenantId })
    .select().single();
  if (error) { logger.error({ err: error }, '[RETURNS]'); return res.status(500).json({ error: 'Error interno' }); }

  if (items && items.length) {
    await supabase.from('return_items').insert(
      items.map(function(i){ return { return_id:ret.id, code:i.code, name:i.name, price:i.price, qty:i.qty, tenant_id: tenantId }; })
    );
  }

  if (itemCondition === 'bueno') {
    for (var item of items) {
      // B5: resolver el producto de forma robusta (por id si viene, si no por código sin .single()).
      var pid = item.productId || null;
      if (!pid && item.code) {
        var { data: pRows } = await withTenant(supabase.from('products').select('id').eq('code', item.code).limit(1), req);
        if (pRows && pRows.length) pid = pRows[0].id;
      }
      if (!pid) continue;
      // B4: reingreso ATÓMICO + movimiento de inventario (entrada por devolución).
      var { data: newStock, error: incErr } = await supabase.rpc('increment_stock', { p_product_id: pid, p_qty: Number(item.qty), p_tenant_id: tenantId });
      if (incErr) { logger.error({ err: incErr }, '[RETURNS] increment_stock devolución'); continue; }
      await supabase.from('stock_movements').insert({
        tenant_id: tenantId, product_id: pid, type: 'devolucion',
        qty_before: Number(newStock) - Number(item.qty), qty_change: Number(item.qty), qty_after: Number(newStock),
        reason: 'Devolución' + (reason ? ' — ' + reason : ''), reference_id: ret.id,
        user_name: req.user.name, user_role: req.user.role,
      });
    }
    // C3: el reingreso cambió stock → invalidar la caché de la lista de productos.
    await cache.del('products:' + tenantId);
  } else {
    var defItems = items.map(function(i){ return { return_id:ret.id, code:i.code, name:i.name, qty:i.qty, price:i.price, reason:reason, status:'defectuoso', tenant_id: tenantId }; });
    await supabase.from('defectives').insert(defItems);
  }

  await logAudit(req.user, 'devolucion_registrada', 'return', ret.id, {
    cliente: client, motivo: reason, condicion: itemCondition||'bueno',
    reembolso_metodo: refundMethod||'—', reembolso_monto: refundAmount||0, total,
    articulos: (items||[]).map(function(i){ return i.name+' x'+i.qty; }).join(', ')
  });
  res.status(201).json(ret);
});

module.exports = router;
