const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');

// GET /api/audit — solo admin
router.get('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acceso denegado' });

  var page    = Math.max(1, parseInt(req.query.page)  || 1);
  var limit   = Math.min(100, parseInt(req.query.limit) || 50);
  var offset  = (page - 1) * limit;
  var entity  = req.query.entity  || null;
  var action  = req.query.action  || null;
  var user    = req.query.user    || null;

  var q = supabase.from('audit_logs').select('*', { count: 'exact' });
  if (entity) q = q.eq('entity_type', entity);
  if (action) q = q.eq('action', action);
  if (user)   q = q.ilike('user_name', '%' + user + '%');
  q = q.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  var { data, error, count } = await q;
  if (error) { console.error('[AUDIT]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  res.json({ data, total: count, page, limit });
});

module.exports = router;
