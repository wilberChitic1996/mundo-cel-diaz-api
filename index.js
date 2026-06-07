require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const app = express();

// Middlewares
app.use(cors({ origin: '*' }));
app.use(express.json());

// Rutas
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/sales',    require('./routes/sales'));
app.use('/api/accounts', require('./routes/accounts'));
app.use('/api/users',    require('./routes/users'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', system: 'MUNDO CEL DIAZ API' });
});

// 404
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`MUNDO CEL DIAZ API corriendo en http://localhost:${PORT}`);
  console.log(`Supabase: ${process.env.SUPABASE_URL}`);
});
