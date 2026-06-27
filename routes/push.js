const express   = require('express');
const router    = express.Router();
const webpush   = require('web-push');
const auth      = require('../middleware/auth');
const supabase  = require('../supabase');
const logger    = require('../utils/logger');
const { withTenant, tid } = require('../utils/tenant');

webpush.setVapidDetails(
  'mailto:' + (process.env.VAPID_EMAIL || 'admin@mundoceldiaz.com'),
  process.env.VAPID_PUBLIC_KEY  || '',
  process.env.VAPID_PRIVATE_KEY || ''
);

// GET /api/push/vapid-public-key — clave pública para el service worker
router.get('/vapid-public-key', function(req, res) {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || '' });
});

// POST /api/push/subscribe — guardar suscripción del navegador
router.post('/subscribe', auth, async function(req, res) {
  var sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Suscripción inválida' });

  var { error } = await supabase.from('push_subscriptions').upsert({
    tenant_id:   tid(req),
    user_id:     req.user.userId,
    endpoint:    sub.endpoint,
    p256dh:      sub.keys && sub.keys.p256dh,
    auth_key:    sub.keys && sub.keys.auth,
    updated_at:  new Date().toISOString(),
  }, { onConflict: 'endpoint' });

  if (error) {
    logger.error({ err: error }, '[PUSH] Error guardando suscripción');
    return res.status(500).json({ error: 'Error interno' });
  }
  res.json({ ok: true });
});

// DELETE /api/push/subscribe — eliminar suscripción (al hacer logout o revocar permiso)
router.delete('/subscribe', auth, async function(req, res) {
  var { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint requerido' });

  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('tenant_id', tid(req));
  res.json({ ok: true });
});

// Función interna: enviar notificación push a todos los usuarios de un tenant
async function sendPushToTenant(tenantId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;

  var { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key, id')
    .eq('tenant_id', tenantId);

  if (!subs || subs.length === 0) return;

  var msg = JSON.stringify(payload);
  for (var s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
        msg
      );
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Suscripción expirada — limpiar
        await supabase.from('push_subscriptions').delete().eq('id', s.id);
      } else {
        logger.warn({ err: err.message, endpoint: s.endpoint }, '[PUSH] Error enviando notificación');
      }
    }
  }
}

module.exports = router;
module.exports.sendPushToTenant = sendPushToTenant;
