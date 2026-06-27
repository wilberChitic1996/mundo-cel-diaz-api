const app = require('./app');
const logger = require('./utils/logger');

var PORT = process.env.PORT || 4000;
app.listen(PORT, function() {
  logger.info({ port: PORT, supabase: process.env.SUPABASE_URL }, 'PraxisGT API iniciado');
});
