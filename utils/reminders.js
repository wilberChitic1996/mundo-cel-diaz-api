const cron = require('node-cron');
const supabase = require('../supabase');
const logger = require('./logger');
const { createTenantBackup } = require('./backup');

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

// Backup automático: snapshot diario de todos los tenants activos
async function createBackupsForAllTenants() {
  try {
    var { data, error } = await supabase.from('tenants').select('id');
    if (error) { logger.error({ err: error }, '[CRON] Error obteniendo tenants para backup'); return; }
    if (!data || data.length === 0) { logger.info('[CRON] Sin tenants para respaldar'); return; }

    logger.info({ count: data.length }, '[CRON] Iniciando backups automáticos');
    for (var i = 0; i < data.length; i++) {
      var tenantId = data[i].id;
      try {
        var result = await createTenantBackup(tenantId, 'auto');
        logger.info({ tenant_id: tenantId, status: result.status }, '[CRON] Backup automático completado');
      } catch (err) {
        logger.error({ err, tenant_id: tenantId }, '[CRON] Error en backup automático del tenant');
      }
    }
    logger.info('[CRON] Backups automáticos finalizados');
  } catch (err) {
    logger.error({ err }, '[CRON] createBackupsForAllTenants exception');
  }
}

// Almacenamiento: alerta si audit_logs > 100 000 o total registros > 500 000
async function checkStorageAlert() {
  try {
    var TABLES = ['clients', 'products', 'sales', 'sale_items', 'audit_logs', 'repairs', 'warranties', 'accounts'];
    var counts = await Promise.all(
      TABLES.map(function(t) {
        return supabase.from(t).select('*', { count: 'exact', head: true }).then(function(r) { return { table: t, count: r.count || 0 }; });
      })
    );
    var total = counts.reduce(function(s, r) { return s + r.count; }, 0);
    var auditCount = (counts.find(function(r) { return r.table === 'audit_logs'; }) || {}).count || 0;

    logger.info({ total, audit_logs: auditCount }, '[CRON] checkStorageAlert');

    if (total >= 500000 || auditCount >= 100000) {
      var sendPush = getPush();
      if (!sendPush) return;

      var msg = {
        title: '⚠️ Almacenamiento: revisar',
        body: 'El sistema tiene ' + total.toLocaleString() + ' registros totales (audit_logs: ' + auditCount.toLocaleString() + '). Considera limpiar logs antiguos o actualizar el plan de Supabase.',
        url: '/admin',
      };

      // Notificar a superadmins con suscripción push
      var { data: superadmins } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('role', 'superadmin')
        .eq('active', true);

      var tenantIds = [...new Set((superadmins || []).map(function(u) { return u.tenant_id; }).filter(Boolean))];
      for (var tid of tenantIds) {
        sendPush(tid, msg);
      }
      // Superadmin sin tenant_id (global)
      sendPush(null, msg);

      logger.warn({ total, audit_logs: auditCount }, '[CRON] Alerta de almacenamiento enviada');
    }
  } catch (err) {
    logger.error({ err }, '[CRON] checkStorageAlert exception');
  }
}

// Limpieza mensual: eliminar audit_logs con más de 180 días
async function cleanOldAuditLogs() {
  try {
    var cutoff = new Date(Date.now() - 180 * 86400000).toISOString();

    var { count: toDelete } = await supabase
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .lt('created_at', cutoff);

    if (!toDelete || toDelete === 0) {
      logger.info('[CRON] cleanOldAuditLogs: no hay registros antiguos para eliminar');
      return;
    }

    var { error } = await supabase
      .from('audit_logs')
      .delete()
      .lt('created_at', cutoff);

    if (error) {
      logger.error({ err: error }, '[CRON] cleanOldAuditLogs error al eliminar');
      return;
    }

    logger.info({ deleted: toDelete, cutoff }, '[CRON] cleanOldAuditLogs: registros eliminados');
  } catch (err) {
    logger.error({ err }, '[CRON] cleanOldAuditLogs exception');
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

  // Cada lunes a las 9:05 AM — alerta de almacenamiento
  cron.schedule('5 9 * * 1', () => {
    logger.info('[CRON] Revisando uso de almacenamiento...');
    checkStorageAlert();
  }, { timezone: 'America/Guatemala' });

  // El 1° de cada mes a las 3:00 AM — limpiar audit_logs > 180 días
  cron.schedule('0 3 1 * *', () => {
    logger.info('[CRON] Limpiando audit_logs antiguos (>180 días)...');
    cleanOldAuditLogs();
  }, { timezone: 'America/Guatemala' });

  // Cada día a las 2:00 AM — backup automático por tenant
  cron.schedule('0 2 * * *', function() {
    logger.info('[CRON] Iniciando backups automáticos diarios...');
    createBackupsForAllTenants();
  }, { timezone: 'America/Guatemala' });

  logger.info('[CRON] Jobs de recordatorios iniciados (Guatemala timezone)');
}

module.exports = {
  startCronJobs,
  // Exportar para tests
  checkOverdueAccounts,
  checkExpiringWarranties,
  checkStalledRepairs,
  checkStorageAlert,
  cleanOldAuditLogs,
  createBackupsForAllTenants,
};
