const logger = require('../utils/logger');
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

var REFRESH_TOKEN_EXPIRY_DAYS = 30;

async function issueRefreshToken(userId, tenantId) {
  var raw   = crypto.randomBytes(48).toString('hex');
  var hash  = crypto.createHash('sha256').update(raw).digest('hex');
  var exp   = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  await supabase.from('refresh_tokens').insert({ user_id: userId, tenant_id: tenantId, token_hash: hash, expires_at: exp.toISOString() });
  return raw;
}

var LEGACY_SALT = process.env.LEGACY_SALT || 'mnpos_salt_2026';
function legacySha256(password) {
  return crypto.createHash('sha256').update(password + LEGACY_SALT).digest('hex');
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

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Iniciar sesión
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login exitoso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       401:
 *         description: Credenciales incorrectas
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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
    logger.warn('[SECURITY] Login fallido — email no encontrado:', email.toLowerCase().trim(), '| IP:', req.ip, '| UA:', req.headers['user-agent']);
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  const user = users[0];
  const valid = await verifyPassword(password, user.password_hash);

  if (!valid) {
    logger.warn('[SECURITY] Login fallido — contraseña incorrecta:', email.toLowerCase().trim(), '| IP:', req.ip, '| UA:', req.headers['user-agent']);
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  // Auto-migrar hash SHA-256 a bcrypt en login exitoso
  var updateFields = { last_login: new Date().toISOString() };
  if (!user.password_hash.startsWith('$2a$') && !user.password_hash.startsWith('$2b$')) {
    updateFields.password_hash = await hashPassword(password);
  }
  await supabase.from('users').update(updateFields).eq('id', user.id);

  // ══════════════════════════════════════════════════════════════════
  // 2FA SUPERADMIN — DESHABILITADO: dominio mundoceldiaz.com pendiente
  // de verificación en Resend. Sin eso los emails no salen y el login
  // del superadmin quedaría bloqueado por completo.
  //
  // PARA REACTIVAR (cuando Resend esté listo):
  //   1. Verificar mundoceldiaz.com en https://resend.com/domains
  //   2. Descomentar el bloque de abajo
  //   3. Probar en piloto: login superadmin → llega código al email
  //   4. Mergear a producción
  //
  // SUGERENCIA A FUTURO: migrar a TOTP (Google Authenticator / Authy)
  // con la librería 'otplib' — no depende de email y es más seguro.
  // ══════════════════════════════════════════════════════════════════
  // if (user.role === 'superadmin') {
  //   const code = String(Math.floor(100000 + Math.random() * 900000));
  //   twoFaCodes.set(user.email, { code, expires: Date.now() + 10 * 60 * 1000 });
  //   try {
  //     await resend.emails.send({
  //       from: 'PraxisGT <noreply@mundoceldiaz.com>',
  //       to: user.email,
  //       subject: 'Tu código de verificación — PraxisGT',
  //       html: `<p>Hola <b>${user.name}</b>,</p><p>Tu código de acceso es:</p><h1 style="letter-spacing:8px;font-size:40px;">${code}</h1><p>Válido por <b>10 minutos</b>. Si no fuiste vos, cambiá tu contraseña inmediatamente.</p>`
  //     });
  //   } catch(emailErr) {
  //     logger.error({ err: emailErr }, '[SECURITY] Error enviando 2FA a superadmin:');
  //     twoFaCodes.delete(user.email);
  //     return res.status(500).json({ error: 'Error enviando código 2FA. Intentá de nuevo.' });
  //   }
  //   console.info('[SECURITY] 2FA enviado a superadmin:', user.email, '| IP:', req.ip);
  //   return res.json({ requires2fa: true, email: user.email });
  // }

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

  var refreshToken = await issueRefreshToken(user.id, user.tenant_id);
  logger.info({ email: user.email, role: user.role, ip: req.ip }, '[SECURITY] Login exitoso');
  res.json({
    token,
    refreshToken,
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
    logger.warn('[SECURITY] 2FA código incorrecto para:', email, '| IP:', req.ip);
    return res.status(401).json({ error: 'Código incorrecto' });
  }

  twoFaCodes.delete(email.toLowerCase().trim());

  const { data: users } = await supabase.from('users').select('*').eq('email', email.toLowerCase().trim()).eq('active', true).limit(1);
  if (!users || users.length === 0) return res.status(401).json({ error: 'Usuario no encontrado' });
  const user = users[0];

  const token = jwt.sign(
    { userId: user.id, name: user.name, email: user.email, role: user.role, tenant_id: user.tenant_id || null },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  var refreshToken2fa = await issueRefreshToken(user.id, user.tenant_id);
  logger.info({ email: user.email, ip: req.ip }, '[SECURITY] 2FA verificado — login superadmin exitoso');
  res.json({ token, refreshToken: refreshToken2fa, user: { id: user.id, name: user.name, email: user.email, role: user.role, tenant_id: user.tenant_id || null } });
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth'), (req, res) => {
  res.json({ user: req.user });
});

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Renovar JWT usando refresh token
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200:
 *         description: Nuevo par de tokens
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string }
 *                 refreshToken: { type: string }
 *       401:
 *         description: Token inválido o expirado
 */
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token requerido' });

  var hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  var { data: row, error } = await supabase
    .from('refresh_tokens')
    .select('*, users(*)')
    .eq('token_hash', hash)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !row) return res.status(401).json({ error: 'Refresh token inválido o expirado' });

  var user = row.users;
  if (!user || !user.active) return res.status(401).json({ error: 'Usuario inactivo' });

  // Rotar: revocar el token anterior y emitir uno nuevo
  await supabase.from('refresh_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', row.id);
  var newRefreshToken = await issueRefreshToken(user.id, user.tenant_id);

  var token = jwt.sign(
    { userId: user.id, name: user.name, email: user.email, role: user.role, tenant_id: user.tenant_id || null },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({ token, refreshToken: newRefreshToken });
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    var hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await supabase.from('refresh_tokens').update({ revoked_at: new Date().toISOString() }).eq('token_hash', hash);
  }
  res.json({ ok: true });
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

  if (error) { logger.error({ err: error }, '[FIND-USER]'); return res.status(500).json({ error: 'Error interno' }); }
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

  if (error) { logger.error({ err: error }, '[VERIFY-ANSWER]'); return res.status(500).json({ error: 'Error interno' }); }
  if (!users || users.length === 0 || !users[0].active)
    return res.status(404).json({ error: 'Cuenta no encontrada' });
  if (!users[0].sec_answer_hash)
    return res.status(400).json({ error: 'Cuenta sin respuesta de seguridad configurada' });

  if (hashAnswer(answer) !== users[0].sec_answer_hash)
    return res.status(401).json({ error: 'Respuesta incorrecta' });

  // Emitir token de un solo uso válido 15 minutos para el paso de reset
  var resetToken = jwt.sign(
    { sub: email.toLowerCase().trim(), purpose: 'password_reset' },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
  res.json({ ok: true, resetToken });
});

