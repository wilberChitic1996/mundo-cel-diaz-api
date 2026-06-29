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
    // C5: solo los despliegues de NUESTRO proyecto en Vercel (staging + PR previews
    // del proyecto mundo-cel-diaz), no cualquier *.vercel.app de terceros.
    if (/^https:\/\/mundo-cel-diaz[a-z0-9-]*\.vercel\.app$/i.test(origin)) return cb(null, true);
    cb(new Error('CORS no permitido: ' + origin));
  },
  credentials: true
}));
app.use(generalLimiter);
app.use('/api/settings',    express.json({ limit: '600kb' }));
app.use('/api/v1/settings', express.json({ limit: '600kb' }));
// Fotos de reparaciones en base64 pueden pesar hasta ~4MB
app.use('/api/repairs',     express.json({ limit: '4mb' }));
app.use('/api/v1/repairs',  express.json({ limit: '4mb' }));
// Webhooks de pago: necesitan el cuerpo CRUDO para verificar la firma HMAC.
function captureRawBody(req, _res, buf) { req.rawBody = buf.toString('utf8'); }
app.use('/api/webhooks',    express.json({ limit: '50kb', verify: captureRawBody }));
app.use('/api/v1/webhooks', express.json({ limit: '50kb', verify: captureRawBody }));
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
  serials:    require('./routes/serials'),
};

Object.keys(routes).forEach(function(name) {
  app.use('/api/'    + name, routes[name]);  // Legacy — mantiene compatibilidad
  app.use('/api/v1/' + name, routes[name]);  // v1 — nueva convención
});

// Variantes de producto — montadas bajo /api/products/:id/variants
var variantsRouter = require('./routes/variants');
app.use('/api/products',    variantsRouter);
app.use('/api/v1/products', variantsRouter);

// Webhooks de pasarela de cobro (cobro recurrente SaaS) — dormido hasta PAYMENTS_ENABLED=true
var webhooksRouter = require('./routes/webhooks');
app.use('/api/webhooks',    webhooksRouter);
app.use('/api/v1/webhooks', webhooksRouter);

app.get('/health', async function(req, res) {
  var total_records = null;
  try {
    var supabase = require('./supabase');
    var TABLES = ['clients', 'products', 'sales', 'sale_items', 'audit_logs', 'repairs', 'warranties', 'accounts'];
    var timeout = new Promise(function(_, reject) { setTimeout(function() { reject(new Error('timeout')); }, 3000); });
    var counts = await Promise.race([
      Promise.all(TABLES.map(function(t) {
        return supabase.from(t).select('*', { count: 'exact', head: true }).then(function(r) { return r.count || 0; });
      })),
      timeout
    ]);
    total_records = counts.reduce(function(s, c) { return s + c; }, 0);
  } catch (e) {
    // DB no disponible o timeout — health sigue respondiendo ok
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
