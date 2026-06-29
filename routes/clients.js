const logger = require('../utils/logger');
const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');
const logAudit = require('../utils/audit');
const { encryptField, decryptField } = require('../utils/crypto');
const { withTenant, tid } = require('../utils/tenant');

/**
 * @openapi
 * /clients:
 *   get:
 *     tags: [Clients]
 *     summary: Ver documentación completa en /api-docs
 *     responses:
 *       200:
 *         description: OK
 */
// GET /api/clients
router.get('/', auth, async (req, res) => {
  var q = supabase.from('clients').select('*').order('created_at', { ascending: false });
  q = withTenant(q, req);
  var { data, error } = await q;
  if (error) { logger.error({ err: error }, '[CLIENTS]'); return res.status(500).json({ error: 'Error interno' }); }
  // Descifrar DPI para el cliente (campo sensible en reposo, A13).
  (data || []).forEach(function(c) { if (c && c.dpi) c.dpi = decryptField(c.dpi); });
  res.json(data || []);
});

// POST /api/clients
router.post('/', auth, async (req, res) => {
  var { id, cliCode, name, dpi, nit, phone, address, email, active, createdAt } = req.body;
  var { data, error } = await supabase
    .from('clients')
    .insert([{ id, cli_code: cliCode, name, dpi: dpi?encryptField(dpi):null, nit: nit||'CF', phone: phone||null, address: address||null, email: email||null, active: active!==false, created_at: createdAt||new Date().toISOString(), tenant_id: tid(req) }])
    .select().single();
  if (error) { logger.error({ err: error }, '[CLIENTS]'); return res.status(500).json({ error: 'Error interno' }); }
  // A13: no volcar el DPI (dato personal sensible) en texto plano a audit_logs.
  await logAudit(req.user, 'cliente_creado', 'client', data.id, { nombre: name, codigo: cliCode, nit: nit||'CF', telefono: phone||'—' });
  if (data && data.dpi) data.dpi = decryptField(data.dpi);
  res.status(201).json(data);
});

// PUT /api/clients/:id
router.put('/:id', auth, async (req, res) => {
  var { cliCode, name, dpi, nit, phone, address, email, active } = req.body;

  var { data: before } = await withTenant(supabase.from('clients').select('*').eq('id', req.params.id), req).single();

  var { data, error } = await withTenant(
    supabase.from('clients')
      .update({ cli_code: cliCode, name, dpi: dpi?encryptField(dpi):null, nit: nit||'CF', phone: phone||null, address: address||null, email: email||null, active: active!==false, updated_at: new Date() })
      .eq('id', req.params.id),
    req
  ).select().single();
  if (error) { logger.error({ err: error }, '[CLIENTS]'); return res.status(500).json({ error: 'Error interno' }); }

  // A13: 'dpi' NO va en el diff de auditoría (dato personal sensible). Se registra que cambió, sin valores.
  var CAMPOS = { name:'Nombre', nit:'NIT', phone:'Teléfono', address:'Dirección', email:'Email', active:'Activo' };
  var diff = {};
  if (before) {
    Object.keys(CAMPOS).forEach(function(k){
      var nuevo = req.body[k]; var viejo = before[k];
      if (nuevo !== undefined && String(nuevo||'') !== String(viejo||'')) {
        diff[CAMPOS[k]] = { antes: viejo||'—', despues: nuevo||'—' };
      }
    });
    if (dpi !== undefined && String(dpi||'') !== String(decryptField(before.dpi)||'')) {
      diff['DPI'] = { antes: '(oculto)', despues: '(modificado)' };
    }
  }
  diff._cliente = before ? before.name : req.params.id;
  await logAudit(req.user, 'cliente_editado', 'client', req.params.id, diff);
  if (data && data.dpi) data.dpi = decryptField(data.dpi);
  res.json(data);
});

// DELETE /api/clients/:id
router.delete('/:id', auth, async (req, res) => {
  var { data: before } = await withTenant(supabase.from('clients').select('name,cli_code').eq('id', req.params.id), req).single();
  var { error } = await withTenant(supabase.from('clients').update({ active: false, updated_at: new Date() }).eq('id', req.params.id), req);
  if (error) { logger.error({ err: error }, '[CLIENTS]'); return res.status(500).json({ error: 'Error interno' }); }
  await logAudit(req.user, 'cliente_eliminado', 'client', req.params.id, { nombre: before ? before.name : '—', codigo: before ? before.cli_code : '—' });
  res.json({ success: true });
});

module.exports = router;
