const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');
const logAudit = require('../utils/audit');
const { withTenant } = require('../utils/tenant');

// GET /api/defectives
router.get('/', auth, async (req, res) => {
  var q = supabase.from('defectives').select('*').order('created_at', { ascending: false });
  q = withTenant(q, req);
  const { data, error } = await q;
  if (error) { console.error('[DEFECTIVES]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data);
});

// PUT /api/defectives/:id
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var { status } = req.body;

  var { data: def } = await withTenant(supabase.from('defectives').select('*').eq('id', req.params.id), req).single();

  if (status === 'reingresado' && def && def.code) {
    var { data: prod } = await withTenant(supabase.from('products').select('stock').eq('code', def.code), req).single();
    if (prod) {
      await withTenant(supabase.from('products').update({ stock: prod.stock + def.qty, updated_at: new Date() }).eq('code', def.code), req);
    }
  }

  var { data, error } = await withTenant(
    supabase.from('defectives').update({ status: status, updated_at: new Date() }).eq('id', req.params.id),
    req
  ).select().single();
  if (error) { console.error('[DEFECTIVES]', error.message); return res.status(500).json({ error: 'Error interno' }); }

  await logAudit(req.user, 'defectuoso_estado', 'defective', req.params.id, {
    _articulo: def ? (def.name||def.code||req.params.id) : req.params.id,
    Estado: { antes: def ? def.status : '—', despues: status },
    ...(status === 'reingresado' ? { cantidad_reingresada: def ? def.qty : '—' } : {})
  });
  res.json(data);
});

module.exports = router;
