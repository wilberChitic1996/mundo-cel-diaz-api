const logger = require('../utils/logger');
const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');
const logAudit = require('../utils/audit');
const { withTenant, tid } = require('../utils/tenant');

// GET /api/repairs
router.get('/', auth, async (req, res) => {
  var q = supabase.from('repairs').select('*').order('created_at', { ascending: false });
  q = withTenant(q, req);
  var { data, error } = await q;
  if (error) { logger.error({ err: error }, '[REPAIRS]'); return res.status(500).json({ error: 'Error interno' }); }
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
      created_at: b.createdAt||new Date().toISOString(),
      tenant_id: tid(req),
    }])
    .select().single();
  if (error) { logger.error({ err: error }, '[REPAIRS]'); return res.status(500).json({ error: 'Error interno' }); }
  await logAudit(req.user, 'reparacion_creada', 'repair', data.id, {
    codigo: b.repCode, cliente: b.clientName, equipo: (b.brand||'')+(b.model?' '+b.model:''),
    problema: b.problemDesc, tecnico: b.techName||'—', costo_estimado: b.estimatedCost||0
  });
  res.status(201).json(data);
});

// PUT /api/repairs/:id/status
router.put('/:id/status', auth, async (req, res) => {
  var { status } = req.body;
  var { data: before } = await withTenant(supabase.from('repairs').select('status,rep_code,client_name,brand,model').eq('id', req.params.id), req).single();
  var { data, error } = await withTenant(
    supabase.from('repairs').update({ status, updated_at: new Date() }).eq('id', req.params.id),
    req
  ).select().single();
  if (error) { logger.error({ err: error }, '[REPAIRS]'); return res.status(500).json({ error: 'Error interno' }); }
  await logAudit(req.user, 'reparacion_estado', 'repair', req.params.id, {
    _reparacion: before ? ((before.rep_code||'')+' — '+(before.client_name||'')+' '+(before.brand||'')+' '+(before.model||'')) : req.params.id,
    Estado: { antes: before ? before.status : '—', despues: status }
  });
  res.json(data);
});

// PUT /api/repairs/:id
router.put('/:id', auth, async (req, res) => {
  var b = req.body;
  var { data: before } = await withTenant(supabase.from('repairs').select('*').eq('id', req.params.id), req).single();
  var { data, error } = await withTenant(
    supabase.from('repairs').update({
      client_id: b.clientId||null, client_name: b.clientName,
      client_phone: b.clientPhone||null, client_cli: b.clientCli||null,
      brand: b.brand, model: b.model, imei: b.imei||null,
      problem_desc: b.problemDesc, diagnosis: b.diagnosis||null,
      tech_name: b.techName||null, estimated_cost: b.estimatedCost||0,
      promised_date: b.promisedDate||null, internal_note: b.internalNote||null,
      status: b.status, parts: b.parts||[], updated_at: new Date()
    }).eq('id', req.params.id),
    req
  ).select().single();
  if (error) { logger.error({ err: error }, '[REPAIRS]'); return res.status(500).json({ error: 'Error interno' }); }

  var CAMPOS = { clientName:'Cliente', brand:'Marca', model:'Modelo', imei:'IMEI', problemDesc:'Problema', diagnosis:'Diagnóstico', techName:'Técnico', estimatedCost:'Costo estimado', promisedDate:'Fecha prometida', internalNote:'Nota interna', status:'Estado' };
  var DB_CAMPOS = { clientName:'client_name', brand:'brand', model:'model', imei:'imei', problemDesc:'problem_desc', diagnosis:'diagnosis', techName:'tech_name', estimatedCost:'estimated_cost', promisedDate:'promised_date', internalNote:'internal_note', status:'status' };
  var diff = {};
  if (before) {
    Object.keys(CAMPOS).forEach(function(k){
      var nuevo = b[k]; var viejo = before[DB_CAMPOS[k]];
      if (nuevo !== undefined && String(nuevo||'') !== String(viejo||'')) {
        diff[CAMPOS[k]] = { antes: viejo||'—', despues: nuevo||'—' };
      }
    });
  }
  diff._reparacion = before ? ((before.rep_code||'')+' — '+(before.client_name||'')) : req.params.id;
  await logAudit(req.user, 'reparacion_editada', 'repair', req.params.id, diff);
  res.json(data);
});

// DELETE /api/repairs/:id
router.delete('/:id', auth, async (req, res) => {
  var { data: before } = await withTenant(supabase.from('repairs').select('rep_code,client_name,brand,model').eq('id', req.params.id), req).single();
  var { error } = await withTenant(supabase.from('repairs').delete().eq('id', req.params.id), req);
  if (error) { logger.error({ err: error }, '[REPAIRS]'); return res.status(500).json({ error: 'Error interno' }); }
  await logAudit(req.user, 'reparacion_eliminada', 'repair', req.params.id, {
    codigo: before ? before.rep_code : '—',
    cliente: before ? before.client_name : '—',
    equipo: before ? ((before.brand||'')+' '+(before.model||'')) : '—'
  });
  res.json({ success: true });
});

module.exports = router;
