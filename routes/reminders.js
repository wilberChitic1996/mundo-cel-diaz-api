const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const supabase = require('../supabase');
const logger = require('../utils/logger');
const { withTenant, tid } = require('../utils/tenant');

/**
 * @openapi
 * /reminders/summary:
 *   get:
 *     tags: [Reminders]
 *     summary: Resumen de alertas activas (cuentas, garantías, reparaciones)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Resumen de alertas
 */
// GET /api/reminders/summary — resumen consolidado para el dashboard
router.get('/summary', auth, async (req, res) => {
  try {
    var today = new Date();
    var todayStr = today.toISOString().split('T')[0];
    var in7 = new Date(today.getTime() + 7 * 86400000).toISOString().split('T')[0];
    var cutoff30 = new Date(today.getTime() - 30 * 86400000).toISOString();

    var [acctRes, warrRes, repairRes] = await Promise.all([
      // Cuentas con saldo pendiente (aging por antigüedad desde created_at)
      withTenant(
        supabase.from('accounts').select('id, client, balance, created_at').gt('balance', 0),
        req
      ),
      // Garantías por vencer en 7 días
      withTenant(
        supabase.from('warranties').select('id, client, description, end_date').eq('status', 'vigente').lte('end_date', in7).gte('end_date', todayStr),
        req
      ),
      // Reparaciones sin movimiento >30 días
      withTenant(
        supabase.from('repairs').select('id, client_name, brand, model, status, updated_at').in('status', ['recibido', 'en_revision']).lt('updated_at', cutoff30),
        req
      ),
    ]);

    if (acctRes.error) logger.error({ err: acctRes.error }, '[REMINDERS] accounts query');
    if (warrRes.error) logger.error({ err: warrRes.error }, '[REMINDERS] warranties query');
    if (repairRes.error) logger.error({ err: repairRes.error }, '[REMINDERS] repairs query');

    var accounts = (acctRes.data || []).map(function(a) {
      return {
        ...a,
        days_overdue: Math.floor((today.getTime() - new Date(a.created_at).getTime()) / 86400000)
      };
    });

    var warranties = (warrRes.data || []).map(function(w) {
      return {
        ...w,
        days_left: Math.ceil((new Date(w.end_date).getTime() - today.getTime()) / 86400000)
      };
    });

    res.json({
      accounts_overdue: accounts,
      warranties_expiring: warranties,
      repairs_stalled: repairRes.data || [],
      counts: {
        accounts_overdue: accounts.length,
        warranties_expiring: warranties.length,
        repairs_stalled: (repairRes.data || []).length,
      }
    });
  } catch (err) {
    logger.error({ err }, '[REMINDERS] summary exception');
    res.status(500).json({ error: 'Error interno' });
  }
});

/**
 * @openapi
 * /reminders/accounts:
 *   get:
 *     tags: [Reminders]
 *     summary: Cuentas vencidas con aging 0/30/60/90 días
 *     security: [{ bearerAuth: [] }]
 */
// GET /api/reminders/accounts — cuentas vencidas con aging
router.get('/accounts', auth, async (req, res) => {
  try {
    var today = new Date();

    var q = supabase
      .from('accounts')
      .select('id, client, balance, created_at')
      .gt('balance', 0)
      .order('created_at', { ascending: true });
    q = withTenant(q, req);
    var { data, error } = await q;
    if (error) { logger.error({ err: error }, '[REMINDERS] accounts'); return res.status(500).json({ error: 'Error interno' }); }

    var buckets = { current: [], days30: [], days60: [], days90plus: [] };
    for (var row of (data || [])) {
      var days = Math.floor((today.getTime() - new Date(row.created_at).getTime()) / 86400000);
      var item = { ...row, days_overdue: days };
      if (days <= 30) buckets.days30.push(item);
      else if (days <= 60) buckets.days60.push(item);
      else buckets.days90plus.push(item);
    }
    res.json({ buckets, total: data ? data.length : 0 });
  } catch (err) {
    logger.error({ err }, '[REMINDERS] accounts exception');
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
