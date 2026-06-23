// utils/tenant.js — helpers para filtrado por tenant en Supabase queries
function withTenant(q, req) {
  if (!req.user || req.user.role === 'superadmin' || !req.user.tenant_id) return q;
  return q.eq('tenant_id', req.user.tenant_id);
}
function tid(req) {
  if (!req.user || req.user.role === 'superadmin') return null;
  return req.user.tenant_id || null;
}
module.exports = { withTenant, tid };
