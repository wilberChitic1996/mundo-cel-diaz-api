const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');

// GET /api/clients
router.get('/', auth, async (req, res) => {
  var { data, error } = await supabase
    .from('clients').select('*').order('created_at', { ascending: false });
  if (error) { console.error('[CLIENTS]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data || []);
});

// POST /api/clients
router.post('/', auth, async (req, res) => {
  var { id, cliCode, name, dpi, phone, address, active, createdAt } = req.body;
  var { data, error } = await supabase
    .from('clients')
    .insert([{ id, cli_code: cliCode, name, dpi: dpi||null, phone: phone||null, address: address||null, active: active!==false, created_at: createdAt||new Date().toISOString() }])
    .select().single();
  if (error) { console.error('[CLIENTS]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  res.status(201).json(data);
});

// PUT /api/clients/:id
router.put('/:id', auth, async (req, res) => {
  var { cliCode, name, dpi, phone, address, active } = req.body;
  var { data, error } = await supabase
    .from('clients')
    .update({ cli_code: cliCode, name, dpi: dpi||null, phone: phone||null, address: address||null, active: active!==false, updated_at: new Date() })
    .eq('id', req.params.id).select().single();
  if (error) { console.error('[CLIENTS]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data);
});

// DELETE /api/clients/:id
router.delete('/:id', auth, async (req, res) => {
  var { error } = await supabase
    .from('clients').update({ active: false, updated_at: new Date() }).eq('id', req.params.id);
  if (error) { console.error('[CLIENTS]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  res.json({ success: true });
});

module.exports = router;
