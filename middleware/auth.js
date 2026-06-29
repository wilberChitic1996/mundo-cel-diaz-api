// middleware/auth.js
// Valida el JWT y, además, hace cumplir la REVOCACIÓN DE SESIÓN: un usuario
// desactivado o eliminado pierde acceso aunque su JWT (8h) siga vigente.
//
// - El estado del usuario se cachea 1 min (utils/cache) para no consultar la BD
//   en cada request; la consulta tiene timeout acotado.
// - Política fail-open ante error/timeout: solo se bloquea cuando se CONFIRMA que
//   el usuario está inactivo o eliminado (el JWT ya está firmado y es de vida corta;
//   esto es defensa en profundidad, no la única barrera).
// - Login (`active=true`) y refresh (`!user.active → 401`) ya filtran inactivos; este
//   middleware cierra la ventana del access token ya emitido.
const jwt      = require('jsonwebtoken');
const supabase = require('../supabase');
const cache    = require('../utils/cache');
const logger   = require('../utils/logger');

const TTL_SECONDS       = 60;   // estado de usuario cacheado 1 min
// Tope para la consulta de revocación (configurable; default prod 1500ms).
const LOOKUP_TIMEOUT_MS = Number(process.env.DB_LOOKUP_TIMEOUT_MS) || 1500;

// Decisión pura y testeable: 'revoked'/'gone' bloquean; 'active'/'unknown' permiten.
function isSessionRevoked(status) {
  return status === 'revoked' || status === 'gone';
}

async function fetchUserStatus(userId) {
  // Promise.resolve().then(...) atrapa tanto un throw síncrono de supabase.from como un
  // rechazo de red; el .catch lo convierte en sentinela → fail-open ('unknown').
  var lookup = Promise.resolve()
    .then(function () { return supabase.from('users').select('active').eq('id', userId).single(); })
    .catch(function () { return { error: { code: 'NETWORK' } }; });
  var timeout = new Promise(function (resolve) {
    setTimeout(function () { resolve({ timedOut: true }); }, LOOKUP_TIMEOUT_MS);
  });
  var result = await Promise.race([lookup, timeout]);
  if (!result || result.timedOut) return 'unknown';
  if (result.error) {
    // PGRST116 = 0 filas: el usuario ya no existe (eliminado) → revocar.
    return result.error.code === 'PGRST116' ? 'gone' : 'unknown';
  }
  return result.data && result.data.active ? 'active' : 'revoked';
}

module.exports = async function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'Token requerido' });

  const token = header.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token inválido' });

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    logger.warn({ err: err.message, ip: req.ip, ruta: req.originalUrl }, '[SECURITY] Token inválido o expirado');
    return res.status(401).json({ error: 'Token expirado o inválido' });
  }
  req.user = decoded;

  // Revocación de sesión (defensa en profundidad).
  const userId = decoded.userId;
  if (userId) {
    try {
      var key = 'usr:' + userId;
      var status = await cache.get(key);
      if (!status) {
        status = await fetchUserStatus(userId);
        if (status !== 'unknown') await cache.set(key, status, TTL_SECONDS);
      }
      if (isSessionRevoked(status)) {
        logger.warn({ userId: userId, ip: req.ip }, '[SECURITY] Sesión revocada (usuario inactivo o eliminado)');
        return res.status(401).json({ error: 'Sesión revocada. Iniciá sesión nuevamente.', code: 'SESSION_REVOKED' });
      }
    } catch (e) {
      logger.warn({ err: e }, '[auth] revocación — fail-open');
    }
  }

  next();
};

module.exports.isSessionRevoked = isSessionRevoked; // expuesto para tests unitarios
