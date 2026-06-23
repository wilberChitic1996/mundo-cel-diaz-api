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

// GET /api/admin/tenants — lista todos los tenants con stats básicas
router.get('/tenants', auth, superadminOnly, async (req, res) => {
  var { data: tenants, error } = await supabase
    .from('tenants')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Error interno' });

  // Contar usuarios por tenant
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

// POST /api/admin/tenants — crear nuevo tenant + usuario admin inicial
router.post('/tenants', auth, superadminOnly, async (req, res) => {
  var { name, plan, email, phone, ownerName, adminEmail, adminPassword, notes } = req.body;
  if (!name || !adminEmail || !adminPassword)
    return res.status(400).json({ error: 'name, adminEmail y adminPassword requeridos' });

  // Crear tenant
  var { data: tenant, error: tErr } = await supabase
    .from('tenants')
    .insert({ name, plan: plan || 'basic', email: email || null, phone: phone || null, owner_name: ownerName || null, notes: notes || null })
    .select().single();
  if (tErr) return res.status(500).json({ error: 'Error creando tenant: ' + tErr.message });

  // Crear admin del tenant
  var hash = await bcrypt.hash(adminPassword, 10);
  var { data: adminUser, error: uErr } = await supabase
    .from('users')
    .insert({ name: ownerName || name, email: adminEmail.toLowerCase(), password_hash: hash, role: 'admin', active: true, tenant_id: tenant.id })
    .select('id,name,email,role').single();
  if (uErr) {
    await supabase.from('tenants').delete().eq('id', tenant.id);
    return res.status(500).json({ error: 'Error creando usuario admin: ' + uErr.message });
  }

  // Insertar settings iniciales para el tenant
  await supabase.from('store_settings').insert([
    { key: 'store_name', value: name, tenant_id: tenant.id },
    { key: 'store_tagline', value: 'Tecnología · Accesorios · Reparaciones · Guatemala', tenant_id: tenant.id },
    { key: 'onboarding_done', value: 'false', tenant_id: tenant.id },
  ]);

  res.status(201).json({ tenant, admin: adminUser });
});

// PUT /api/admin/tenants/:id — actualizar plan, active, etc.
router.put('/tenants/:id', auth, superadminOnly, async (req, res) => {
  var { name, plan, active, email, phone, ownerName, notes } = req.body;
  var updates = { updated_at: new Date() };
  if (name      !== undefined) updates.name       = name;
  if (plan      !== undefined) updates.plan       = plan;
  if (active    !== undefined) updates.active     = active;
  if (email     !== undefined) updates.email      = email;
  if (phone     !== undefined) updates.phone      = phone;
  if (ownerName !== undefined) updates.owner_name = ownerName;
  if (notes     !== undefined) updates.notes      = notes;

  var { data, error } = await supabase
    .from('tenants').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.json(data);
});

// GET /api/admin/stats — estadísticas de la plataforma
router.get('/stats', auth, superadminOnly, async (req, res) => {
  var [tenantRes, userRes, saleRes] = await Promise.all([
    supabase.from('tenants').select('id,active', { count: 'exact' }),
    supabase.from('users').select('id', { count: 'exact' }).neq('role','superadmin').eq('active', true),
    supabase.from('sales').select('total').gte('created_at', new Date(Date.now() - 30*86400000).toISOString()),
  ]);
  var totalRevenue30d = (saleRes.data || []).reduce(function(s,r){ return s + Number(r.total||0); }, 0);
  res.json({
    total_tenants:  tenantRes.count || 0,
    active_tenants: (tenantRes.data || []).filter(function(t){ return t.active; }).length,
    total_users:    userRes.count || 0,
    revenue_30d:    totalRevenue30d,
  });
});

module.exports = router;
