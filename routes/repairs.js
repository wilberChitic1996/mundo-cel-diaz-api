const logger = require('../utils/logger');
const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');
const logAudit = require('../utils/audit');
const { withTenant, tid } = require('../utils/tenant');

/**
 * @openapi
 * /repairs:
 *   get:
 *     tags: [Repairs]
 *     summary: Ver documentación completa en /api-docs
 *     responses:
 *       200:
 *         description: OK
 */
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
      reception_checklist: b.receptionChecklist||null,
      reception_photos: b.receptionPhotos||null,
      created_at: b.createdAt||new Date().toISOString(),
      tenant_id: tid(req),
    }])
    .select().single();
  if (error) { logger.error({ err: error }, '[REPAIRS]'); return res.status(500).json({ error: 'Error interno' }); }

  // Brecha #3: persistir repuestos en tabla relacional repair_items
  if (b.parts && b.parts.length > 0) {
    var items = b.parts.map(function(p) {
      return { tenant_id: tid(req), repair_id: data.id, product_id: p.productId||null, code: p.code, name: p.name, qty: p.qty||1, cost: p.price||0 };
    });
    var { error: riErr } = await supabase.from('repair_items').insert(items);
    if (riErr) logger.error({ err: riErr }, '[REPAIRS] repair_items insert');
  }

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
      status: b.status, parts: b.parts||[],
      reception_checklist: b.receptionChecklist !== undefined ? b.receptionChecklist : undefined,
      delivery_photos: b.deliveryPhotos !== undefined ? b.deliveryPhotos : undefined,
      updated_at: new Date()
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

  // Brecha #3: sincronizar repair_items cuando se actualizan los repuestos
  if (b.parts !== undefined) {
    await supabase.from('repair_items').delete().eq('repair_id', req.params.id).eq('tenant_id', tid(req));
    if (b.parts && b.parts.length > 0) {
      var riRows = b.parts.map(function(p) {
        return { tenant_id: tid(req), repair_id: req.params.id, product_id: p.productId||null, code: p.code, name: p.name, qty: p.qty||1, cost: p.price||0 };
      });
      var { error: riErr2 } = await supabase.from('repair_items').insert(riRows);
      if (riErr2) logger.error({ err: riErr2 }, '[REPAIRS] repair_items update');
    }
  }

  await logAudit(req.user, 'reparacion_editada', 'repair', req.params.id, diff);
  res.json(data);
});

// POST /api/repairs/:id/photos — sube foto en base64 a Supabase Storage
// Body: { base64: '...', mimeType: 'image/jpeg', photoType: 'reception'|'delivery' }
router.post('/:id/photos', auth, async (req, res) => {
  var tenantId = tid(req);
  var { base64, mimeType, photoType } = req.body;
  if (!base64) return res.status(400).json({ error: 'Se requiere la imagen en base64' });
  if (!['reception', 'delivery'].includes(photoType)) return res.status(400).json({ error: 'photoType debe ser reception o delivery' });

  // Verificar que la reparación pertenece al tenant
  var { data: rep } = await withTenant(supabase.from('repairs').select('id, reception_photos, delivery_photos').eq('id', req.params.id), req).single();
  if (!rep) return res.status(404).json({ error: 'Reparación no encontrada' });

  var ext = (mimeType === 'image/png') ? 'png' : 'jpg';
  var path = tenantId + '/' + req.params.id + '/' + photoType + '_' + Date.now() + '.' + ext;
  var buf  = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64');

  var { error: upErr } = await supabase.storage.from('repairs').upload(path, buf, {
    contentType: mimeType || 'image/jpeg',
    upsert: false,
  });
  if (upErr) { logger.error({ err: upErr }, '[REPAIRS] photo upload'); return res.status(500).json({ error: 'Error al subir la foto: ' + upErr.message }); }

  // URL pública firmada (válida 10 años — 315360000 segundos)
  var { data: signed } = await supabase.storage.from('repairs').createSignedUrl(path, 315360000);
  var url = signed ? signed.signedUrl : path;

  var field = photoType === 'reception' ? 'reception_photos' : 'delivery_photos';
  var existingPhotos = rep[field] || [];
  var updatedPhotos  = existingPhotos.concat([url]);

  var { error: updErr } = await withTenant(
    supabase.from('repairs').update({ [field]: updatedPhotos, updated_at: new Date() }).eq('id', req.params.id),
    req
  );
  if (updErr) { logger.error({ err: updErr }, '[REPAIRS] photo url update'); return res.status(500).json({ error: 'Foto subida pero error al guardar URL' }); }

  res.status(201).json({ url, path, field });
});

// DELETE /api/repairs/:id/photos — elimina una foto del arreglo
// Body: { url: '...', photoType: 'reception'|'delivery' }
router.delete('/:id/photos', auth, async (req, res) => {
  var tenantId = tid(req);
  var { url, photoType } = req.body;
  if (!url || !['reception', 'delivery'].includes(photoType)) return res.status(400).json({ error: 'url y photoType requeridos' });

  var { data: rep } = await withTenant(supabase.from('repairs').select('id, reception_photos, delivery_photos').eq('id', req.params.id), req).single();
  if (!rep) return res.status(404).json({ error: 'Reparación no encontrada' });

  var field = photoType === 'reception' ? 'reception_photos' : 'delivery_photos';
  var updated = (rep[field] || []).filter(function(u) { return u !== url; });

  await withTenant(supabase.from('repairs').update({ [field]: updated, updated_at: new Date() }).eq('id', req.params.id), req);

  // Intentar borrar del Storage (path está embebido en la URL)
  try {
    var pathMatch = url.match(/repairs\/([^?]+)/);
    if (pathMatch) await supabase.storage.from('repairs').remove([pathMatch[1]]);
  } catch (_) { /* no fatal */ }

  res.json({ ok: true, remaining: updated.length });
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
