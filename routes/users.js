const logger = require('../utils/logger');
const express   = require('express');
const router    = express.Router();
const auth      = require('../middleware/auth');
const crypto    = require('crypto');
const bcrypt    = require('bcryptjs');
const supabase  = require('../supabase');
const logAudit  = require('../utils/audit');
const { withTenant, tid } = require('../utils/tenant');

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

function hashAnswer(answer) {
  return crypto.createHash('sha256').update(String(answer).trim().toLowerCase() + 'mnpos_salt_2026').digest('hex');
}

/**
 * @openapi
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: Ver documentación completa en /api-docs
 *     responses:
 *       200:
 *         description: OK
 */
// GET /api/users
router.get('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var q = supabase.from('users').select('id,name,email,role,active,last_login,created_at,sec_question').order('name');
  q = withTenant(q, req);
  const { data, error } = await q;
  if (error) { logger.error({ err: error }, '[USERS]'); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data);
});

// POST /api/users
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const { name, email, password, role, secQuestion, secAnswer } = req.body;

  const row = {
    name,
    email: email.toLowerCase(),
    password_hash: await hashPassword(password),
    role,
    active: true,
    tenant_id: tid(req),
  };
  if (secQuestion !== undefined) row.sec_question = secQuestion || null;
  if (secAnswer) row.sec_answer_hash = hashAnswer(secAnswer);

  const { data, error } = await supabase
    .from('users')
    .insert(row)
    .select('id,name,email,role,active,sec_question').single();
  if (error) { logger.error({ err: error }, '[USERS]'); return res.status(500).json({ error: 'Error interno' }); }
  await logAudit(req.user, 'usuario_creado', 'user', data.id, { name: data.name, email: data.email, role: data.role });
  res.status(201).json(data);
});

// PUT /api/users/:id
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const b = req.body || {};
  const updates = { updated_at: new Date() };

  if (b.name   !== undefined) updates.name   = b.name;
  if (b.email  !== undefined) updates.email  = b.email.toLowerCase();
  if (b.role   !== undefined) updates.role   = b.role;
  if (b.active !== undefined) updates.active = b.active;
  if (b.password) updates.password_hash = await hashPassword(b.password);
  if (b.secQuestion !== undefined) updates.sec_question = b.secQuestion || null;
  if (b.secAnswer) updates.sec_answer_hash = hashAnswer(b.secAnswer);

  var { data: before } = await withTenant(supabase.from('users').select('id,name,email,role,active').eq('id', req.params.id), req).single();

  const { data, error } = await withTenant(
    supabase.from('users').update(updates).eq('id', req.params.id),
    req
  ).select('id,name,email,role,active,sec_question').single();
  if (error) { logger.error({ err: error }, '[USERS]'); return res.status(500).json({ error: 'Error interno' }); }

  var CAMPOS_U = { name:'Nombre', email:'Email', role:'Rol', active:'Activo' };
  var diff = {};
  if (before) {
    Object.keys(CAMPOS_U).forEach(function(k){
      if (b[k] !== undefined && String(b[k]) !== String(before[k])) {
        diff[CAMPOS_U[k]] = { antes: before[k], despues: b[k] };
      }
    });
  }
  if (b.password) diff['Contraseña'] = { antes: '••••••', despues: '(cambiada)' };
  if (b.secQuestion !== undefined) diff['Pregunta seguridad'] = { antes: before ? (before.sec_question||'—') : '—', despues: b.secQuestion||'—' };
  diff._usuario = before ? before.name : req.params.id;

  await logAudit(req.user, 'usuario_editado', 'user', req.params.id, diff);
  res.json(data);
});

module.exports = router;
