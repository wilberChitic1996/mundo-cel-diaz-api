// routes/backup.js — Endpoints de backup enterprise por tenant
const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../supabase');
const logger   = require('../utils/logger');
const { withTenant, tid } = require('../utils/tenant');
const { createTenantBackup, getBackupDownloadUrl } = require('../utils/backup');

// GET /api/backup/health — estado del último backup + timestamp último éxito
router.get('/health', auth, async function(req, res) {
  var tenantId = tid(req);
  if (!tenantId) return res.status(403).json({ error: 'Tenant requerido' });

  try {
    // Último backup exitoso
    var successRes = await supabase
      .from('backups')
      .select('id, created_at, size_bytes, storage_path')
      .eq('tenant_id', tenantId)
      .eq('status', 'success')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Último backup (cualquier estado)
    var lastRes = await supabase
      .from('backups')
      .select('id, created_at, status, error_msg')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    res.json({
      last_success: successRes.data || null,
      last_backup:  lastRes.data || null,
    });
  } catch (err) {
    logger.error({ err, tenant_id: tenantId }, '[BACKUP] Error en health check');
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/backup — listar últimos 30 backups del tenant
router.get('/', auth, async function(req, res) {
  var tenantId = tid(req);
  if (!tenantId) return res.status(403).json({ error: 'Tenant requerido' });

  try {
    var { data, error } = await supabase
      .from('backups')
      .select('id, created_at, size_bytes, status, type, storage_path, error_msg, tables_included, record_counts')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) {
      logger.error({ err: error, tenant_id: tenantId }, '[BACKUP] Error listando backups');
      return res.status(500).json({ error: 'Error interno' });
    }

    res.json({ backups: data || [] });
  } catch (err) {
    logger.error({ err, tenant_id: tenantId }, '[BACKUP] Error en GET /backup');
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/backup — disparar backup manual (admin+)
router.post('/', auth, async function(req, res) {
  var tenantId = tid(req);
  if (!tenantId) return res.status(403).json({ error: 'Tenant requerido' });

  var role = req.user && req.user.role;
  if (role !== 'admin' && role !== 'superadmin') {
    return res.status(403).json({ error: 'Se requiere rol admin o superior' });
  }

  try {
    logger.info({ tenant_id: tenantId, user: req.user.userId }, '[BACKUP] Backup manual iniciado');
    var record = await createTenantBackup(tenantId, 'manual');
    res.json({ backup: record });
  } catch (err) {
    logger.error({ err, tenant_id: tenantId }, '[BACKUP] Error en POST /backup');
    res.status(500).json({ error: 'Error al crear backup' });
  }
});

// GET /api/backup/:id/download — URL firmada para descargar
router.get('/:id/download', auth, async function(req, res) {
  var tenantId = tid(req);
  if (!tenantId) return res.status(403).json({ error: 'Tenant requerido' });

  try {
    // Verificar que el backup pertenece al tenant
    var { data, error } = await supabase
      .from('backups')
      .select('id, storage_path, status')
      .eq('id', req.params.id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error || !data) return res.status(404).json({ error: 'Backup no encontrado' });
    if (data.status !== 'success') return res.status(400).json({ error: 'Backup no disponible para descarga' });
    if (!data.storage_path) return res.status(400).json({ error: 'Sin archivo de almacenamiento' });

    var signedUrl = await getBackupDownloadUrl(data.storage_path);
    res.json({ url: signedUrl });
  } catch (err) {
    logger.error({ err, tenant_id: tenantId, backup_id: req.params.id }, '[BACKUP] Error generando download URL');
    res.status(500).json({ error: 'Error al generar enlace de descarga' });
  }
});

// GET /api/backup/:id/data — devuelve el JSON del backup directamente (evita CORS de Storage)
router.get('/:id/data', auth, async function(req, res) {
  var tenantId = tid(req);
  if (!tenantId) return res.status(403).json({ error: 'Tenant requerido' });

  try {
    var { data, error } = await supabase
      .from('backups')
      .select('id, storage_path, status')
      .eq('id', req.params.id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error || !data) return res.status(404).json({ error: 'Backup no encontrado' });
    if (data.status !== 'success') return res.status(400).json({ error: 'Backup no disponible' });
    if (!data.storage_path) return res.status(400).json({ error: 'Sin archivo de almacenamiento' });

    var downloadRes = await supabase.storage.from('backups').download(data.storage_path);
    if (downloadRes.error) return res.status(500).json({ error: 'Error leyendo archivo de backup' });

    var text = await downloadRes.data.text();
    var parsed = JSON.parse(text);
    res.json(parsed);
  } catch (err) {
    logger.error({ err, tenant_id: tenantId, backup_id: req.params.id }, '[BACKUP] Error sirviendo datos de backup');
    res.status(500).json({ error: 'Error al obtener datos del backup' });
  }
});

module.exports = router;
