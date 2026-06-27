const supabase = require('../supabase');
const { withTenant, tid } = require('../utils/tenant');
const logAudit = require('../utils/audit');

async function listClients(req, search) {
  var q = supabase.from('clients').select('*').eq('active', true).order('name');
  q = withTenant(q, req);
  if (search) q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
  var { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function getClient(req, id) {
  var q = supabase.from('clients').select('*').eq('id', id);
  q = withTenant(q, req);
  var { data, error } = await q.single();
  if (error) throw error;
  return data;
}

async function createClient(req, fields) {
  var row = Object.assign({}, fields, { tenant_id: tid(req), active: true });
  var { data, error } = await supabase.from('clients').insert(row).select().single();
  if (error) throw error;
  await logAudit(req.user, 'cliente_creado', 'client', data.id, { nombre: data.name });
  return data;
}

async function updateClient(req, id, fields) {
  var q = supabase.from('clients').update(Object.assign({}, fields, { updated_at: new Date() })).eq('id', id);
  q = withTenant(q, req);
  var { data, error } = await q.select().single();
  if (error) throw error;
  await logAudit(req.user, 'cliente_editado', 'client', id, fields);
  return data;
}

async function deleteClient(req, id) {
  var q = supabase.from('clients').update({ active: false, updated_at: new Date() }).eq('id', id);
  q = withTenant(q, req);
  var { error } = await q;
  if (error) throw error;
  await logAudit(req.user, 'cliente_eliminado', 'client', id, {});
}

module.exports = { listClients, getClient, createClient, updateClient, deleteClient };
