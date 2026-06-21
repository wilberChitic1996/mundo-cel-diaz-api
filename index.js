require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const app = express();

// Railway corre detrás de un proxy: confiar en 1 hop para que el rate
// limiter identifique la IP real del cliente (vía X-Forwarded-For).
app.set('trust proxy', 1);

app.use(cors({ origin: '*' }));
app.use(express.json());

app.use('/api/auth',      require('./routes/auth'));
app.use('/api/products',  require('./routes/products'));
app.use('/api/sales',     require('./routes/sales'));
app.use('/api/accounts',  require('./routes/accounts'));
app.use('/api/returns',   require('./routes/returns'));
app.use('/api/defectives',require('./routes/defectives'));
app.use('/api/users',     require('./routes/users'));
app.use('/api/clients',   require('./routes/clients'));
app.use('/api/repairs',   require('./routes/repairs'));

app.get('/health', function(req, res) {
  res.json({ status:'ok', version:'1.2.0', system:'MUNDO CEL DIAZ API' });
});

app.use(function(req, res) { res.status(404).json({ error:'Ruta no encontrada' }); });

var PORT = process.env.PORT || 4000;
app.listen(PORT, function() {
  console.log('MUNDO CEL DIAZ API corriendo en http://localhost:' + PORT);
  console.log('Supabase: ' + process.env.SUPABASE_URL);
});