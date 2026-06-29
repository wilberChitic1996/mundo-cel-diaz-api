import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptField, decryptField, isEncryptionEnabled } from '../utils/crypto';

const KEY = 'clave-de-prueba-super-secreta-123';

describe('A13 — crypto sin clave (passthrough, comportamiento actual)', () => {
  beforeEach(() => { delete process.env.ENCRYPTION_KEY; });
  it('encryptField devuelve el texto tal cual', () => {
    expect(encryptField('1234567890101')).toBe('1234567890101');
  });
  it('decryptField devuelve el texto tal cual', () => {
    expect(decryptField('1234567890101')).toBe('1234567890101');
  });
  it('isEncryptionEnabled = false', () => {
    expect(isEncryptionEnabled()).toBe(false);
  });
});

describe('A13 — crypto con clave (AES-256-GCM)', () => {
  beforeEach(() => { process.env.ENCRYPTION_KEY = KEY; });
  afterEach(() => { delete process.env.ENCRYPTION_KEY; });

  it('round-trip: descifrar(cifrar(x)) === x', () => {
    const enc = encryptField('2987654321101');
    expect(enc).not.toBe('2987654321101');
    expect(enc.startsWith('enc:v1:')).toBe(true);
    expect(decryptField(enc)).toBe('2987654321101');
  });
  it('dos cifrados del mismo valor difieren (IV aleatorio)', () => {
    expect(encryptField('x')).not.toBe(encryptField('x'));
  });
  it('valores vacíos/null no se cifran', () => {
    expect(encryptField('')).toBe('');
    expect(encryptField(null)).toBe(null);
  });
  it('texto plano legacy (sin marca) se devuelve tal cual al descifrar', () => {
    expect(decryptField('1234567890101')).toBe('1234567890101');
  });
  it('clave incorrecta → null (no expone el dato)', () => {
    const enc = encryptField('secreto');
    process.env.ENCRYPTION_KEY = 'otra-clave-distinta';
    expect(decryptField(enc)).toBe(null);
  });
  it('isEncryptionEnabled = true', () => {
    expect(isEncryptionEnabled()).toBe(true);
  });
});
