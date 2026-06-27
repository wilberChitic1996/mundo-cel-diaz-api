const logger = require('../utils/logger');
const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');
const { withTenant } = require('../utils/tenant');

/**
 * @openapi
 * /audit:
 *   get:
 *     tags: [Audit]
 *     summary: Ver documentación completa en /api-docs
 *     responses:
 *       200:
 *         description: OK
 */
// GET /api/audit — admin y superadmin
router.get('/', auth, async (req, res) => {
  if (!['admin','superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Acceso denegado' });

  var page    = Math.max(1, parseInt(req.query.page)  || 1);
  var limit   = Math.min(100, parseInt(req.query.limit) || 50);
  var offset  = (page - 1) * limit;
  var entity    = req.query.entity    || null;
  var action    = req.query.action    || null;
  var user      = req.query.user      || null;
  var date_from = req.query.date_from || null;
  var date_to   = req.query.date_to   || null;

  var q = supabase.from('audit_logs').select('*', { count: 'exact' });
  q = withTenant(q, req);
  if (entity)    q = q.eq('entity_type', entity);
  if (action)    q = q.eq('action', action);
  if (user)      q = q.ilike('user_name', '%' + user + '%');
  if (date_from) q = q.gte('created_at', date_from);
  if (date_to)   q = q.lte('created_at', date_to + 'T23:59:59.999Z');
  q = q.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  var { data, error, count } = await q;
  if (error) { logger.error({ err: error }, '[AUDIT]'); return res.status(500).json({ error: 'Error interno' }); }
  res.json({ data, total: count, page, limit });
});

module.exports = router;
