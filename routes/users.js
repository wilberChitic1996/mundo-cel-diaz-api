const express   = require('express');
const router    = express.Router();
const auth      = require('../middleware/auth');
const crypto    = require('crypto');
const bcrypt    = require('bcryptjs');
const supabase  = require('../supabase');
const logAudit  = require('../utils/audit');

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

function hashAnswer(answer) {
  return crypto.createHash('sha256').update(String(answer).trim().toLowerCase() + 'mnpos_salt_2026').digest('hex');
}

// GET /api/users  -> lista de usuarios (incluye sec_question para mostrar estado)
router.get('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const { data, error } = await supabase
    .from('users')
    .select('id,name,email,role,active,last_login,created_at,sec_question')
    .order('name');
  if (error) { console.error('[USERS]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data);
});

// POST /api/users  -> crear usuario
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const { name, email, password, role, secQuestion, secAnswer } = req.body;

  const row = {
    name,
    email: email.toLowerCase(),
    password_hash: await hashPassword(password),
    role,
    active: true
  };
  // Campos de seguridad (opcionales). La respuesta llega en texto plano y se hashea acá.
  if (secQuestion !== undefined) row.sec_question = secQuestion || null;
  if (secAnswer) row.sec_answer_hash = hashAnswer(secAnswer);

  const { data, error } = await supabase
    .from('users')
    .insert(row)
    .select('id,name,email,role,active,sec_question').single();
  if (error) { console.error('[USERS]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  await logAudit(req.user, 'usuario_creado', 'user', data.id, { name: data.name, email: data.email, role: data.role });
  res.status(201).json(data);
});

// PUT /api/users/:id  -> actualizar usuario
// Whitelist explícita (más robusta que ...req.body) + mapeo camelCase -> snake_case.
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const b = req.body || {};
  const updates = { updated_at: new Date() };

  if (b.name   !== undefined) updates.name   = b.name;
  if (b.email  !== undefined) updates.email  = b.email.toLowerCase();
  if (b.role   !== undefined) updates.role   = b.role;
  if (b.active !== undefined) updates.active = b.active;

  // password en texto plano -> hash (si viene vacío, no se cambia)
  if (b.password) updates.password_hash = await hashPassword(b.password);

  // pregunta de seguridad (texto)
  if (b.secQuestion !== undefined) updates.sec_question = b.secQuestion || null;

  // respuesta de seguridad: llega en texto plano y se hashea (si viene vacía, no se cambia)
  if (b.secAnswer) updates.sec_answer_hash = hashAnswer(b.secAnswer);

  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', req.params.id)
    .select('id,name,email,role,active,sec_question').single();
  if (error) { console.error('[USERS]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  await logAudit(req.user, 'usuario_editado', 'user', req.params.id, { name: b.name, email: b.email, role: b.role, active: b.active });
  res.json(data);
});

module.exports = router;
