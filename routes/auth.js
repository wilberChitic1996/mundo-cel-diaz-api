const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const supabase = require('../supabase');

// Hash SHA-256 con salt (igual que el frontend)
function hashPassword(password) {
  return crypto
    .createHash('sha256')
    .update(password + 'mnpos_salt_2026')
    .digest('hex');
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
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

module.exports = router;
