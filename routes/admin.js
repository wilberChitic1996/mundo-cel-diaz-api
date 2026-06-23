const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const auth     = require('../middleware/auth');
const supabase = require('../supabase');

function superadminOnly(req, res, next) {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Acceso denegado' });
  next();
}

// POST /api/admin/init — crea el superadmin (una sola vez, protegido por INIT_SECRET)
router.post('/init', async (req, res) => {
  var { secret, name, email, password } = req.body;
  if (!secret || secret !== process.env.INIT_SECRET)
    return res.status(403).json({ error: 'Secreto de inicialización incorrecto' });
  if (!name || !email || !password)
    return res.status(400).json({ error: 'name, email y password requeridos' });

  var { data: existing } = await supabase.from('users').select('id').eq('role', 'superadmin').limit(1).maybeSingle();
  if (existing) return res.status(409).json({ error: 'Ya existe un superadmin' });

  var hash = await bcrypt.hash(password, 10);
  var { data, error } = await supabase
    .from('users')
    .insert({ name, email: email.toLowerCase(), password_hash: hash, role: 'superadmin', active: true, tenant_id: null })
    .select('id,name,email,role').single();
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.status(201).json({ ok: true, user: data });
});

// GET /api/admin/tenants
router.get('/tenants', auth, superadminOnly, async (req, res) => {
  var { data: tenants, error } = await supabase
    .from('tenants')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Error interno' });

  var { data: userCounts } = await supabase
    .from('users')
    .select('tenant_id')
    .neq('role', 'superadmin')
    .eq('active', true);

  var counts = {};
  (userCounts || []).forEach(function(u) {
    if (u.tenant_id) counts[u.tenant_id] = (counts[u.tenant_id] || 0) + 1;
  });

  var result = (tenants || []).map(function(t) {
    return Object.assign({}, t, { user_count: counts[t.id] || 0 });
  });
  res.json(result);
});

// POST /api/admin/tenants — crear nuevo tenant + admin inicial
router.post('/tenants', auth, superadminOnly, async (req, res) => {
  var { name, plan, email, phone, ownerName, adminEmail, adminPassword, notes, months } = req.body;
  if (!name || !adminEmail || !adminPassword)
    return res.status(400).json({ error: 'name, adminEmail y adminPassword requeridos' });

  // Calcular fecha de vencimiento (default 1 mes)
  var expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + (Number(months) || 1));

  var { data: tenant, error: tErr } = await supabase
    .from('tenants')
    .insert({ name, plan: plan || 'basic', email: email || null, phone: phone || null, owner_name: ownerName || null, notes: notes || null, expires_at: expiresAt.toISOString() })
    .select().single();
  if (tErr) return res.status(500).json({ error: 'Error creando tenant: ' + tErr.message });

  var hash = await bcrypt.hash(adminPassword, 10);
  var { data: adminUser, error: uErr } = await supabase
    .from('users')
    .insert({ name: ownerName || name, email: adminEmail.toLowerCase(), password_hash: hash, role: 'admin', active: true, tenant_id: tenant.id })
    .select('id,name,email,role').single();
  if (uErr) {
    await supabase.from('tenants').delete().eq('id', tenant.id);
    return res.status(500).json({ error: 'Error creando usuario admin: ' + uErr.message });
  }

  await supabase.from('store_settings').insert([
    { key: 'store_name',      value: name,    tenant_id: tenant.id },
    { key: 'store_tagline',   value: 'Tecnología · Accesorios · Reparaciones · Guatemala', tenant_id: tenant.id },
    { key: 'onboarding_done', value: 'false', tenant_id: tenant.id },
  ]);

  res.status(201).json({ tenant, admin: adminUser });
});

// PUT /api/admin/tenants/:id — actualizar plan, active, renovar suscripción
router.put('/tenants/:id', auth, superadminOnly, async (req, res) => {
  var { name, plan, active, email, phone, ownerName, notes, months } = req.body;
  var updates = { updated_at: new Date() };
  if (name      !== undefined) updates.name       = name;
  if (plan      !== undefined) updates.plan       = plan;
  if (active    !== undefined) updates.active     = active;
  if (email     !== undefined) updates.email      = email;
  if (phone     !== undefined) updates.phone      = phone;
  if (ownerName !== undefined) updates.owner_name = ownerName;
  if (notes     !== undefined) updates.notes      = notes;

  // Renovar suscripción: extiende desde hoy o desde vencimiento actual
  if (months) {
    var { data: current } = await supabase.from('tenants').select('expires_at').eq('id', req.params.id).single();
    var base = current && current.expires_at && new Date(current.expires_at) > new Date()
      ? new Date(current.expires_at)
      : new Date();
    base.setMonth(base.getMonth() + Number(months));
    updates.expires_at = base.toISOString();
    if (active === undefined) updates.active = true; // reactivar al renovar
  }

  var { data, error } = await supabase
    .from('tenants').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.json(data);
});

// GET /api/admin/stats
router.get('/stats', auth, superadminOnly, async (req, res) => {
  var now = new Date().toISOString();
  var [tenantRes, userRes, saleRes] = await Promise.all([
    supabase.from('tenants').select('id,active,expires_at'),
    supabase.from('users').select('id', { count: 'exact' }).neq('role','superadmin').eq('active', true),
    supabase.from('sales').select('total').gte('created_at', new Date(Date.now() - 30*86400000).toISOString()),
  ]);
  var tenants = tenantRes.data || [];
  var expiringSoon = tenants.filter(function(t){
    if (!t.expires_at) return false;
    var diff = (new Date(t.expires_at) - new Date()) / 86400000;
    return diff >= 0 && diff <= 7;
  }).length;
  var expired = tenants.filter(function(t){ return t.expires_at && new Date(t.expires_at) < new Date(); }).length;
  var totalRevenue30d = (saleRes.data || []).reduce(function(s,r){ return s + Number(r.total||0); }, 0);
  res.json({
    total_tenants:   tenants.length,
    active_tenants:  tenants.filter(function(t){ return t.active; }).length,
    expiring_soon:   expiringSoon,
    expired:         expired,
    total_users:     userRes.count || 0,
    revenue_30d:     totalRevenue30d,
  });
});

// GET /api/admin/subscription — verifica suscripción del tenant actual (para el frontend)
router.get('/subscription', auth, async (req, res) => {
  if (!req.user.tenant_id) return res.json({ ok: true, daysLeft: null });
  var { data, error } = await supabase.from('tenants').select('active,expires_at,plan,name').eq('id', req.user.tenant_id).single();
  if (error || !data) return res.status(404).json({ error: 'Tenant no encontrado' });
  if (!data.active) return res.status(403).json({ error: 'Suscripción inactiva. Contactá al administrador.' });
  var daysLeft = null;
  if (data.expires_at) {
    daysLeft = Math.ceil((new Date(data.expires_at) - new Date()) / 86400000);
    if (daysLeft < 0) return res.status(403).json({ error: 'Suscripción vencida. Contactá al administrador para renovar.' });
  }
  res.json({ ok: true, daysLeft, plan: data.plan, tenantName: data.name });
});

module.exports = router;
