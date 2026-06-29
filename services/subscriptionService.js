// services/subscriptionService.js
// Renovación de suscripción de un tenant. Es el corazón del "vagón" de cobro: cuando llega un
// pago confirmado (vía webhook de la pasarela), se extiende la vigencia del tenant.
//
// Se ata DIRECTO a lo que ya hace cumplir B2: enforceSubscription lee tenants.active/expires_at
// con caché 'sub:<tenantId>'. Por eso, tras renovar, se INVALIDA esa caché para que el próximo
// request vea la nueva fecha de inmediato.
const supabase = require('../supabase');
const cache    = require('../utils/cache');
const logger   = require('../utils/logger');

// Extiende la suscripción: active=true y expires_at += durationDays (desde hoy, o desde el
// vencimiento vigente si aún es futuro, para no "perder" días al renovar antes de tiempo).
async function renewSubscription(tenantId, durationDays, meta) {
  durationDays = Number(durationDays) || 30;
  var { data: t } = await supabase.from('tenants').select('expires_at').eq('id', tenantId).single();
  var base = new Date();
  if (t && t.expires_at && new Date(t.expires_at).getTime() > Date.now()) base = new Date(t.expires_at);
  base.setDate(base.getDate() + durationDays);
  var newExpires = base.toISOString();

  var { error } = await supabase.from('tenants')
    .update({ active: true, expires_at: newExpires, updated_at: new Date().toISOString() })
    .eq('id', tenantId);
  if (error) throw new Error('No se pudo renovar la suscripción: ' + error.message);

  await cache.del('sub:' + tenantId); // crítico: enforceSubscription debe leer la fecha nueva
  logger.info({ tenantId: tenantId, newExpires: newExpires, meta: meta || null }, '[BILLING] suscripción renovada');
  return newExpires;
}

module.exports = { renewSubscription };
