const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');
const logAudit = require('../utils/audit');
const { withTenant, tid } = require('../utils/tenant');

// ── CATEGORÍAS ────────────────────────────────────────
// Catálogo cerrado por negocio (tenant). El admin las crea/edita; el
// formulario de producto las elige de esta lista (no texto libre).

// GET /api/categories
router.get('/', auth, async (req, res) => {
  var q = supabase.from('categories').select('*').eq('active', true)
    .order('sort_order').order('name');
  q = withTenant(q, req);
  var { data, error } = await q;
  if (error) { console.error('[CATEGORIES]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data || []);
});

// POST /api/categories
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var { name, icon, color, sort_order } = req.body;
  name = (name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });

  // Validar duplicado (case-insensitive) dentro del mismo negocio
  var dupQ = supabase.from('categories').select('id,name').ilike('name', name);
  var { data: dup } = await withTenant(dupQ, req);
  if (dup && dup.length) return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });

  var { data, error } = await supabase.from('categories')
    .insert({ name, icon: icon || null, color: color || null, sort_order: sort_order || 0, tenant_id: tid(req) })
    .select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    console.error('[CATEGORIES]', error.message); return res.status(500).json({ error: 'Error interno' });
  }
  await logAudit(req.user, 'categoria_creada', 'category', data.id, { nombre: name });
  res.status(201).json(data);
});

// PUT /api/categories/:id
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var { name, icon, color, sort_order, active } = req.body;
  var updates = { updated_at: new Date() };
  if (name !== undefined) {
    name = (name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });
    // Duplicado contra OTRAS categorías
    var dupQ = supabase.from('categories').select('id').ilike('name', name).neq('id', req.params.id);
    var { data: dup } = await withTenant(dupQ, req);
    if (dup && dup.length) return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    updates.name = name;
  }
  if (icon       !== undefined) updates.icon       = icon || null;
  if (color      !== undefined) updates.color      = color || null;
  if (sort_order !== undefined) updates.sort_order = sort_order || 0;
  if (active     !== undefined) updates.active     = active;

  var { data, error } = await withTenant(supabase.from('categories').update(updates).eq('id', req.params.id), req).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    console.error('[CATEGORIES]', error.message); return res.status(500).json({ error: 'Error interno' });
  }
  await logAudit(req.user, 'categoria_editada', 'category', req.params.id, updates);
  res.json(data);
});

// DELETE /api/categories/:id (soft delete; no se borra si tiene productos)
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var usedQ = supabase.from('products').select('id', { count: 'exact', head: true }).eq('category_id', req.params.id).eq('active', true);
  var { count } = await withTenant(usedQ, req);
  if (count && count > 0) return res.status(409).json({ error: 'No se puede eliminar: hay ' + count + ' producto(s) en esta categoría' });

  var { data: before } = await withTenant(supabase.from('categories').select('name').eq('id', req.params.id), req).single();
  var { error } = await withTenant(supabase.from('categories').update({ active: false, updated_at: new Date() }).eq('id', req.params.id), req);
  if (error) { console.error('[CATEGORIES]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  await logAudit(req.user, 'categoria_eliminada', 'category', req.params.id, { nombre: before ? before.name : '—' });
  res.json({ success: true });
});

module.exports = router;
