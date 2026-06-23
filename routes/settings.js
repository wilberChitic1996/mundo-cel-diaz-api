const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');

// GET /api/settings — todas las configuraciones
router.get('/', auth, async (req, res) => {
  var { data, error } = await supabase
    .from('store_settings')
    .select('key, value')
    .order('key');
  if (error) return res.status(500).json({ error: 'Error interno' });
  var result = {};
  (data || []).forEach(function(r) { result[r.key] = r.value || ''; });
  res.json(result);
});

// PUT /api/settings — actualizar una o varias claves
router.put('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var updates = req.body; // { store_name: 'X', store_phone: '...' }
  if (!updates || typeof updates !== 'object') return res.status(400).json({ error: 'Datos inválidos' });

  var rows = Object.keys(updates).map(function(k) {
    return { key: k, value: String(updates[k] || ''), updated_at: new Date().toISOString() };
  });

  var { error } = await supabase
    .from('store_settings')
    .upsert(rows, { onConflict: 'key' });
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.json({ ok: true });
});

module.exports = router;
