const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const supabase = require('../supabase');
const { loginLimiter, recoveryLimiter } = require('../middleware/rateLimit');

// Hash SHA-256 con salt (igual que el frontend)
function hashPassword(password) {
  return crypto
    .createHash('sha256')
    .update(password + 'mnpos_salt_2026')
    .digest('hex');
}

// Hashea la respuesta de seguridad con la MISMA normalización que el frontend
function hashAnswer(answer) {
  return hashPassword(String(answer).trim().toLowerCase());
}

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email y contraseña requeridos' });

  const { data: users, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .eq('active', true)
    .limit(1);

  if (error || !users || users.length === 0)
    return res.status(401).json({ error: 'Credenciales incorrectas' });

  const user = users[0];
  const hash = hashPassword(password);

  if (hash !== user.password_hash)
    return res.status(401).json({ error: 'Credenciales incorrectas' });

  // Actualizar lastLogin
  await supabase
    .from('users')
    .update({ last_login: new Date().toISOString() })
    .eq('id', user.id);

  const token = jwt.sign(
    { userId: user.id, name: user.name, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth'), (req, res) => {
  res.json({ user: req.user });
});

/* ══════════════════════════════════════════════════════════════════
   RECUPERACIÓN DE CONTRASEÑA — endpoints públicos (NO requieren JWT)
   Flujo: find-user (trae la pregunta) -> verify-answer (valida) ->
          reset-password (re-valida y cambia la contraseña).
   ══════════════════════════════════════════════════════════════════ */

// POST /api/auth/find-user  -> devuelve la pregunta de seguridad del usuario
router.post('/find-user', recoveryLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });

  const { data: users, error } = await supabase
    .from('users')
    .select('name,sec_question,active')
    .eq('email', email.toLowerCase().trim())
    .limit(1);

  if (error) return res.status(500).json({ error: error.message });
  if (!users || users.length === 0 || !users[0].active)
    return res.status(404).json({ error: 'No se encontró una cuenta activa con ese email' });

  if (!users[0].sec_question)
    return res.status(400).json({ error: 'Esta cuenta no tiene pregunta de seguridad configurada. Contactá al administrador del sistema.' });

  res.json({ name: users[0].name, secQuestion: users[0].sec_question });
});

// POST /api/auth/verify-answer  -> valida la respuesta (sin cambiar nada)
router.post('/verify-answer', recoveryLimiter, async (req, res) => {
  const { email, answer } = req.body;
  if (!email || !answer) return res.status(400).json({ error: 'Email y respuesta requeridos' });

  const { data: users, error } = await supabase
    .from('users')
    .select('sec_answer_hash,active')
    .eq('email', email.toLowerCase().trim())
    .limit(1);

  if (error) return res.status(500).json({ error: error.message });
  if (!users || users.length === 0 || !users[0].active)
    return res.status(404).json({ error: 'Cuenta no encontrada' });
  if (!users[0].sec_answer_hash)
    return res.status(400).json({ error: 'Cuenta sin respuesta de seguridad configurada' });

  if (hashAnswer(answer) !== users[0].sec_answer_hash)
    return res.status(401).json({ error: 'Respuesta incorrecta' });

  res.json({ ok: true });
});

// POST /api/auth/reset-password  -> re-valida la respuesta y cambia la contraseña
router.post('/reset-password', recoveryLimiter, async (req, res) => {
  const { email, answer, newPassword } = req.body;
  if (!email || !answer || !newPassword)
    return res.status(400).json({ error: 'Datos incompletos' });
  if (String(newPassword).length < 8)
    return res.status(400).json({ error: 'La contraseña debe tener mínimo 8 caracteres' });

  const { data: users, error } = await supabase
    .from('users')
    .select('id,sec_answer_hash,active')
    .eq('email', email.toLowerCase().trim())
    .limit(1);

  if (error) return res.status(500).json({ error: error.message });
  if (!users || users.length === 0 || !users[0].active)
    return res.status(404).json({ error: 'Cuenta no encontrada' });

  const user = users[0];
  if (!user.sec_answer_hash || hashAnswer(answer) !== user.sec_answer_hash)
    return res.status(401).json({ error: 'Respuesta de seguridad incorrecta' });

  const { error: updErr } = await supabase
    .from('users')
    .update({ password_hash: hashPassword(newPassword), updated_at: new Date() })
    .eq('id', user.id);

  if (updErr) return res.status(500).json({ error: updErr.message });

  res.json({ ok: true });
});

module.exports = router;
