const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const crypto   = require('crypto');
const supabase = require('../supabase');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'mnpos_salt_2026').digest('hex');
}

// Hashea la respuesta de seguridad con la MISMA normalización que el frontend
// (trim + lowercase + salt) para que los hashes coincidan en login/recuperación.
function hashAnswer(answer) {
  return hashPassword(String(answer).trim().toLowerCase());
}

// GET /api/users  -> lista de usuarios (incluye sec_question para mostrar estado)
router.get('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const { data, error } = await supabase
    .from('users')
    .select('id,name,email,role,active,last_login,created_at,sec_question')
    .order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/users  -> crear usuario
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const { name, email, password, role, secQuestion, secAnswer } = req.body;

  const row = {
    name,
    email: email.toLowerCase(),
    password_hash: hashPassword(password),
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
  if (error) return res.status(500).json({ error: error.message });
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
  if (b.password) updates.password_hash = hashPassword(b.password);

  // pregunta de seguridad (texto)
  if (b.secQuestion !== undefined) updates.sec_question = b.secQuestion || null;

  // respuesta de seguridad: llega en texto plano y se hashea (si viene vacía, no se cambia)
  if (b.secAnswer) updates.sec_answer_hash = hashAnswer(b.secAnswer);

  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', req.params.id)
    .select('id,name,email,role,active,sec_question').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
