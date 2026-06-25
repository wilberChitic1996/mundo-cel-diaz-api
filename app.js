require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const { generalLimiter } = require('./middleware/rateLimit');

const app = express();
app.set('trust proxy', 1);

app.use(helmet());

var allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(function(u) { return u.trim(); })
  : ['*'];
app.use(cors({
  origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
  credentials: true
}));
app.use(generalLimiter);
app.use('/api/settings', express.json({ limit: '600kb' }));
app.use(express.json({ limit: '10kb' }));

app.use('/api/auth',      require('./routes/auth'));
app.use('/api/products',  require('./routes/products'));
app.use('/api/sales',     require('./routes/sales'));
app.use('/api/accounts',  require('./routes/accounts'));
app.use('/api/returns',   require('./routes/returns'));
app.use('/api/defectives',require('./routes/defectives'));
app.use('/api/users',     require('./routes/users'));
app.use('/api/clients',   require('./routes/clients'));
app.use('/api/repairs',   require('./routes/repairs'));
app.use('/api/audit',      require('./routes/audit'));
app.use('/api/warranties', require('./routes/warranties'));
app.use('/api/caja',      require('./routes/caja'));
app.use('/api/settings',  require('./routes/settings'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/categories',require('./routes/categories'));
app.use('/api/locations', require('./routes/locations'));
app.use('/api/admin',     require('./routes/admin'));

app.get('/health', function(req, res) {
  res.json({ status:'ok', version:'2.2.0', system:'PraxisGT API' });
});

app.use(function(req, res) { res.status(404).json({ error:'Ruta no encontrada' }); });

app.use(function(err, req, res, _next) {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;
