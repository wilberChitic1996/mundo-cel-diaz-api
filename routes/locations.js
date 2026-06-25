const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');
const logAudit = require('../utils/audit');
const { withTenant, tid } = require('../utils/tenant');

// ── UBICACIONES / ESTANTERÍAS ─────────────────────────
// El "mueble/estante" (vitrina, rack, bodega) es la unidad administrable.
// La posición exacta dentro del mueble se guarda por producto (position).

// GET /api/locations
router.get('/', auth, async (req, res) => {
  var q = supabase.from('locations').select('*').eq('active', true)
    .order('sort_order').order('name');
  q = withTenant(q, req);
  var { data, error } = await q;
  if (error) { console.error('[LOCATIONS]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data || []);
});

// POST /api/locations
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var { name, zone, description, sort_order } = req.body;
  name = (name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });

  var dupQ = supabase.from('locations').select('id').ilike('name', name);
  var { data: dup } = await withTenant(dupQ, req);
  if (dup && dup.length) return res.status(409).json({ error: 'Ya existe una ubicación con ese nombre' });

  var { data, error } = await supabase.from('locations')
    .insert({ name, zone: zone || null, description: description || null, sort_order: sort_order || 0, tenant_id: tid(req) })
    .select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una ubicación con ese nombre' });
    console.error('[LOCATIONS]', error.message); return res.status(500).json({ error: 'Error interno' });
  }
  await logAudit(req.user, 'ubicacion_creada', 'location', data.id, { nombre: name });
  res.status(201).json(data);
});

// PUT /api/locations/:id
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var { name, zone, description, sort_order, active } = req.body;
  var updates = { updated_at: new Date() };
  if (name !== undefined) {
    name = (name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });
    var dupQ = supabase.from('locations').select('id').ilike('name', name).neq('id', req.params.id);
    var { data: dup } = await withTenant(dupQ, req);
    if (dup && dup.length) return res.status(409).json({ error: 'Ya existe una ubicación con ese nombre' });
    updates.name = name;
  }
  if (zone        !== undefined) updates.zone        = zone || null;
  if (description !== undefined) updates.description = description || null;
  if (sort_order  !== undefined) updates.sort_order  = sort_order || 0;
  if (active      !== undefined) updates.active      = active;

  var { data, error } = await withTenant(supabase.from('locations').update(updates).eq('id', req.params.id), req).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una ubicación con ese nombre' });
    console.error('[LOCATIONS]', error.message); return res.status(500).json({ error: 'Error interno' });
  }
  await logAudit(req.user, 'ubicacion_editada', 'location', req.params.id, updates);
  res.json(data);
});

// DELETE /api/locations/:id (soft delete; no se borra si tiene productos)
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var usedQ = supabase.from('products').select('id', { count: 'exact', head: true }).eq('location_id', req.params.id).eq('active', true);
  var { count } = await withTenant(usedQ, req);
  if (count && count > 0) return res.status(409).json({ error: 'No se puede eliminar: hay ' + count + ' producto(s) en esta ubicación' });

  var { data: before } = await withTenant(supabase.from('locations').select('name').eq('id', req.params.id), req).single();
  var { error } = await withTenant(supabase.from('locations').update({ active: false, updated_at: new Date() }).eq('id', req.params.id), req);
  if (error) { console.error('[LOCATIONS]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  await logAudit(req.user, 'ubicacion_eliminada', 'location', req.params.id, { nombre: before ? before.name : '—' });
  res.json({ success: true });
});

// ── MOVER UN PRODUCTO DE UBICACIÓN ────────────────────
// PUT /api/locations/move-product/:productId
// body: { location_id, position }
// Reasigna estante/posición y deja registro en auditoría (de dónde a dónde).
router.put('/move-product/:productId', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var { location_id, position } = req.body;

  // Estado anterior del producto + nombre de ubicación vieja
  var { data: prod } = await withTenant(
    supabase.from('products').select('name, location_id, position').eq('id', req.params.productId), req
  ).single();
  if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });

  var locName = function(id) {
    if (!id) return Promise.resolve('—');
    return withTenant(supabase.from('locations').select('name').eq('id', id), req).single()
      .then(function(r) { return r.data ? r.data.name : '—'; });
  };
  var fromName = await locName(prod.location_id);
  var toName   = await locName(location_id || null);

  var { data, error } = await withTenant(
    supabase.from('products').update({ location_id: location_id || null, position: position || null, updated_at: new Date() }).eq('id', req.params.productId),
    req
  ).select().single();
  if (error) { console.error('[LOCATIONS:move]', error.message); return res.status(500).json({ error: 'Error interno' }); }

  await logAudit(req.user, 'producto_movido', 'product', req.params.productId, {
    _producto: prod.name,
    Ubicación: { antes: fromName + (prod.position ? ' · ' + prod.position : ''), despues: toName + (position ? ' · ' + position : '') },
  });
  res.json(data);
});

module.exports = router;
