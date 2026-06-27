const supabase = require('../supabase');
const { withTenant, tid } = require('../utils/tenant');
const logAudit = require('../utils/audit');

async function listSales(req, filters) {
  filters = filters || {};
  var q = supabase.from('sales').select('*, sale_items(*)').order('created_at', { ascending: false });
  q = withTenant(q, req);
  if (filters.from) q = q.gte('created_at', filters.from);
  if (filters.to)   q = q.lte('created_at', filters.to);
  if (filters.limit) q = q.limit(filters.limit);
  var { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function getSale(req, id) {
  var q = supabase.from('sales').select('*, sale_items(*)').eq('id', id);
  q = withTenant(q, req);
  var { data, error } = await q.single();
  if (error) throw error;
  return data;
}

async function createSale(req, payload) {
  var { client, items, total, method, idempotency_key, notes, account_id } = payload;
  if (!items || !items.length) throw Object.assign(new Error('Sin artículos'), { status: 400 });
  if (!total || total <= 0)    throw Object.assign(new Error('Total inválido'), { status: 400 });

  // Idempotency check
  if (idempotency_key) {
    var { data: existing } = await supabase
      .from('sales').select('id').eq('idempotency_key', idempotency_key).eq('tenant_id', tid(req)).single();
    if (existing) return existing;
  }

  var saleRow = {
    tenant_id: tid(req),
    client: client || 'Consumidor Final',
    total,
    method: method || 'Efectivo',
    notes: notes || null,
    account_id: account_id || null,
    idempotency_key: idempotency_key || null,
    registered_by: req.user.userId,
  };

  var { data: sale, error: saleErr } = await supabase.from('sales').insert(saleRow).select().single();
  if (saleErr) throw saleErr;

  // Insert items
  var itemRows = items.map(function(it) {
    return { sale_id: sale.id, tenant_id: tid(req), product_id: it.id, name: it.name, qty: it.qty, price: it.price };
  });
  var { error: itemsErr } = await supabase.from('sale_items').insert(itemRows);
  if (itemsErr) throw itemsErr;

  // Decrement stock via RPC (SELECT FOR UPDATE)
  for (var it of items) {
    await supabase.rpc('decrement_stock', { p_product_id: it.id, p_qty: it.qty, p_tenant_id: tid(req) });
  }

  await logAudit(req.user, 'venta_registrada', 'sale', sale.id, { total, method, items: items.length });
  return sale;
}

module.exports = { listSales, getSale, createSale };
