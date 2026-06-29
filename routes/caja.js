const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');
const { withTenant, tid } = require('../utils/tenant');
const requireRole = require('../middleware/requireRole');
const enforceSubscription = require('../middleware/enforceSubscription');

/**
 * @openapi
 * /caja:
 *   get:
 *     tags: [Caja]
 *     summary: Ver documentación completa en /api-docs
 *     responses:
 *       200:
 *         description: OK
 */
// GET /api/caja/sesiones
router.get('/sesiones', auth, async (req, res) => {
  var q = supabase.from('caja_sesiones').select('*').order('created_at', { ascending: false }).limit(30);
  q = withTenant(q, req);
  var { data, error } = await q;
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.json(data || []);
});

// GET /api/caja/sesiones/activa
router.get('/sesiones/activa', auth, async (req, res) => {
  var q = supabase.from('caja_sesiones').select('*').is('closed_at', null).order('created_at', { ascending: false }).limit(1);
  q = withTenant(q, req);
  var { data, error } = await q.maybeSingle();
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.json(data || null);
});

// POST /api/caja/abrir
router.post('/abrir', auth, requireRole('admin', 'cajero'), enforceSubscription, async (req, res) => {
  var { fondo_inicial, nota } = req.body;
  if (fondo_inicial === undefined || fondo_inicial === null) {
    return res.status(400).json({ error: 'fondo_inicial requerido' });
  }

  var { data: activa } = await withTenant(
    supabase.from('caja_sesiones').select('id').is('closed_at', null).limit(1),
    req
  ).maybeSingle();
  if (activa) return res.status(409).json({ error: 'Ya hay una caja abierta' });

  var { data, error } = await supabase
    .from('caja_sesiones')
    .insert({ fondo_inicial: Number(fondo_inicial), nota_apertura: nota || null, opened_by: req.user.name, opened_role: req.user.role, tenant_id: tid(req) })
    .select().single();
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.json(data);
});

// POST /api/caja/cerrar/:id
router.post('/cerrar/:id', auth, requireRole('admin', 'cajero'), enforceSubscription, async (req, res) => {
  var { efectivo_contado, nota } = req.body;

  // B3: calcular y persistir el arqueo del período en el servidor (antes quedaba nulo).
  // Traer la sesión abierta para conocer apertura y fondo inicial.
  var { data: ses } = await withTenant(
    supabase.from('caja_sesiones').select('*').eq('id', req.params.id).is('closed_at', null), req
  ).maybeSingle();
  if (!ses) return res.status(404).json({ error: 'Sesión no encontrada o ya cerrada' });

  var desde = ses.created_at;
  var hasta = new Date().toISOString();
  var fondo = Number(ses.fondo_inicial || 0);

  // Ventas completadas del período (con porción en efectivo, contemplando pago dividido A9/A10).
  var { data: ventas } = await withTenant(
    supabase.from('sales').select('total,method,second_method,second_amount,created_at,status')
      .eq('status', 'completado').gte('created_at', desde).lte('created_at', hasta), req
  );
  var total_ventas = 0, efectivo_ventas = 0;
  (ventas || []).forEach(function(s) {
    var t = Number(s.total || 0);
    total_ventas += t;
    var seg = Number(s.second_amount || 0);
    if (seg > 0) {
      if (s.method === 'Efectivo')        efectivo_ventas += (t - seg);
      if (s.second_method === 'Efectivo') efectivo_ventas += seg;
    } else if (s.method === 'Efectivo') {
      efectivo_ventas += t;
    }
  });

  // Abonos del período (efectivo aparte).
  var { data: abonos } = await withTenant(
    supabase.from('account_payments').select('amount,method,created_at')
      .gte('created_at', desde).lte('created_at', hasta), req
  );
  var total_abonos = 0, efectivo_abonos = 0;
  (abonos || []).forEach(function(p) {
    var a = Number(p.amount || 0);
    total_abonos += a;
    if (p.method === 'Efectivo') efectivo_abonos += a;
  });

  // Gastos de la sesión.
  var { data: gastos } = await withTenant(
    supabase.from('caja_gastos').select('monto').eq('sesion_id', req.params.id), req
  );
  var total_gastos = (gastos || []).reduce(function(s, g) { return s + Number(g.monto || 0); }, 0);

  // Efectivo esperado en caja y diferencia contra lo contado.
  var total_efectivo = fondo + efectivo_ventas + efectivo_abonos - total_gastos;
  var contado = (efectivo_contado !== undefined && efectivo_contado !== null) ? Number(efectivo_contado) : null;
  var diferencia = contado !== null ? (contado - total_efectivo) : null;

  var { data, error } = await withTenant(
    supabase.from('caja_sesiones').update({
      closed_at: hasta,
      closed_by: req.user.name,
      closed_role: req.user.role,
      efectivo_contado: contado,
      total_ventas: total_ventas,
      total_gastos: total_gastos,
      total_abonos: total_abonos,
      total_efectivo: total_efectivo,
      diferencia: diferencia,
      nota_cierre: nota || null,
    }).eq('id', req.params.id).is('closed_at', null),
    req
  ).select().single();
  if (error) return res.status(500).json({ error: 'Error interno' });
  if (!data) return res.status(404).json({ error: 'Sesión no encontrada o ya cerrada' });
  res.json(data);
});

// GET /api/caja/gastos
router.get('/gastos', auth, async (req, res) => {
  var { sesion_id } = req.query;
  var q = supabase.from('caja_gastos').select('*').order('created_at', { ascending: false });
  q = withTenant(q, req);
  if (sesion_id) q = q.eq('sesion_id', sesion_id);
  var { data, error } = await q;
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.json(data || []);
});

// POST /api/caja/gastos
router.post('/gastos', auth, requireRole('admin', 'cajero'), enforceSubscription, async (req, res) => {
  var { sesion_id, concepto, monto, categoria } = req.body;
  if (!concepto || !monto) return res.status(400).json({ error: 'concepto y monto requeridos' });

  var { data, error } = await supabase
    .from('caja_gastos')
    .insert({ sesion_id: sesion_id || null, concepto, monto: Number(monto), categoria: categoria || 'general', registrado_por: req.user.name, registrado_role: req.user.role, tenant_id: tid(req) })
    .select().single();
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.json(data);
});

// DELETE /api/caja/gastos/:id
router.delete('/gastos/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  var { error } = await withTenant(supabase.from('caja_gastos').delete().eq('id', req.params.id), req);
  if (error) return res.status(500).json({ error: 'Error interno' });
  res.json({ ok: true });
});

module.exports = router;
