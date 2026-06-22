const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');

// GET /api/repairs
router.get('/', auth, async (req, res) => {
  var { data, error } = await supabase
    .from('repairs').select('*').order('created_at', { ascending: false });
  if (error) { console.error('[REPAIRS]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data || []);
});

// POST /api/repairs
router.post('/', auth, async (req, res) => {
  var b = req.body;
  var { data, error } = await supabase
    .from('repairs')
    .insert([{
      id: b.id, rep_code: b.repCode, client_id: b.clientId||null,
      client_name: b.clientName, client_phone: b.clientPhone||null,
      client_cli: b.clientCli||null, brand: b.brand, model: b.model,
      imei: b.imei||null, problem_desc: b.problemDesc,
      diagnosis: b.diagnosis||null, tech_name: b.techName||null,
      estimated_cost: b.estimatedCost||0, promised_date: b.promisedDate||null,
      internal_note: b.internalNote||null, status: b.status||'recibido',
      registrado_por: b.registradoPor||{}, parts: b.parts||[],
      created_at: b.createdAt||new Date().toISOString()
    }])
    .select().single();
  if (error) { console.error('[REPAIRS]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  res.status(201).json(data);
});

// PUT /api/repairs/:id/status
router.put('/:id/status', auth, async (req, res) => {
  var { status } = req.body;
  var { data, error } = await supabase
    .from('repairs')
    .update({ status, updated_at: new Date() })
    .eq('id', req.params.id).select().single();
  if (error) { console.error('[REPAIRS]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data);
});

// PUT /api/repairs/:id
router.put('/:id', auth, async (req, res) => {
  var b = req.body;
  var { data, error } = await supabase
    .from('repairs')
    .update({
      client_id: b.clientId||null, client_name: b.clientName,
      client_phone: b.clientPhone||null, client_cli: b.clientCli||null,
      brand: b.brand, model: b.model, imei: b.imei||null,
      problem_desc: b.problemDesc, diagnosis: b.diagnosis||null,
      tech_name: b.techName||null, estimated_cost: b.estimatedCost||0,
      promised_date: b.promisedDate||null, internal_note: b.internalNote||null,
      status: b.status, parts: b.parts||[], updated_at: new Date()
    })
    .eq('id', req.params.id).select().single();
  if (error) { console.error('[REPAIRS]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data);
});

// DELETE /api/repairs/:id
router.delete('/:id', auth, async (req, res) => {
  var { error } = await supabase.from('repairs').delete().eq('id', req.params.id);
  if (error) { console.error('[REPAIRS]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  res.json({ success: true });
});

module.exports = router;
