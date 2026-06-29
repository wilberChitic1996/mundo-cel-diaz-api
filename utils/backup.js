// utils/backup.js — Snapshots de datos por tenant hacia Supabase Storage
const supabase = require('../supabase');
const logger   = require('./logger');

// Tablas a incluir en el backup y sus columnas (usuarios: sin contraseña)
var TABLES = [
  'clients',
  'products',
  'sales',
  'sale_items',
  'accounts',
  'repairs',
  'warranties',
  'returns',
  'defectives',
  'suppliers',
  'categories',
  'locations',
  'store_settings',
];

/**
 * Crea un snapshot completo del tenant y lo sube a Supabase Storage.
 * @param {string} tenantId — UUID del tenant
 * @param {'auto'|'manual'} type — tipo de backup
 * @returns {Promise<Object>} — registro de backup actualizado
 */
async function createTenantBackup(tenantId, type) {
  type = type || 'auto';

  // 1. Insertar registro pending
  var insertRes = await supabase.from('backups').insert({
    tenant_id: tenantId,
    status:    'pending',
    type:      type,
  }).select().single();

  if (insertRes.error) {
    logger.error({ err: insertRes.error, tenant_id: tenantId }, '[BACKUP] Error insertando registro pending');
    throw insertRes.error;
  }

  var record = insertRes.data;
  var backupId = record.id;

  try {
    // 2. Consultar cada tabla filtrando por tenant_id
    var tablesData = {};
    var recordCounts = {};

    for (var i = 0; i < TABLES.length; i++) {
      var tableName = TABLES[i];
      var q = supabase.from(tableName).select('*').eq('tenant_id', tenantId);
      var res = await q;
      if (res.error) {
        logger.warn({ err: res.error, table: tableName, tenant_id: tenantId }, '[BACKUP] Error consultando tabla');
        tablesData[tableName] = [];
        recordCounts[tableName] = 0;
      } else {
        tablesData[tableName] = res.data || [];
        recordCounts[tableName] = (res.data || []).length;
      }
    }

    // Usuarios: solo id, email, name, role, active — SIN password ni hash
    var usersRes = await supabase
      .from('users')
      .select('id, email, name, role, active, created_at')
      .eq('tenant_id', tenantId);
    if (usersRes.error) {
      logger.warn({ err: usersRes.error, tenant_id: tenantId }, '[BACKUP] Error consultando usuarios');
      tablesData['users'] = [];
      recordCounts['users'] = 0;
    } else {
      tablesData['users'] = usersRes.data || [];
      recordCounts['users'] = (usersRes.data || []).length;
    }

    // 3. Construir objeto JSON del backup
    var now = new Date();
    var backupPayload = {
      version:    '1.0',
      tenant_id:  tenantId,
      created_at: now.toISOString(),
      tables:     tablesData,
    };

    var jsonStr = JSON.stringify(backupPayload);
    var sizeBytes = Buffer.byteLength(jsonStr, 'utf8');

    // 4. Path en Storage: {tenantId}/{YYYY-MM-DD_HH-mm}.json
    var pad = function(n) { return String(n).padStart(2, '0'); };
    var datePart = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    var timePart = pad(now.getHours()) + '-' + pad(now.getMinutes());
    var storagePath = tenantId + '/' + datePart + '_' + timePart + '.json';

    var uploadRes = await supabase.storage
      .from('backups')
      .upload(storagePath, jsonStr, { contentType: 'application/json', upsert: true });

    if (uploadRes.error) {
      // Bucket puede no existir — loguear sin crashear
      logger.error({ err: uploadRes.error, tenant_id: tenantId, path: storagePath }, '[BACKUP] Error subiendo a Storage');
      throw uploadRes.error;
    }

    // 5. Actualizar registro como success
    var tablesIncluded = Object.keys(tablesData);
    var updateRes = await supabase.from('backups').update({
      status:          'success',
      size_bytes:      sizeBytes,
      storage_path:    storagePath,
      tables_included: tablesIncluded,
      record_counts:   recordCounts,
    }).eq('id', backupId).select().single();

    logger.info({ tenant_id: tenantId, backup_id: backupId, size_bytes: sizeBytes, path: storagePath }, '[BACKUP] Backup completado');
    return updateRes.data || record;

  } catch (err) {
    // 6. En error: marcar como failed
    var errMsg = err && err.message ? err.message : String(err);
    await supabase.from('backups').update({
      status:    'failed',
      error_msg: errMsg,
    }).eq('id', backupId);

    logger.error({ err, tenant_id: tenantId, backup_id: backupId }, '[BACKUP] Backup fallido');
    return Object.assign({}, record, { status: 'failed', error_msg: errMsg });
  }
}

/**
 * Devuelve una URL firmada (1 hora) para descargar un archivo de backup.
 * @param {string} storagePath — path dentro del bucket 'backups'
 * @returns {Promise<string>} — URL firmada
 */
async function getBackupDownloadUrl(storagePath) {
  var res = await supabase.storage.from('backups').createSignedUrl(storagePath, 3600);
  if (res.error) {
    logger.error({ err: res.error, path: storagePath }, '[BACKUP] Error generando signed URL');
    throw res.error;
  }
  return res.data.signedUrl;
}

/**
 * Descarga y parsea el contenido JSON de un backup desde Storage.
 * @param {string} storagePath — path dentro del bucket 'backups'
 * @returns {Promise<Object>} — payload { version, tenant_id, created_at, tables }
 */
async function getBackupData(storagePath) {
  var res = await supabase.storage.from('backups').download(storagePath);
  if (res.error) {
    logger.error({ err: res.error, path: storagePath }, '[BACKUP] Error descargando archivo');
    throw res.error;
  }
  var text = await res.data.text();
  return JSON.parse(text);
}

module.exports = { createTenantBackup, getBackupDownloadUrl, getBackupData };
