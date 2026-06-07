const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');

router.get('/', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('accounts').select('*, account_items(*), account_payments(*)')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/', auth, async (req, res) => {
  const { client, total, paid, balance, status, method, items } = req.body;
  const { data: acc, error } = await supabase
    .from('accounts')
    .insert({ client, total, paid, balance, status, method, user_id: req.user.userId })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (items && items.length) {
    await supabase.from('account_items').insert(
      items.map(i => ({ account_id: acc.id, code: i.code, name: i.name, price: i.price, qty: i.qty }))
    );
  }
  res.status(201).json(acc);
});

router.post('/:id/payments', auth, async (req, res) => {
  const { amount, method, note } = req.body;
  const { data: pmt, error } = await supabase
    .from('account_payments')
    .insert({ account_id: req.params.id, amount, method, note })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Recalcular balance
  const { data: pmts } = await supabase
    .from('account_payments').select('amount').eq('account_id', req.params.id);
  const totalPaid = pmts.reduce((s, p) => s + Number(p.amount), 0);
  const { data: acc } = await supabase
    .from('accounts').select('total').eq('id', req.params.id).single();
  const newBalance = Math.max(0, Number(acc.total) - totalPaid);
  const newStatus  = newBalance <= 0 ? 'pagado' : totalPaid > 0 ? 'parcial' : 'pendiente';

  await supabase.from('accounts')
    .update({ paid: totalPaid, balance: newBalance, status: newStatus, updated_at: new Date() })
    .eq('id', req.params.id);

  res.status(201).json(pmt);
});

module.exports = router;
