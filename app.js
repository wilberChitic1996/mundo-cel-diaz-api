require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const { generalLimiter } = require('./middleware/rateLimit');
const logger = require('./utils/logger');
const { setupSwagger } = require('./swagger');
const { initSentry, sentryRequestHandler, sentryErrorHandler } = require('./utils/sentry');

initSentry();

const app = express();
app.set('trust proxy', 1);
app.use(sentryRequestHandler());

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      scriptSrc: ["'none'"],
      styleSrc: ["'none'"],
      imgSrc: ["'none'"],
      connectSrc: ["'self'"],
      fontSrc: ["'none'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'none'"],
      frameSrc: ["'none'"],
      formAction: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
  xContentTypeOptions: true,
  xDnsPrefetchControl: { allow: false },
  xFrameOptions: { action: 'deny' },
  xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
}));

var allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(function(u) { return u.trim(); })
  : [];
app.use(cors({
  origin: function(origin, cb) {
    // Permitir requests sin origen (Postman, curl, server-to-server)
    if (!origin) return cb(null, true);
    // Orígenes explícitos desde FRONTEND_URL env var
    if (allowedOrigins.length > 0 && allowedOrigins.includes(origin)) return cb(null, true);
    // Permitir todos los dominios de Vercel (staging y PR previews)
    if (origin.endsWith('.vercel.app')) return cb(null, true);
    cb(new Error('CORS no permitido: ' + origin));
  },
  credentials: true
}));
app.use(generalLimiter);
app.use('/api/settings',    express.json({ limit: '600kb' }));
app.use('/api/v1/settings', express.json({ limit: '600kb' }));
app.use(express.json({ limit: '10kb' }));

// v1 routes (nueva convención — mismos handlers, prefijo /api/v1/)
var routes = {
  public:     require('./routes/public'),
  auth:       require('./routes/auth'),
  products:   require('./routes/products'),
  sales:      require('./routes/sales'),
  accounts:   require('./routes/accounts'),
  returns:    require('./routes/returns'),
  defectives: require('./routes/defectives'),
  users:      require('./routes/users'),
  clients:    require('./routes/clients'),
  repairs:    require('./routes/repairs'),
  audit:      require('./routes/audit'),
  warranties: require('./routes/warranties'),
  caja:       require('./routes/caja'),
  settings:   require('./routes/settings'),
  suppliers:  require('./routes/suppliers'),
  categories: require('./routes/categories'),
  locations:  require('./routes/locations'),
  admin:      require('./routes/admin'),
  reminders:  require('./routes/reminders'),
  push:       require('./routes/push'),
  backup:     require('./routes/backup'),
};

Object.keys(routes).forEach(function(name) {
  app.use('/api/'    + name, routes[name]);  // Legacy — mantiene compatibilidad
  app.use('/api/v1/' + name, routes[name]);  // v1 — nueva convención
});

app.get('/health', async function(req, res) {
  var total_records = null;
  try {
    var supabase = require('./supabase');
    var TABLES = ['clients', 'products', 'sales', 'sale_items', 'audit_logs', 'repairs', 'warranties', 'accounts'];
    var counts = await Promise.all(
      TABLES.map(function(t) {
        return supabase.from(t).select('*', { count: 'exact', head: true }).then(function(r) { return r.count || 0; });
      })
    );
    total_records = counts.reduce(function(s, c) { return s + c; }, 0);
  } catch (e) {
    logger.warn({ err: e }, '[HEALTH] No se pudo obtener total_records');
  }
  res.json({ status:'ok', version:'2.2.0', system:'PraxisGT API', total_records });
});

setupSwagger(app);

app.use(function(req, res) { res.status(404).json({ error:'Ruta no encontrada' }); });

app.use(sentryErrorHandler());

app.use(function(err, req, res, _next) {
  logger.error({ err, method: req.method, url: req.url }, 'Error interno del servidor');
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;
