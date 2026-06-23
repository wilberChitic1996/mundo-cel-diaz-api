const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');
const supabase = require('../supabase');
const { loginLimiter, recoveryLimiter } = require('../middleware/rateLimit');

function legacySha256(password) {
  return crypto.createHash('sha256').update(password + 'mnpos_salt_2026').digest('hex');
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function verifyPassword(password, storedHash) {
  if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$')) {
    return bcrypt.compare(password, storedHash);
  }
  return legacySha256(password) === storedHash;
}

function hashAnswer(answer) {
  return legacySha256(String(answer).trim().toLowerCase());
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
  const valid = await verifyPassword(password, user.password_hash);

  if (!valid)
    return res.status(401).json({ error: 'Credenciales incorrectas' });

  // Auto-migrar hash SHA-256 a bcrypt en login exitoso
  var updateFields = { last_login: new Date().toISOString() };
  if (!user.password_hash.startsWith('$2a$') && !user.password_hash.startsWith('$2b$')) {
    updateFields.password_hash = await hashPassword(password);
  }
  await supabase.from('users').update(updateFields).eq('id', user.id);

  const token = jwt.sign(
    {
      userId:    user.id,
      name:      user.name,
      email:     user.email,
      role:      user.role,
      tenant_id: user.tenant_id || null,
    },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, tenant_id: user.tenant_id || null }
  });
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth'), (req, res) => {
  res.json({ user: req.user });
});

/* ══════════════════════════════════════════════════════════════════
   RECUPERACIÓN DE CONTRASEÑA — endpoints públicos (NO requieren JWT)
   ══════════════════════════════════════════════════════════════════ */

// POST /api/auth/find-user
router.post('/find-user', recoveryLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });

  const { data: users, error } = await supabase
    .from('users')
    .select('name,sec_question,active')
    .eq('email', email.toLowerCase().trim())
    .limit(1);

  if (error) { console.error('[FIND-USER]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  if (!users || users.length === 0 || !users[0].active)
    return res.status(404).json({ error: 'No se encontró una cuenta activa con ese email' });

  if (!users[0].sec_question)
    return res.status(400).json({ error: 'Esta cuenta no tiene pregunta de seguridad configurada. Contactá al administrador del sistema.' });

  res.json({ name: users[0].name, secQuestion: users[0].sec_question });
});

// POST /api/auth/verify-answer
router.post('/verify-answer', recoveryLimiter, async (req, res) => {
  const { email, answer } = req.body;
  if (!email || !answer) return res.status(400).json({ error: 'Email y respuesta requeridos' });

  const { data: users, error } = await supabase
    .from('users')
    .select('sec_answer_hash,active')
    .eq('email', email.toLowerCase().trim())
    .limit(1);

  if (error) { console.error('[VERIFY-ANSWER]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  if (!users || users.length === 0 || !users[0].active)
    return res.status(404).json({ error: 'Cuenta no encontrada' });
  if (!users[0].sec_answer_hash)
    return res.status(400).json({ error: 'Cuenta sin respuesta de seguridad configurada' });

  if (hashAnswer(answer) !== users[0].sec_answer_hash)
    return res.status(401).json({ error: 'Respuesta incorrecta' });

  res.json({ ok: true });
});

// POST /api/auth/reset-password
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

  if (error) { console.error('[RESET-PASSWORD]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  if (!users || users.length === 0 || !users[0].active)
    return res.status(404).json({ error: 'Cuenta no encontrada' });

  const user = users[0];
  if (!user.sec_answer_hash || hashAnswer(answer) !== user.sec_answer_hash)
    return res.status(401).json({ error: 'Respuesta de seguridad incorrecta' });

  const newHash = await hashPassword(newPassword);
  const { error: updErr } = await supabase
    .from('users')
    .update({ password_hash: newHash, updated_at: new Date() })
    .eq('id', user.id);

  if (updErr) {
    console.error('[RESET-PASSWORD]', updErr.message);
    return res.status(500).json({ error: 'Error al actualizar la contraseña' });
  }

  res.json({ ok: true });
});

module.exports = router;
