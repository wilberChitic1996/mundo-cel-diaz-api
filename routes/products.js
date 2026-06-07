const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');

// GET /api/products
router.get('/', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('products').select('*').eq('active', true).order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/products
router.post('/', auth, async (req, res) => {
  if (!['admin'].includes(req.user.role))
    return res.status(403).json({ error: 'Sin permisos' });
  const { data, error } = await supabase
    .from('products').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PUT /api/products/:id
router.put('/:id', auth, async (req, res) => {
  if (!['admin'].includes(req.user.role))
    return res.status(403).json({ error: 'Sin permisos' });
  const { data, error } = await supabase
    .from('products').update({ ...req.body, updated_at: new Date() })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/products/:id (soft delete)
router.delete('/:id', auth, async (req, res) => {
  if (!['admin'].includes(req.user.role))
    return res.status(403).json({ error: 'Sin permisos' });
  const { error } = await supabase
    .from('products').update({ active: false }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
