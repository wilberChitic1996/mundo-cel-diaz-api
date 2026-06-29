// scripts/reencrypt-dpi.js
// Re-cifra los DPI existentes en texto plano (A13). Idempotente: salta los que ya
// están cifrados (prefijo 'enc:v1:'). Úsalo UNA vez tras configurar ENCRYPTION_KEY.
//
// Uso (con las mismas env del API: SUPABASE_URL, SUPABASE_KEY, ENCRYPTION_KEY):
//   ENCRYPTION_KEY="<clave>" node scripts/reencrypt-dpi.js
//
// Recomendado: hacer respaldo de la tabla clients antes de correrlo.
const supabase = require('../supabase');
const { encryptField, isEncryptionEnabled } = require('../utils/crypto');

async function main() {
  if (!isEncryptionEnabled()) {
    console.error('ERROR: ENCRYPTION_KEY no está configurada. Abortando para no guardar texto plano.');
    process.exit(1);
  }
  var { data, error } = await supabase.from('clients').select('id, dpi');
  if (error) { console.error('Error leyendo clients:', error.message); process.exit(1); }

  var pendientes = (data || []).filter(function (c) {
    return c.dpi && typeof c.dpi === 'string' && !c.dpi.startsWith('enc:v1:');
  });
  console.log('Clientes con DPI en texto plano a cifrar: ' + pendientes.length);

  var ok = 0, fail = 0;
  for (var c of pendientes) {
    var { error: upErr } = await supabase.from('clients').update({ dpi: encryptField(c.dpi) }).eq('id', c.id);
    if (upErr) { fail++; console.error('  ✗ ' + c.id + ': ' + upErr.message); }
    else { ok++; }
  }
  console.log('Listo. Cifrados: ' + ok + ' · Errores: ' + fail);
  process.exit(fail ? 1 : 0);
}

main();
