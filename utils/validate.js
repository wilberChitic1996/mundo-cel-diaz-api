// utils/validate.js
// Blindaje de dinero (Ronda A): validaciones puras de entradas monetarias.
// El servidor NO confía en los montos del cliente — los recalcula y acota.
// Funciones puras (sin BD) para poder testearlas unitariamente.

var TOL = 0.01; // tolerancia de centavos por redondeo

/**
 * Valida los ítems y el total de una venta.
 * - qty > 0 y price >= 0 en cada ítem (numéricos y finitos)
 * - el total debe coincidir con Σ(price*qty) (±0.01)
 * - si hay pago dividido: 0 < secondAmount < total
 * - si hay abono inicial (venta parcial): 0 <= initialPay
 * @returns {{ok:boolean, error?:string}}
 */
function validateSaleInput(input) {
  input = input || {};
  var items = input.items || [];
  var total = Number(input.total);

  if (!isFinite(total) || total < 0) return { ok: false, error: 'Total inválido' };

  var computed = 0;
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    var qty = Number(it.qty);
    var price = Number(it.price);
    if (!isFinite(qty) || qty <= 0)
      return { ok: false, error: 'Cantidad inválida en "' + (it.name || it.code || 'ítem ' + (i + 1)) + '"' };
    if (!isFinite(price) || price < 0)
      return { ok: false, error: 'Precio inválido en "' + (it.name || it.code || 'ítem ' + (i + 1)) + '"' };
    computed += price * qty;
  }
  if (Math.abs(computed - total) > TOL)
    return { ok: false, error: 'El total (' + total + ') no coincide con la suma de los productos (' + computed.toFixed(2) + ')' };

  if (input.secondMethod) {
    var second = Number(input.secondAmount);
    if (!isFinite(second) || second <= 0 || second >= total - TOL)
      return { ok: false, error: 'Monto del segundo método de pago inválido' };
  }

  if (input.payType === 'parcial') {
    var ini = Number(input.initialPay || 0);
    if (!isFinite(ini) || ini < 0)
      return { ok: false, error: 'El abono inicial no puede ser negativo' };
  }

  return { ok: true };
}

/**
 * Valida el monto de un abono contra el saldo de la cuenta.
 * - monto numérico, > 0
 * - no mayor al saldo pendiente (±0.01)
 * @returns {{ok:boolean, error?:string}}
 */
function validatePaymentAmount(amount, balance) {
  var amt = Number(amount);
  var bal = Number(balance);
  if (!isFinite(amt) || amt <= 0) return { ok: false, error: 'El monto del abono debe ser mayor a 0' };
  if (isFinite(bal) && amt > bal + TOL)
    return { ok: false, error: 'El abono (' + amt + ') no puede exceder el saldo pendiente (' + bal + ')' };
  return { ok: true };
}

/**
 * Valida el monto de un reembolso de devolución.
 * - numérico y >= 0
 * - no mayor al remanente de la venta (total - ya reembolsado) si hay venta ligada
 * - no mayor al valor de los ítems devueltos (itemsTotal), con tolerancia
 * @returns {{ok:boolean, error?:string}}
 */
function validateRefund(input) {
  input = input || {};
  var refund = Number(input.refundAmount || 0);
  if (!isFinite(refund) || refund < 0) return { ok: false, error: 'Monto de reembolso inválido' };

  if (input.saleTotal !== undefined && input.saleTotal !== null) {
    var remaining = Number(input.saleTotal) - Number(input.prevRefunded || 0);
    if (refund > remaining + TOL)
      return { ok: false, error: 'El reembolso (' + refund + ') excede lo que queda por devolver de esta venta (' + Math.max(0, remaining).toFixed(2) + ')' };
  }

  if (input.itemsTotal !== undefined && input.itemsTotal !== null && refund > Number(input.itemsTotal) + TOL)
    return { ok: false, error: 'El reembolso (' + refund + ') excede el valor de los artículos devueltos (' + Number(input.itemsTotal).toFixed(2) + ')' };

  return { ok: true };
}

module.exports = { validateSaleInput, validatePaymentAmount, validateRefund, TOL };
