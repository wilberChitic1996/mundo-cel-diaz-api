// scripts/restore-tenant.js — F2: Restauración de un backup de tenant (Disaster Recovery)
//
// Lee un snapshot JSON (el que genera utils/backup.js → createTenantBackup) y reescribe
// los datos de ESE tenant en la BD a la que apunten las env (SUPABASE_URL/SUPABASE_KEY).
// Es un script MANUAL para un operador — NO está conectado a ninguna ruta del API.
//
// Seguridad:
//   • Modo SIMULACIÓN por defecto: solo muestra qué haría. Hay que pasar --commit para escribir.
//   • Tenant-scoped: el tenant del archivo debe coincidir con --tenant (si no, aborta).
//   • Guarda de producción: si la BD destino es la de producción, exige --prod para continuar.
//   • Upsert idempotente por `id`: correrlo dos veces deja el mismo estado (no duplica).
//   • NO restaura `users` (el backup no guarda password_hash → crearía logins rotos).
//     Los usuarios se recrean a mano tras el restore (ver docs/DISASTER-RECOVERY.md).
//
// Uso:
//   # 1) desde un archivo local descargado del panel de Backups:
//   SUPABASE_URL=... SUPABASE_KEY=... node scripts/restore-tenant.js --tenant <UUID> --file backup.json
//   # 2) desde un backup ya en Storage (por su storage_path):
//   SUPABASE_URL=... SUPABASE_KEY=... node scripts/restore-tenant.js --tenant <UUID> --path <tenant>/<archivo>.json
//   # agregar --commit para aplicar de verdad; --prod si la BD destino es producción.

const fs = require('fs');
const supabase = require('../supabase');
const { getBackupData } = require('../utils/backup');

// Orden FK-safe (padres → hijos). Solo las tablas que incluye el backup.
// users se omite a propósito (sin password_hash).
var RESTORE_ORDER = [
  'categories',
  'locations',
  'suppliers',
  'clients',
  'store_settings',
  'products',
  'sales',
  'sale_items',
  'accounts',
  'returns',
  'defectives',
  'repairs',
  'warranties',
];

// Project ref de la BD de PRODUCCIÓN (para la guarda --prod). Ver CLAUDE.md.
var PROD_REF = 'rhecnmfivygkayfvauxt';

function parseArgs(argv) {
  var args = { commit: false, prod: false };
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--commit') args.commit = true;
    else if (a === '--prod') args.prod = true;
    else if (a === '--tenant') args.tenant = argv[++i];
    else if (a === '--file') args.file = argv[++i];
    else if (a === '--path') args.path = argv[++i];
  }
  return args;
}

async function loadPayload(args) {
  if (args.file) {
    var text = fs.readFileSync(args.file, 'utf8');
    return JSON.parse(text);
  }
  if (args.path) {
    return await getBackupData(args.path);
  }
  throw new Error('Falta --file <archivo.json> o --path <storage_path>.');
}

async function main() {
  var args = parseArgs(process.argv);

  if (!args.tenant) { console.error('ERROR: falta --tenant <UUID>.'); process.exit(1); }
  if (!args.file && !args.path) { console.error('ERROR: falta --file o --path.'); process.exit(1); }

  // Guarda de producción: si las env apuntan a la BD de prod, exigir --prod explícito.
  var dbUrl = process.env.SUPABASE_URL || '';
  var isProd = dbUrl.indexOf(PROD_REF) >= 0;
  if (isProd && !args.prod) {
    console.error('ERROR: la BD destino parece ser PRODUCCIÓN (' + PROD_REF + ').');
    console.error('       Si es intencional, repetí el comando agregando --prod.');
    process.exit(1);
  }

  console.log('— Restore de tenant —');
  console.log('  BD destino : ' + (isProd ? 'PRODUCCIÓN' : dbUrl.replace(/^https?:\/\//, '').split('.')[0]));
  console.log('  Tenant     : ' + args.tenant);
  console.log('  Origen     : ' + (args.file ? ('archivo ' + args.file) : ('storage ' + args.path)));
  console.log('  Modo       : ' + (args.commit ? '*** COMMIT (escribe) ***' : 'SIMULACIÓN (dry-run)'));
  console.log('');

  var payload = await loadPayload(args);

  // El backup debe ser del mismo tenant que se quiere restaurar.
  if (payload.tenant_id && payload.tenant_id !== args.tenant) {
    console.error('ERROR: el backup es del tenant ' + payload.tenant_id + ', no de ' + args.tenant + '. Abortando.');
    process.exit(1);
  }
  if (!payload.tables) { console.error('ERROR: el archivo no tiene la sección "tables".'); process.exit(1); }

  console.log('  Backup creado: ' + (payload.created_at || '¿?') + ' (version ' + (payload.version || '¿?') + ')');
  console.log('');

  var totalRows = 0, totalErr = 0;
  for (var t = 0; t < RESTORE_ORDER.length; t++) {
    var table = RESTORE_ORDER[t];
    var rows = payload.tables[table] || [];
    // Refuerzo multi-tenant: asegurar que cada fila lleva el tenant correcto.
    rows = rows.map(function (r) { return Object.assign({}, r, { tenant_id: args.tenant }); });

    if (rows.length === 0) { console.log('  · ' + table + ': 0 filas (omitido)'); continue; }
    totalRows += rows.length;

    if (!args.commit) {
      console.log('  · ' + table + ': restauraría ' + rows.length + ' fila(s)');
      continue;
    }

    var res = await supabase.from(table).upsert(rows, { onConflict: 'id' });
    if (res.error) {
      totalErr++;
      console.error('  ✗ ' + table + ': ' + res.error.message);
    } else {
      console.log('  ✓ ' + table + ': ' + rows.length + ' fila(s) restauradas');
    }
  }

  console.log('');
  if (!args.commit) {
    console.log('SIMULACIÓN completa. ' + totalRows + ' fila(s) en total. Repetí con --commit para aplicar.');
    process.exit(0);
  }
  console.log('RESTORE completo. ' + totalRows + ' fila(s), ' + totalErr + ' tabla(s) con error.');
  console.log('Recordá: los usuarios NO se restauran (sin contraseña). Recrealos a mano si hace falta.');
  process.exit(totalErr ? 1 : 0);
}

main().catch(function (err) {
  console.error('Fallo inesperado: ' + (err && err.message ? err.message : String(err)));
  process.exit(1);
});
