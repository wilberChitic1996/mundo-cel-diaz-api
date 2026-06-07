const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');

// GET /api/accounts
router.get('/', auth, async (req, res) => {
  var { data, error } = await supabase
    .from('accounts')
    .select('*, account_items(*), account_payments(*)')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/accounts
router.post('/', auth, async (req, res) => {
  var { client, total, paid, balance, status, method, items } = req.body;
  var { data: acc, error } = await supabase
    .from('accounts')
    .insert({ client, total, paid:paid||0, balance:balance||total, status:status||'pendiente', method:method||'Efectivo', user_id:req.user.userId })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (items && items.length) {
    await supabase.from('account_items').insert(
      items.map(function(i){ return { account_id:acc.id, code:i.code, name:i.name, price:i.price, qty:i.qty }; })
    );
  }
  res.status(201).json(acc);
});

// POST /api/accounts/:id/payments
router.post('/:id/payments', auth, async (req, res) => {
  var { amount, method, note } = req.body;

  var { data: pmt, error: pErr } = await supabase
    .from('account_payments')
    .insert({ account_id:req.params.id, amount, method:method||'Efectivo', note:note||'' })
    .select().single();
  if (pErr) return res.status(500).json({ error: pErr.message });

  // Recalcular totales
  var { data: pmts } = await supabase.from('account_payments').select('amount').eq('account_id', req.params.id);
  var totalPaid  = (pmts||[]).reduce(function(s,p){return s+Number(p.amount);},0);
  var { data: acc } = await supabase.from('accounts').select('total').eq('id', req.params.id).single();
  var newBalance = Math.max(0, Number(acc.total) - totalPaid);
  var newStatus  = newBalance <= 0 ? 'pagado' : totalPaid > 0 ? 'parcial' : 'pendiente';

  await supabase.from('accounts')
    .update({ paid:totalPaid, balance:newBalance, status:newStatus, updated_at:new Date() })
    .eq('id', req.params.id);

  res.status(201).json(pmt);
});

module.exports = router;
