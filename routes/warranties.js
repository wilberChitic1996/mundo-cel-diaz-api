const logger = require('../utils/logger');
const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');
const logAudit = require('../utils/audit');
const { withTenant, tid } = require('../utils/tenant');
const requireRole = require('../middleware/requireRole');

/**
 * @openapi
 * /warranties:
 *   get:
 *     tags: [Warranties]
 *     summary: Ver documentación completa en /api-docs
 *     responses:
 *       200:
 *         description: OK
 */
// GET /api/warranties
router.get('/', auth, async (req, res) => {
  var q = supabase.from('warranties').select('*').order('end_date', { ascending: true });
  q = withTenant(q, req);
  var { data, error } = await q;
  if (error) { logger.error({ err: error }, '[WARRANTIES]'); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data || []);
});

// POST /api/warranties
router.post('/', auth, requireRole('admin', 'cajero'), async (req, res) => {
  var { entityType, entityId, client, description, startDate, endDate, months } = req.body;
  var start = startDate || new Date().toISOString().split('T')[0];
  var end = endDate;
  if (!end && months) {
    var d = new Date(start);
    d.setMonth(d.getMonth() + Number(months));
    end = d.toISOString().split('T')[0];
  }
  var { data, error } = await supabase
    .from('warranties')
    .insert({ entity_type: entityType, entity_id: String(entityId), client, description, start_date: start, end_date: end, status: 'vigente', created_by: req.user.userId, tenant_id: tid(req) })
    .select().single();
  if (error) { logger.error({ err: error }, '[WARRANTIES]'); return res.status(500).json({ error: 'Error interno' }); }
  await logAudit(req.user, 'garantia_creada', 'warranty', data.id, { cliente: client, descripcion: description, vence: end });
  res.status(201).json(data);
});

// PUT /api/warranties/:id
router.put('/:id', auth, requireRole('admin', 'cajero'), async (req, res) => {
  var { status, description, endDate } = req.body;
  var updates = { updated_at: new Date() };
  if (status)      updates.status      = status;
  if (description) updates.description = description;
  if (endDate)     updates.end_date    = endDate;
  var { data: before } = await withTenant(supabase.from('warranties').select('*').eq('id', req.params.id), req).single();
  var { data, error } = await withTenant(supabase.from('warranties').update(updates).eq('id', req.params.id), req).select().single();
  if (error) { logger.error({ err: error }, '[WARRANTIES]'); return res.status(500).json({ error: 'Error interno' }); }
  var diff = { _garantia: before ? before.client + ' — ' + before.description : req.params.id };
  if (status && before && status !== before.status) diff['Estado'] = { antes: before.status, despues: status };
  if (endDate && before && endDate !== before.end_date) diff['Vencimiento'] = { antes: before.end_date, despues: endDate };
  await logAudit(req.user, 'garantia_actualizada', 'warranty', req.params.id, diff);
  res.json(data);
});

module.exports = router;
