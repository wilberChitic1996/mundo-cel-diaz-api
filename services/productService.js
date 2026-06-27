const supabase = require('../supabase');
const { withTenant, tid } = require('../utils/tenant');
const logAudit = require('../utils/audit');
const logger = require('../utils/logger');

async function listProducts(req) {
  var q = supabase.from('products').select('*').eq('active', true).order('name');
  q = withTenant(q, req);
  var { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function getProduct(req, id) {
  var q = supabase.from('products').select('*').eq('id', id);
  q = withTenant(q, req);
  var { data, error } = await q.single();
  if (error) throw error;
  return data;
}

async function createProduct(req, fields) {
  var { data: codeData, error: codeError } = await supabase.rpc('generate_product_code');
  if (codeError) throw codeError;

  var row = Object.assign({}, fields, { sku: codeData, tenant_id: tid(req), active: true });
  var { data, error } = await supabase.from('products').insert(row).select().single();
  if (error) throw error;

  await logAudit(req.user, 'producto_creado', 'product', data.id, { nombre: data.name });
  return data;
}

async function updateProduct(req, id, fields) {
  var q = supabase.from('products').update(Object.assign({}, fields, { updated_at: new Date() })).eq('id', id);
  q = withTenant(q, req);
  var { data, error } = await q.select().single();
  if (error) throw error;

  await logAudit(req.user, 'producto_editado', 'product', id, fields);
  return data;
}

async function deleteProduct(req, id) {
  var q = supabase.from('products').update({ active: false, updated_at: new Date() }).eq('id', id);
  q = withTenant(q, req);
  var { error } = await q;
  if (error) throw error;

  await logAudit(req.user, 'producto_eliminado', 'product', id, {});
}

async function adjustStock(req, id, delta, reason) {
  var { error } = await supabase.rpc('adjust_stock', { p_product_id: id, p_delta: delta, p_tenant_id: tid(req) });
  if (error) {
    logger.warn({ err: error, id, delta }, '[productService] adjust_stock RPC failed, using update fallback');
    var qGet = supabase.from('products').select('stock').eq('id', id);
    qGet = withTenant(qGet, req);
    var { data: prod } = await qGet.single();
    var newStock = Math.max(0, (prod ? prod.stock : 0) + delta);
    var qUpd = supabase.from('products').update({ stock: newStock }).eq('id', id);
    qUpd = withTenant(qUpd, req);
    var { error: updErr } = await qUpd;
    if (updErr) throw updErr;
  }
  await logAudit(req.user, 'stock_ajustado', 'product', id, { delta, reason });
}

module.exports = { listProducts, getProduct, createProduct, updateProduct, deleteProduct, adjustStock };
