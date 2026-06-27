const cron = require('node-cron');
const supabase = require('../supabase');
const logger = require('./logger');

function getPush() {
  try { return require('../routes/push').sendPushToTenant; } catch { return null; }
}

// Cuentas por cobrar: vencimiento en días 0, 30, 60, 90
async function checkOverdueAccounts() {
  try {
    var now = new Date().toISOString().split('T')[0];
    var { data, error } = await supabase
      .from('accounts')
      .select('id, client, balance, due_date, tenant_id')
      .eq('status', 'pendiente')
      .lte('due_date', now)
      .not('due_date', 'is', null);
    if (error) { logger.error({ err: error }, '[CRON] checkOverdueAccounts error'); return; }
    if (!data || data.length === 0) return;

    var grouped = {};
    for (var row of data) {
      var days = Math.floor((Date.now() - new Date(row.due_date).getTime()) / 86400000);
      grouped[row.tenant_id] = grouped[row.tenant_id] || [];
      grouped[row.tenant_id].push({ ...row, days_overdue: days });
    }
    var sendPush = getPush();
    for (var [tenantId, accounts] of Object.entries(grouped)) {
      logger.warn({ tenant_id: tenantId, count: accounts.length }, '[CRON] Cuentas vencidas detectadas');
      if (sendPush) sendPush(tenantId, { title: '💳 Cuentas por cobrar vencidas', body: accounts.length + ' cuenta(s) pendiente(s) de cobro', url: '/accounts' });
    }
  } catch (err) {
    logger.error({ err }, '[CRON] checkOverdueAccounts exception');
  }
}

// Garantías: aviso 7 días antes de vencer y el día que vencen
async function checkExpiringWarranties() {
  try {
    var today = new Date();
    var in7 = new Date(today.getTime() + 7 * 86400000).toISOString().split('T')[0];
    var todayStr = today.toISOString().split('T')[0];

    var { data, error } = await supabase
      .from('warranties')
      .select('id, client, description, end_date, tenant_id')
      .eq('status', 'vigente')
      .lte('end_date', in7)
      .gte('end_date', todayStr);
    if (error) { logger.error({ err: error }, '[CRON] checkExpiringWarranties error'); return; }
    if (!data || data.length === 0) return;

    var grouped = {};
    for (var row of data) {
      var daysLeft = Math.ceil((new Date(row.end_date).getTime() - today.getTime()) / 86400000);
      grouped[row.tenant_id] = grouped[row.tenant_id] || [];
      grouped[row.tenant_id].push({ ...row, days_left: daysLeft });
    }
    var sendPushW = getPush();
    for (var [tenantId, warranties] of Object.entries(grouped)) {
      logger.info({ tenant_id: tenantId, count: warranties.length }, '[CRON] Garantías próximas a vencer');
      if (sendPushW) sendPushW(tenantId, { title: '🛡️ Garantías próximas a vencer', body: warranties.length + ' garantía(s) vencen en los próximos 7 días', url: '/warranties' });
    }
  } catch (err) {
    logger.error({ err }, '[CRON] checkExpiringWarranties exception');
  }
}

// Reparaciones: alertar si llevan más de 30 días sin actualización
async function checkStalledRepairs() {
  try {
    var cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    var { data, error } = await supabase
      .from('repairs')
      .select('id, client, device, status, updated_at, tenant_id')
      .in('status', ['recibido', 'en_proceso'])
      .lt('updated_at', cutoff);
    if (error) { logger.error({ err: error }, '[CRON] checkStalledRepairs error'); return; }
    if (!data || data.length === 0) return;

    var grouped = {};
    for (var row of data) {
      grouped[row.tenant_id] = grouped[row.tenant_id] || [];
      grouped[row.tenant_id].push(row);
    }
    var sendPushR = getPush();
    for (var [tenantId, repairs] of Object.entries(grouped)) {
      logger.warn({ tenant_id: tenantId, count: repairs.length }, '[CRON] Reparaciones sin movimiento >30 días');
      if (sendPushR) sendPushR(tenantId, { title: '🔧 Reparaciones sin movimiento', body: repairs.length + ' reparación(es) llevan más de 30 días sin actualizar', url: '/repairs' });
    }
  } catch (err) {
    logger.error({ err }, '[CRON] checkStalledRepairs exception');
  }
}

function startCronJobs() {
  // Cada día a las 8:00 AM — cuentas vencidas
  cron.schedule('0 8 * * *', () => {
    logger.info('[CRON] Revisando cuentas por cobrar vencidas...');
    checkOverdueAccounts();
  }, { timezone: 'America/Guatemala' });

  // Cada día a las 8:05 AM — garantías por vencer
  cron.schedule('5 8 * * *', () => {
    logger.info('[CRON] Revisando garantías próximas a vencer...');
    checkExpiringWarranties();
  }, { timezone: 'America/Guatemala' });

  // Cada lunes a las 9:00 AM — reparaciones estancadas
  cron.schedule('0 9 * * 1', () => {
    logger.info('[CRON] Revisando reparaciones sin movimiento...');
    checkStalledRepairs();
  }, { timezone: 'America/Guatemala' });

  logger.info('[CRON] Jobs de recordatorios iniciados (Guatemala timezone)');
}

module.exports = {
  startCronJobs,
  // Exportar para tests
  checkOverdueAccounts,
  checkExpiringWarranties,
  checkStalledRepairs,
};
