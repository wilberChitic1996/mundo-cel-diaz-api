// routes/webhooks.js
// Webhook PROVIDER-AGNOSTIC de pagos (Recurrente / Stripe / etc.) para cobro recurrente SaaS.
//
// "El vagón": queda listo para anclar la pasarela. DORMIDO por defecto
// (PAYMENTS_ENABLED !== 'true' → 503), público pero protegido por firma HMAC-SHA256.
// Al recibir un pago confirmado, extiende la suscripción del tenant (subscriptionService) y
// invalida la caché que lee enforceSubscription (B2).
//
// Activación: ver checklist de cobro en CLAUDE.md (pasarela, WEBHOOK_SECRET, registrar endpoint).
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const logger  = require('../utils/logger');
const { renewSubscription } = require('../services/subscriptionService');

function paymentsEnabled() { return process.env.PAYMENTS_ENABLED === 'true'; }

// Verifica firma HMAC-SHA256 del cuerpo crudo contra WEBHOOK_SECRET (timing-safe).
function verifySignature(rawBody, signature) {
  var secret = process.env.WEBHOOK_SECRET;
  if (!secret || !signature || !rawBody) return false;
  try {
    var expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    var a = Buffer.from(String(signature));
    var b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

// Eventos que se interpretan como "pago confirmado → renovar".
var RENEWAL_EVENTS = ['payment_success', 'payment.succeeded', 'invoice.payment_succeeded', 'subscription_renewed'];
var PLAN_DURATIONS = { basic: 30, pro: 30, enterprise: 365 };

// POST /api/webhooks/payment
router.post('/payment', async (req, res) => {
  if (!paymentsEnabled()) return res.status(503).json({ error: 'Cobros no habilitados', code: 'PAYMENTS_DISABLED' });

  var raw = req.rawBody || JSON.stringify(req.body || {});
  var signature = req.headers['x-signature'] || req.headers['x-webhook-signature'];
  if (!verifySignature(raw, signature)) {
    logger.warn({ ip: req.ip }, '[BILLING] webhook con firma inválida');
    return res.status(401).json({ error: 'Firma inválida' });
  }

  var body = req.body || {};
  var eventType = body.event_type || body.type;
  var tenantId  = body.tenant_id || (body.metadata && body.metadata.tenant_id);
  var plan      = body.plan || (body.metadata && body.metadata.plan) || 'basic';
  if (!tenantId) return res.status(400).json({ error: 'Falta tenant_id en el payload' });

  try {
    if (RENEWAL_EVENTS.indexOf(eventType) >= 0) {
      var newExpires = await renewSubscription(tenantId, PLAN_DURATIONS[plan] || 30, {
        provider: body.provider || process.env.PAYMENT_PROVIDER || null, eventType: eventType,
      });
      return res.json({ ok: true, expires_at: newExpires });
    }
    // Otros eventos (payment_failed, cancelled, etc.): se registran, sin acción de renovación.
    // (Suspender por fallo se deja deliberadamente fuera para no bloquear por un evento espurio.)
    logger.info({ eventType: eventType, tenantId: tenantId }, '[BILLING] evento recibido sin renovación');
    return res.json({ ok: true, ignored: eventType || null });
  } catch (e) {
    logger.error({ err: e && e.message, tenantId: tenantId }, '[BILLING] error procesando webhook');
    return res.status(500).json({ error: 'Error procesando webhook' });
  }
});

module.exports = router;
module.exports.verifySignature = verifySignature; // expuesto para tests
