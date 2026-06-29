// middleware/enforceSubscription.js
// Bloquea las operaciones de negocio cuando la suscripción del tenant está
// INACTIVA o VENCIDA. Debe usarse después de `auth` (necesita req.user).
//
// - superadmin y requests sin tenant pasan (no aplican).
// - El estado se cachea 5 min (utils/cache) para no consultar la BD por request.
// - La consulta a la BD tiene timeout acotado: si tarda demasiado se hace fail-open
//   (no colgar la operación de un cliente al día por una BD lenta/transitoria).
// - Política fail-open ante error/timeout: el bloqueo solo ocurre cuando se CONFIRMA
//   que el tenant está inactivo o vencido.
const supabase = require('../supabase');
const cache    = require('../utils/cache');
const logger   = require('../utils/logger');

const TTL_SECONDS       = 300;  // 5 minutos de caché
const LOOKUP_TIMEOUT_MS = 1500; // tope para la consulta de suscripción

// Decisión pura y testeable: ¿debe bloquearse según el estado del tenant?
function isSubscriptionBlocked(sub) {
  if (!sub) return false; // sin información confirmada → no bloquear (fail-open)
  var vencido = sub.expires_at && new Date(sub.expires_at).getTime() < Date.now();
  return sub.active === false || !!vencido;
}

async function fetchTenantStatus(tenantId) {
  var lookup = supabase.from('tenants').select('active, expires_at').eq('id', tenantId).single();
  var timeout = new Promise(function (resolve) {
    setTimeout(function () { resolve({ data: null, error: 'timeout' }); }, LOOKUP_TIMEOUT_MS);
  });
  var result = await Promise.race([lookup, timeout]);
  if (!result || result.error || !result.data) return null;
  return { active: result.data.active, expires_at: result.data.expires_at };
}

async function enforceSubscription(req, res, next) {
  try {
    if (!req.user || req.user.role === 'superadmin') return next();
    var tenantId = req.user.tenant_id;
    if (!tenantId) return next();

    var key = 'sub:' + tenantId;
    var sub = await cache.get(key);
    if (!sub) {
      sub = await fetchTenantStatus(tenantId);
      if (sub) await cache.set(key, sub, TTL_SECONDS);
    }

    if (isSubscriptionBlocked(sub)) {
      return res.status(403).json({
        error: 'Suscripción inactiva o vencida. Contactá al administrador para renovar.',
        code: 'SUBSCRIPTION_INACTIVE',
      });
    }
    return next();
  } catch (e) {
    logger.warn({ err: e }, '[enforceSubscription] error — fail-open');
    return next();
  }
}

module.exports = enforceSubscription;
module.exports.isSubscriptionBlocked = isSubscriptionBlocked; // expuesto para tests unitarios
