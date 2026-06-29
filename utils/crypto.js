// utils/crypto.js
// Cifrado simétrico de campos sensibles en reposo (p.ej. DPI). AES-256-GCM.
//
// - La clave viene de la env ENCRYPTION_KEY (cualquier longitud; se deriva a 32 bytes).
// - SIN clave configurada → las funciones son passthrough (comportamiento actual): así
//   desplegar este código NO rompe nada; el cifrado se "activa" al configurar la env.
// - Prefijo de marca 'enc:v1:' → permite convivencia de datos legacy en texto plano con
//   datos nuevos cifrados (decryptField devuelve el texto plano tal cual si no hay marca).
const crypto = require('crypto');

const PREFIX = 'enc:v1:';
const ALGO   = 'aes-256-gcm';

function getKey() {
  var raw = process.env.ENCRYPTION_KEY;
  if (!raw) return null;
  return crypto.createHash('sha256').update(String(raw)).digest(); // 32 bytes determinísticos
}

function encryptField(plain) {
  if (plain === null || plain === undefined || plain === '') return plain;
  var key = getKey();
  if (!key) return plain; // sin clave → passthrough
  var iv = crypto.randomBytes(12);
  var cipher = crypto.createCipheriv(ALGO, key, iv);
  var enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  var tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptField(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value; // legacy/plano o no-string
  var key = getKey();
  if (!key) return value; // no se puede descifrar sin clave
  try {
    var raw  = Buffer.from(value.slice(PREFIX.length), 'base64');
    var iv   = raw.subarray(0, 12);
    var tag  = raw.subarray(12, 28);
    var data = raw.subarray(28);
    var decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null; // clave incorrecta o dato corrupto → no exponer
  }
}

function isEncryptionEnabled() { return !!process.env.ENCRYPTION_KEY; }

module.exports = { encryptField, decryptField, isEncryptionEnabled };
