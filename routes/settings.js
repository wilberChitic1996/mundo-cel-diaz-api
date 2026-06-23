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

  // Upsert con conflicto en (tenant_id, key) — requiere constraint en DB
  var { error } = await supabase
    .from('store_settings')
    .upsert(rows, { onConflict: 'tenant_id,key' });

  // Fallback: si falla por constraint no existente, hacer upsert por key solo
  if (error) {
    var { error: e2 } = await supabase.from('store_settings').upsert(rows, { onConflict: 'key' });
    if (e2) return res.status(500).json({ error: 'Error interno' });
  }

  res.json({ ok: true });
});

module.exports = router;
