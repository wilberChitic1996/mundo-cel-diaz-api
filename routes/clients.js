const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');
const logAudit = require('../utils/audit');

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
  await logAudit(req.user, 'cliente_creado', 'client', data.id, { nombre: name, codigo: cliCode, telefono: phone||'—', dpi: dpi||'—' });
  res.status(201).json(data);
});

// PUT /api/clients/:id
router.put('/:id', auth, async (req, res) => {
  var { cliCode, name, dpi, phone, address, active } = req.body;

  var { data: before } = await supabase.from('clients').select('*').eq('id', req.params.id).single();

  var { data, error } = await supabase
    .from('clients')
    .update({ cli_code: cliCode, name, dpi: dpi||null, phone: phone||null, address: address||null, active: active!==false, updated_at: new Date() })
    .eq('id', req.params.id).select().single();
  if (error) { console.error('[CLIENTS]', error.message); return res.status(500).json({ error: 'Error interno' }); }

  var CAMPOS = { name:'Nombre', dpi:'DPI', phone:'Teléfono', address:'Dirección', active:'Activo' };
  var diff = {};
  if (before) {
    Object.keys(CAMPOS).forEach(function(k){
      var nuevo = req.body[k]; var viejo = before[k];
      if (nuevo !== undefined && String(nuevo||'') !== String(viejo||'')) {
        diff[CAMPOS[k]] = { antes: viejo||'—', despues: nuevo||'—' };
      }
    });
  }
  diff._cliente = before ? before.name : req.params.id;
  await logAudit(req.user, 'cliente_editado', 'client', req.params.id, diff);
  res.json(data);
});

// DELETE /api/clients/:id
router.delete('/:id', auth, async (req, res) => {
  var { data: before } = await supabase.from('clients').select('name,cli_code').eq('id', req.params.id).single();
  var { error } = await supabase.from('clients').update({ active: false, updated_at: new Date() }).eq('id', req.params.id);
  if (error) { console.error('[CLIENTS]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  await logAudit(req.user, 'cliente_eliminado', 'client', req.params.id, { nombre: before ? before.name : '—', codigo: before ? before.cli_code : '—' });
  res.json({ success: true });
});

module.exports = router;
