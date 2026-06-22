const supabase = require('../supabase');

async function logAudit(user, action, entityType, entityId, details) {
  try {
    await supabase.from('audit_logs').insert({
      user_id:     user.userId || null,
      user_name:   user.name   || null,
      user_role:   user.role   || null,
      action,
      entity_type: entityType || null,
      entity_id:   entityId   ? String(entityId) : null,
      details:     details    || null
    });
  } catch (e) {
    console.error('[AUDIT] Error logging:', e.message);
  }
}

module.exports = logAudit;
