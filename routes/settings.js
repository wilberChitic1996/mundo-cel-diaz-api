const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');
const { withTenant, tid } = require('../utils/tenant');

// GET /api/settings
router.get('/', auth, async (req, res) => {
  var q = supabase.from('store_settings').select('key, value').order('key');
  q = withTenant(q, req);
  var { data, error } = await q;
  if (error) return res.status(500).json({ error: 'Error interno' });
  var result = {};
  (data || []).forEach(function(r) { result[r.key] = r.value || ''; });
  res.json(result);
});

// PUT /api/settings
router.put('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var updates = req.body;
  if (!updates || typeof updates !== 'object') return res.status(400).json({ error: 'Datos inválidos' });

  var tenantId = tid(req);
  var rows = Object.keys(updates).map(function(k) {
    return { key: k, value: String(updates[k] || ''), updated_at: new Date().toISOString(), tenant_id: tenantId };
  });

  var { error } = await supabase
    .from('store_settings')
    .upsert(rows, { onConflict: 'tenant_id,key' });

  if (error) {
    console.error('[SETTINGS] upsert error:', error.message);
    return res.status(500).json({ error: 'Error interno al guardar configuración' });
  }

  res.json({ ok: true });
});

module.exports = router;
