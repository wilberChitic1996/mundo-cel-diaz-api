const app = require('./app');
const logger = require('./utils/logger');
const { startCronJobs } = require('./utils/reminders');

var PORT = process.env.PORT || 4000;
app.listen(PORT, function() {
  logger.info({ port: PORT, supabase: process.env.SUPABASE_URL }, 'PraxisGT API iniciado');
  startCronJobs();
});