// POST /api/auth/reset-password
router.post('/reset-password', recoveryLimiter, async (req, res) => {
  const { resetToken, newPassword } = req.body;
  if (!resetToken || !newPassword)
    return res.status(400).json({ error: 'Datos incompletos' });
  if (String(newPassword).length < 8)
    return res.status(400).json({ error: 'La contraseña debe tener mínimo 8 caracteres' });

  var payload;
  try {
    payload = jwt.verify(resetToken, process.env.JWT_SECRET);
  } catch(e) {
    return res.status(401).json({ error: 'Token inválido o expirado. Volvé a verificar tu respuesta de seguridad.' });
  }
  if (payload.purpose !== 'password_reset')
    return res.status(401).json({ error: 'Token inválido' });

  const email = payload.sub;
  const { data: users, error } = await supabase
    .from('users')
    .select('id,active')
    .eq('email', email)
    .limit(1);

  if (error) { logger.error({ err: error }, '[RESET-PASSWORD]'); return res.status(500).json({ error: 'Error interno' }); }
  if (!users || users.length === 0 || !users[0].active)
    return res.status(404).json({ error: 'Cuenta no encontrada' });

  const newHash = await hashPassword(newPassword);
  const { error: updErr } = await supabase
    .from('users')
    .update({ password_hash: newHash, updated_at: new Date() })
    .eq('id', users[0].id);

  if (updErr) {
    logger.error({ err: updErr }, '[RESET-PASSWORD]');
    return res.status(500).json({ error: 'Error al actualizar la contraseña' });
  }

  res.json({ ok: true });
});

module.exports = router;
