// services/felService.js
// Orquesta la certificación FEL de una venta: arma el DTE (provider-agnostic) desde el tenant
// (emisor), el cliente (receptor) y los ítems; llama al proveedor; y guarda el resultado en la
// fila de `sales`. FAIL-SAFE: la venta NUNCA se pierde si FEL falla — queda fel_status='error'
// y se puede reintentar con POST /api/sales/:id/emit-fel.
//
// DORMIDO por defecto: si FEL_ENABLED!=='true', certifySale() devuelve {status:'disabled'} sin
// tocar la BD, así el flujo de venta actual no cambia en absoluto.
const supabase = require('../supabase');
const logger   = require('../utils/logger');
const fel      = require('./felProvider');

// Construye el DTE neutral (sin atarse a ningún proveedor) desde la venta y el tenant emisor.
function buildDTE(sale, tenant) {
  return {
    emisor: {
      nit:       tenant && tenant.nit ? tenant.nit : null,
      nombre:    tenant && (tenant.fiscal_name || tenant.name) ? (tenant.fiscal_name || tenant.name) : null,
      direccion: tenant && tenant.address ? tenant.address : null,
      regimen:   tenant && tenant.sat_regime ? tenant.sat_regime : null,
      moneda:    tenant && tenant.currency ? tenant.currency : 'GTQ',
    },
    receptor: {
      nit:    sale.client_nit || 'CF',
      nombre: sale.client || 'Consumidor Final',
    },
    totales: {
      total:         Number(sale.total) || 0,
      iva_percent:   Number(sale.iva_percent) || 0,
      iva_amount:    Number(sale.iva_amount) || 0,
      subtotal_neto: Number(sale.subtotal_neto) || 0,
    },
    items: (sale.sale_items || []).map(function (i) {
      return { codigo: i.code, descripcion: i.name, cantidad: i.qty, precio: i.price, subtotal: i.subtotal };
    }),
  };
}

// Certifica una venta ya creada. Devuelve {ok, status, data?, error?}. NUNCA lanza.
async function certifySale(saleId, tenantId) {
  if (!fel.isEnabled()) return { ok: false, status: 'disabled' };
  try {
    var { data: sale } = await supabase.from('sales').select('*, sale_items(*)').eq('id', saleId).single();
    if (!sale) return { ok: false, status: 'not_found' };
    var { data: tenant } = await supabase
      .from('tenants').select('nit,fiscal_name,name,address,sat_regime,currency,email').eq('id', tenantId).single();

    var dte = buildDTE(sale, tenant);
    var result = await fel.getProvider().emitDTE(dte);

    await supabase.from('sales').update({
      fel_uuid:   result.uuid || null,
      fel_serie:  result.serie || null,
      fel_numero: result.numero || null,
      fel_status: 'certificado',
      fel_fecha:  result.fecha || new Date().toISOString(),
      fel_error:  null,
    }).eq('id', saleId);

    logger.info({ saleId: saleId, uuid: result.uuid }, '[FEL] venta certificada');
    return { ok: true, status: 'certificado', data: result };
  } catch (e) {
    var msg = e && e.message ? String(e.message).slice(0, 500) : 'error';
    logger.error({ err: msg, saleId: saleId }, '[FEL] error certificando — la venta persiste, reintentable');
    try { await supabase.from('sales').update({ fel_status: 'error', fel_error: msg }).eq('id', saleId); } catch { /* no-op */ }
    return { ok: false, status: 'error', error: msg };
  }
}

module.exports = { certifySale, buildDTE, isEnabled: fel.isEnabled };
