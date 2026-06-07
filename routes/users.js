const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const crypto   = require('crypto');
const supabase = require('../supabase');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'mnpos_salt_2026').digest('hex');
}

router.get('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const { data, error } = await supabase
    .from('users').select('id,name,email,role,active,last_login,created_at').order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const { name, email, password, role } = req.body;
  const { data, error } = await supabase
    .from('users')
    .insert({ name, email: email.toLowerCase(), password_hash: hashPassword(password), role, active: true })
    .select('id,name,email,role,active').single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const updates = { ...req.body, updated_at: new Date() };
  if (updates.password) { updates.password_hash = hashPassword(updates.password); delete updates.password; }
  const { data, error } = await supabase
    .from('users').update(updates).eq('id', req.params.id).select('id,name,email,role,active').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
