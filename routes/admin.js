const logger = require('../utils/logger');
const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const auth     = require('../middleware/auth');
const supabase = require('../supabase');

function superadminOnly(req, res, next) {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Acceso denegado' });
  next();
}

/**
 * @openapi
 * /admin:
 *   get:
 *     tags: [Admin]
 *     summary: Ver documentación completa en /api-docs
 *     responses:
 *       200:
 *         description: OK
 */
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
  var { name, plan, email, phone, ownerName, adminEmail, adminPassword, notes, months, skipWizard } = req.body;
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
    { key: 'onboarding_done', value: skipWizard ? 'true' : 'false', tenant_id: tenant.id },
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

// GET /api/admin/tenants/:id/users — lista usuarios de un tenant
router.get('/tenants/:id/users', auth, superadminOnly, async (req, res) => {
  var { data, error } = await supabase
    .from('users')
    .select('id,name,email,role,active,created_at')
    .eq('tenant_id', req.params.id)
    .neq('role', 'superadmin')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.json(data || []);
});

// PUT /api/admin/users/:id/reset-password — resetea contraseña de cualquier usuario
router.put('/users/:id/reset-password', auth, superadminOnly, async (req, res) => {
  var { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  var { data: targetUser } = await supabase
    .from('users').select('id,role,tenant_id').eq('id', req.params.id).single();
  if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (targetUser.role === 'superadmin') return res.status(403).json({ error: 'No se puede modificar al superadmin desde aquí' });

  var hash = await bcrypt.hash(newPassword, 10);
  var { error } = await supabase.from('users').update({ password_hash: hash }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.json({ ok: true });
});

// PUT /api/admin/users/:id/toggle — activar/desactivar usuario
router.put('/users/:id/toggle', auth, superadminOnly, async (req, res) => {
  var { data: targetUser } = await supabase.from('users').select('id,role,active').eq('id', req.params.id).single();
  if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (targetUser.role === 'superadmin') return res.status(403).json({ error: 'No permitido' });

  var { data, error } = await supabase
    .from('users').update({ active: !targetUser.active }).eq('id', req.params.id).select('id,name,email,role,active').single();
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.json(data);
});

// PUT /api/admin/me — superadmin actualiza sus propias credenciales
router.put('/me', auth, superadminOnly, async (req, res) => {
  var { name, email, currentPassword, newPassword } = req.body;
  if (!currentPassword) return res.status(400).json({ error: 'Se requiere la contraseña actual' });

  var { data: me } = await supabase.from('users').select('id,password_hash').eq('id', req.user.userId).single();
  if (!me) return res.status(404).json({ error: 'Usuario no encontrado' });

  var valid = await bcrypt.compare(currentPassword, me.password_hash);
  if (!valid) return res.status(401).json({ error: 'Contraseña actual incorrecta' });

  var updates = {};
  if (name)  updates.name  = name;
  if (email) updates.email = email.toLowerCase();
  if (newPassword) {
    if (newPassword.length < 6) return res.status(400).json({ error: 'Nueva contraseña debe tener al menos 6 caracteres' });
    updates.password_hash = await bcrypt.hash(newPassword, 10);
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

  var { data, error } = await supabase
    .from('users').update(updates).eq('id', req.user.userId).select('id,name,email,role').single();
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.json(data);
});

// DELETE /api/admin/tenants/:id — eliminar negocio y todos sus datos
router.delete('/tenants/:id', auth, superadminOnly, async (req, res) => {
  var id = req.params.id;
  var deleteErrors = [];

  // Tablas con tenant_id directo — borrar en orden FK-safe
  var directTables = [
    'audit_logs','caja_gastos','caja_sesiones','warranties','defectives',
    'returns','sales','repairs','purchases','suppliers','products','clients',
    'store_settings','accounts','users'
  ];

  // Tablas hijo sin tenant_id — borrar vía FK de la tabla padre
  var childDeletes = [
    { child: 'sale_items',      fkCol: 'sale_id',     parent: 'sales' },
    { child: 'account_items',   fkCol: 'account_id',  parent: 'accounts' },
    { child: 'account_payments',fkCol: 'account_id',  parent: 'accounts' },
    { child: 'return_items',    fkCol: 'return_id',   parent: 'returns' },
    { child: 'purchase_items',  fkCol: 'purchase_id', parent: 'purchases' },
  ];

  // 1. Borrar tablas hijo primero (antes de borrar padres)
  for (var cd of childDeletes) {
    var { data: parentIds } = await supabase.from(cd.parent).select('id').eq('tenant_id', id);
    if (parentIds && parentIds.length) {
      var ids = parentIds.map(function(r){ return r.id; });
      var { error: cdErr } = await supabase.from(cd.child).delete().in(cd.fkCol, ids);
      if (cdErr) { logger.error({ err: cdErr }, '[ADMIN] Error al eliminar ' + cd.child); deleteErrors.push(cd.child); }
    }
  }

  // 2. Borrar tablas directas
  for (var table of directTables) {
    var { error: tErr } = await supabase.from(table).delete().eq('tenant_id', id);
    if (tErr) { logger.error({ err: tErr }, '[ADMIN] Error al eliminar tabla ' + table); deleteErrors.push(table); }
  }

  if (deleteErrors.length > 0) return res.status(500).json({ error: 'Fallo al eliminar tablas: ' + deleteErrors.join(', ') });
  var { error } = await supabase.from('tenants').delete().eq('id', id);
  if (error) return res.status(500).json({ error: 'Error eliminando negocio' });
  res.json({ ok: true });
});

// POST /api/admin/tenants/:id/users — crear usuario para un tenant
router.post('/tenants/:id/users', auth, superadminOnly, async (req, res) => {
  var { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email y password requeridos' });
  if (!['admin','cajero','auditor'].includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  if (password.length < 6) return res.status(400).json({ error: 'Contraseña mínimo 6 caracteres' });
  var hash = await bcrypt.hash(password, 10);
  var { data, error } = await supabase
    .from('users')
    .insert({ name, email: email.toLowerCase(), password_hash: hash, role, active: true, tenant_id: req.params.id })
    .select('id,name,email,role,active,created_at').single();
  if (error) return res.status(500).json({ error: 'Error creando usuario: ' + error.message });
  res.status(201).json(data);
});

// DELETE /api/admin/users/:id — eliminar usuario definitivamente
router.delete('/users/:id', auth, superadminOnly, async (req, res) => {
  var { data: targetUser } = await supabase.from('users').select('id,role').eq('id', req.params.id).single();
  if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (targetUser.role === 'superadmin') return res.status(403).json({ error: 'No se puede eliminar al superadmin' });
  var { error } = await supabase.from('users').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error eliminando usuario' });
  res.json({ ok: true });
});

// GET /api/admin/storage-stats — estadísticas de almacenamiento (superadmin only)
router.get('/storage-stats', auth, superadminOnly, async (req, res) => {
  var TABLES = ['clients', 'products', 'sales', 'sale_items', 'audit_logs', 'repairs', 'warranties', 'accounts'];

  try {
    var results = await Promise.all(
      TABLES.map(function(table) {
        return supabase.from(table).select('*', { count: 'exact', head: true })
          .then(function(r) { return { table, count: r.count || 0, error: r.error }; });
      })
    );

    var tables = {};
    var total = 0;
    for (var r of results) {
      if (r.error) {
        logger.warn({ table: r.table, err: r.error }, '[ADMIN] storage-stats: error contando tabla');
        tables[r.table] = null;
      } else {
        tables[r.table] = r.count;
        total += r.count;
      }
    }

    // Niveles de alerta: ok < 300 000, warning < 500 000, critical >= 500 000
    var audit_count = tables['audit_logs'] || 0;
    var warning_level = 'ok';
    var message = 'Almacenamiento dentro de límites normales.';

    if (total >= 500000 || audit_count >= 100000) {
      warning_level = 'critical';
      message = 'Almacenamiento crítico: ' + total.toLocaleString() + ' registros totales (audit_logs: ' + audit_count.toLocaleString() + '). Considera limpiar logs antiguos o actualizar el plan de Supabase.';
    } else if (total >= 300000 || audit_count >= 50000) {
      warning_level = 'warning';
      message = 'Almacenamiento elevado: ' + total.toLocaleString() + ' registros totales. Monitorear de cerca.';
    }

    logger.info({ total, warning_level }, '[ADMIN] storage-stats consultado');
    res.json({ tables, total_records: total, warning_level, message });
  } catch (err) {
    logger.error({ err }, '[ADMIN] storage-stats excepción');
    res.status(500).json({ error: 'Error interno al obtener estadísticas de almacenamiento' });
  }
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
