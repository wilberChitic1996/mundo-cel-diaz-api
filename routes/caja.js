const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');

// GET /api/caja/sesiones — últimas sesiones de caja
router.get('/sesiones', auth, async (req, res) => {
  var { data, error } = await supabase
    .from('caja_sesiones')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.json(data || []);
});

// GET /api/caja/sesiones/activa — sesión abierta actual
router.get('/sesiones/activa', auth, async (req, res) => {
  var { data, error } = await supabase
    .from('caja_sesiones')
    .select('*')
    .is('closed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.json(data || null);
});

// POST /api/caja/abrir — abrir caja con fondo inicial
router.post('/abrir', auth, async (req, res) => {
  var { fondo_inicial, nota } = req.body;
  if (fondo_inicial === undefined || fondo_inicial === null) {
    return res.status(400).json({ error: 'fondo_inicial requerido' });
  }

  // Verificar si hay sesión activa
  var { data: activa } = await supabase
    .from('caja_sesiones')
    .select('id')
    .is('closed_at', null)
    .limit(1)
    .maybeSingle();
  if (activa) return res.status(409).json({ error: 'Ya hay una caja abierta' });

  var { data, error } = await supabase
    .from('caja_sesiones')
    .insert({
      fondo_inicial: Number(fondo_inicial),
      nota_apertura: nota || null,
      opened_by: req.user.name,
      opened_role: req.user.role,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.json(data);
});

// POST /api/caja/cerrar/:id — cerrar caja con arqueo
router.post('/cerrar/:id', auth, async (req, res) => {
  var { efectivo_contado, nota } = req.body;

  var { data, error } = await supabase
    .from('caja_sesiones')
    .update({
      closed_at: new Date().toISOString(),
      closed_by: req.user.name,
      closed_role: req.user.role,
      efectivo_contado: efectivo_contado !== undefined ? Number(efectivo_contado) : null,
      nota_cierre: nota || null,
    })
    .eq('id', req.params.id)
    .is('closed_at', null)
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Error interno' });
  if (!data) return res.status(404).json({ error: 'Sesión no encontrada o ya cerrada' });
  res.json(data);
});

// GET /api/caja/gastos — gastos de la sesión activa o por sesión
router.get('/gastos', auth, async (req, res) => {
  var { sesion_id } = req.query;
  var q = supabase.from('caja_gastos').select('*').order('created_at', { ascending: false });
  if (sesion_id) q = q.eq('sesion_id', sesion_id);
  var { data, error } = await q;
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.json(data || []);
});

// POST /api/caja/gastos — registrar gasto de caja
router.post('/gastos', auth, async (req, res) => {
  var { sesion_id, concepto, monto, categoria } = req.body;
  if (!concepto || !monto) return res.status(400).json({ error: 'concepto y monto requeridos' });

  var { data, error } = await supabase
    .from('caja_gastos')
    .insert({
      sesion_id: sesion_id || null,
      concepto,
      monto: Number(monto),
      categoria: categoria || 'general',
      registrado_por: req.user.name,
      registrado_role: req.user.role,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.json(data);
});

// DELETE /api/caja/gastos/:id
router.delete('/gastos/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var { error } = await supabase.from('caja_gastos').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.json({ ok: true });
});

module.exports = router;
