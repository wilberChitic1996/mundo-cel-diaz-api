// ══════════════════════════════════════════════════════════════════════════════
// RUTAS PÚBLICAS — sin autenticación
//
// GET /api/public/verify/:id
//   Verifica la autenticidad de un comprobante (venta o cuenta) a partir de su id.
//   El id es un UUID generado por la base de datos (imposible de adivinar), por lo
//   que la consulta solo devuelve algo si el folio existe realmente. Se exponen
//   únicamente datos mínimos de verificación (negocio, folio, fecha, total, estado),
//   los mismos que ya aparecen impresos en la boleta física que porta el QR.
// ══════════════════════════════════════════════════════════════════════════════

const express  = require('express');
const router   = express.Router();
const supabase = require('../supabase');

// Acepta solo ids con forma de UUID para evitar consultas basura.
var UUID_RE = /^[0-9a-fA-F-]{32,40}$/;

router.get('/verify/:id', async (req, res) => {
  var id = String(req.params.id || '').trim();
  if (!UUID_RE.test(id)) return res.status(400).json({ valid: false, error: 'ID inválido' });

  // 1) Buscar primero como VENTA
  var record = null;
  var tipo = null;
  var { data: sale } = await supabase
    .from('sales')
    .select('id, client, total, status, created_at, tenant_id')
    .eq('id', id)
    .maybeSingle();

  if (sale) { record = sale; tipo = 'venta'; }

  // 2) Si no es venta, buscar como CUENTA por cobrar
  if (!record) {
    var { data: acc } = await supabase
      .from('accounts')
      .select('id, client, total, balance, status, created_at, tenant_id')
      .eq('id', id)
      .maybeSingle();
    if (acc) { record = acc; tipo = 'cuenta'; }
  }

  if (!record) return res.json({ valid: false });

  // 3) Nombre del negocio (settings del tenant del comprobante)
  var storeName = '';
  var { data: setting } = await supabase
    .from('store_settings')
    .select('value')
    .eq('tenant_id', record.tenant_id)
    .eq('key', 'store_name')
    .maybeSingle();
  if (setting && setting.value) storeName = setting.value;

  res.json({
    valid: true,
    tipo: tipo,
    folio: String(record.id).toUpperCase().slice(-8),
    store_name: storeName,
    client: record.client || '',
    total: record.total,
    status: record.status || '',
    balance: (record.balance != null ? record.balance : undefined),
    date: record.created_at,
  });
});

module.exports = router;
