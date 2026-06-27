const Sentry = require('@sentry/node');

function initSentry() {
  var dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: 'praxisgt-api@2.2.0',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
}

function sentryRequestHandler() {
  return Sentry.Handlers.requestHandler();
}

function sentryErrorHandler() {
  return Sentry.Handlers.errorHandler();
}

module.exports = { initSentry, sentryRequestHandler, sentryErrorHandler, Sentry };
