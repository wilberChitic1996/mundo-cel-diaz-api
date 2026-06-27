// Sentry es opcional: si @sentry/node no está instalado o no hay SENTRY_DSN,
// todo queda como no-op y la app funciona igual (ver CLAUDE.md).
var Sentry = null;
try {
  Sentry = require('@sentry/node');
} catch (e) {
  Sentry = null;
}

function initSentry() {
  var dsn = process.env.SENTRY_DSN;
  if (!Sentry || !dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: 'praxisgt-api@2.2.0',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
}

// Middleware no-op cuando Sentry no está disponible o la API de Handlers no existe (SDK v8+).
function noop(req, res, next) { return next(); }
function noopError(err, req, res, next) { return next(err); }

function sentryRequestHandler() {
  if (Sentry && Sentry.Handlers && Sentry.Handlers.requestHandler) {
    return Sentry.Handlers.requestHandler();
  }
  return noop;
}

function sentryErrorHandler() {
  if (Sentry && Sentry.Handlers && Sentry.Handlers.errorHandler) {
    return Sentry.Handlers.errorHandler();
  }
  return noopError;
}

module.exports = { initSentry, sentryRequestHandler, sentryErrorHandler, Sentry };
