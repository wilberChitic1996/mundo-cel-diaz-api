const rateLimit = require('express-rate-limit');

/* ══════════════════════════════════════════════════════════════════
   RATE LIMITING — protección anti fuerza-bruta
   Limita cuántas peticiones puede hacer una misma IP en una ventana
   de tiempo. Protege login y los endpoints públicos de recuperación.
   ══════════════════════════════════════════════════════════════════ */

// Limiter para LOGIN.
// Solo cuenta los intentos FALLIDOS (skipSuccessfulRequests:true), así un
// usuario legítimo que entra bien nunca se bloquea; solo se frena a quien
// falla repetidamente (ataque de fuerza bruta de contraseñas).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: 10,                // 10 intentos fallidos por IP por ventana
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de inicio de sesión. Esperá 15 minutos e intentá de nuevo.' },
});

// Limiter para RECUPERACIÓN de contraseña (find-user, verify-answer,
// reset-password). Cuenta TODAS las peticiones porque el abuso (adivinar
// la respuesta de seguridad o sondear emails) genera respuestas 200.
const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: 8,                 // 8 peticiones por IP por ventana
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de recuperación. Esperá 15 minutos e intentá de nuevo.' },
});

// Limiter general para todos los endpoints autenticados.
// 200 peticiones por IP cada 1 minuto — suficiente para uso normal,
// bloquea bots y ataques de enumeración masiva.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Intentá de nuevo en un momento.' },
});

module.exports = { loginLimiter, recoveryLimiter, generalLimiter };
