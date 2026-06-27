const logger = require('../utils/logger');
const express   = require('express');
const router    = express.Router();
const auth      = require('../middleware/auth');
const supabase  = require('../supabase');
const logAudit  = require('../utils/audit');
const { withTenant, tid } = require('../utils/tenant');

// GET /api/accounts
router.get('/', auth, async (req, res) => {
  var q = supabase.from('accounts').select('*, account_items(*), account_payments(*)').order('created_at', { ascending: false });
  q = withTenant(q, req);
  var { data, error } = await q;
  if (error) { logger.error({ err: error }, '[ACCOUNTS]'); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data);
});

// POST /api/accounts
router.post('/', auth, async (req, res) => {
  var { client, total, paid, balance, status, method, items } = req.body;
  var registradoPor = { name: req.user.name, role: req.user.role };
  var { data: acc, error } = await supabase
    .from('accounts')
    .insert({ client, total, paid:paid||0, balance:balance||total, status:status||'pendiente', method:method||'Efectivo', user_id:req.user.userId, registrado_por: registradoPor, tenant_id: tid(req) })
    .select().single();
  if (error) { logger.error({ err: error }, '[ACCOUNTS]'); return res.status(500).json({ error: 'Error interno' }); }
  if (items && items.length) {
    await supabase.from('account_items').insert(
      items.map(function(i){ return { account_id:acc.id, code:i.code, name:i.name, price:i.price, qty:i.qty, tenant_id: tid(req) }; })
    );
  }
  await logAudit(req.user, 'cuenta_creada', 'account', acc.id, { client, total });
  res.status(201).json(acc);
});

// POST /api/accounts/:id/payments
router.post('/:id/payments', auth, async (req, res) => {
  var { amount, method, note } = req.body;
  var registradoPor = { name: req.user.name, role: req.user.role };

  // Verificar que la cuenta pertenece al tenant del usuario antes de registrar el pago
  var { data: acc, error: accErr } = await withTenant(supabase.from('accounts').select('id,total').eq('id', req.params.id), req).single();
  if (accErr || !acc) return res.status(404).json({ error: 'Cuenta no encontrada' });

  var { data: pmt, error: pErr } = await supabase
    .from('account_payments')
    .insert({ account_id:req.params.id, amount, method:method||'Efectivo', note:note||'', registrado_por: registradoPor, tenant_id: tid(req) })
    .select().single();
  if (pErr) { logger.error({ err: pErr }, '[ACCOUNTS]'); return res.status(500).json({ error: 'Error interno' }); }

  var { data: pmts } = await supabase.from('account_payments').select('amount').eq('account_id', req.params.id);
  var totalPaid  = (pmts||[]).reduce(function(s,p){return s+Number(p.amount);},0);
  var newBalance = Math.max(0, Number(acc.total) - totalPaid);
  var newStatus  = newBalance <= 0 ? 'pagado' : totalPaid > 0 ? 'parcial' : 'pendiente';

  await withTenant(
    supabase.from('accounts').update({ paid:totalPaid, balance:newBalance, status:newStatus, updated_at:new Date() }).eq('id', req.params.id),
    req
  );

  await logAudit(req.user, 'abono_registrado', 'account', req.params.id, { amount, method: method||'Efectivo', note, newBalance, newStatus });
  res.status(201).json(pmt);
});

module.exports = router;
