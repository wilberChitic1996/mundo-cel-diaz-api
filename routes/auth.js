const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');
const { Resend } = require('resend');
const supabase = require('../supabase');
const { loginLimiter, recoveryLimiter } = require('../middleware/rateLimit');

const resend = new Resend(process.env.RESEND_API_KEY);

// Almacén en memoria de códigos 2FA — { email: { code, expires } }
const twoFaCodes = new Map();

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

  if (error || !users || users.length === 0) {
    console.warn('[SECURITY] Login fallido — email no encontrado:', email.toLowerCase().trim(), '| IP:', req.ip, '| UA:', req.headers['user-agent']);
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  const user = users[0];
  const valid = await verifyPassword(password, user.password_hash);

  if (!valid) {
    console.warn('[SECURITY] Login fallido — contraseña incorrecta:', email.toLowerCase().trim(), '| IP:', req.ip, '| UA:', req.headers['user-agent']);
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  // Auto-migrar hash SHA-256 a bcrypt en login exitoso
  var updateFields = { last_login: new Date().toISOString() };
  if (!user.password_hash.startsWith('$2a$') && !user.password_hash.startsWith('$2b$')) {
    updateFields.password_hash = await hashPassword(password);
  }
  await supabase.from('users').update(updateFields).eq('id', user.id);

  // 2FA para superadmin — enviar código por correo
  if (user.role === 'superadmin') {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    twoFaCodes.set(user.email, { code, expires: Date.now() + 10 * 60 * 1000 });
    await resend.emails.send({
      from: 'PraxisGT <onboarding@resend.dev>',
      to: user.email,
      subject: 'Tu código de verificación — PraxisGT',
      html: `<p>Hola <b>${user.name}</b>,</p><p>Tu código de acceso es:</p><h1 style="letter-spacing:8px;font-size:40px;">${code}</h1><p>Válido por <b>10 minutos</b>. Si no fuiste tú, cambia tu contraseña inmediatamente.</p>`
    });
    console.info('[SECURITY] 2FA enviado a superadmin:', user.email, '| IP:', req.ip);
    return res.json({ requires2fa: true, email: user.email });
  }

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

  console.info('[SECURITY] Login exitoso:', user.email, '| rol:', user.role, '| IP:', req.ip);
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, tenant_id: user.tenant_id || null }
  });
});

// POST /api/auth/verify-2fa
router.post('/verify-2fa', loginLimiter, async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email y código requeridos' });

  const entry = twoFaCodes.get(email.toLowerCase().trim());
  if (!entry) return res.status(401).json({ error: 'No hay código activo para este usuario' });
  if (Date.now() > entry.expires) {
    twoFaCodes.delete(email.toLowerCase().trim());
    return res.status(401).json({ error: 'El código expiró. Iniciá sesión nuevamente.' });
  }
  if (entry.code !== String(code).trim()) {
    console.warn('[SECURITY] 2FA código incorrecto para:', email, '| IP:', req.ip);
    return res.status(401).json({ error: 'Código incorrecto' });
  }

  twoFaCodes.delete(email.toLowerCase().trim());

  const { data: users } = await supabase.from('users').select('*').eq('email', email.toLowerCase().trim()).limit(1);
  if (!users || users.length === 0) return res.status(401).json({ error: 'Usuario no encontrado' });
  const user = users[0];

  const token = jwt.sign(
    { userId: user.id, name: user.name, email: user.email, role: user.role, tenant_id: user.tenant_id || null },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  console.info('[SECURITY] 2FA verificado — login superadmin exitoso:', user.email, '| IP:', req.ip);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, tenant_id: user.tenant_id || null } });
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
