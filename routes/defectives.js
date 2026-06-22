const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');

// GET /api/defectives
router.get('/', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('defectives').select('*').order('created_at', { ascending: false });
  if (error) { console.error('[DEFECTIVES]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data);
});

// PUT /api/defectives/:id
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var { status } = req.body;

  // Si se reingresar: devolver stock
  if (status === 'reingresado') {
    var { data: def } = await supabase.from('defectives').select('*').eq('id', req.params.id).single();
    if (def && def.code) {
      var { data: prod } = await supabase.from('products').select('stock').eq('code', def.code).single();
      if (prod) {
        await supabase.from('products').update({ stock: prod.stock + def.qty, updated_at: new Date() }).eq('code', def.code);
      }
    }
  }

  var { data, error } = await supabase
    .from('defectives').update({ status: status, updated_at: new Date() })
    .eq('id', req.params.id).select().single();
  if (error) { console.error('[DEFECTIVES]', error.message); return res.status(500).json({ error: 'Error interno' }); }
  res.json(data);
});

module.exports = router;
