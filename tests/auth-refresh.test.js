/**
 * Tests de integración para POST /api/auth/refresh
 *
 * Estrategia: los módulos de rutas son CJS y capturan `require('../supabase')` en cache.
 * Para interceptar las llamadas reales a supabase, usamos createRequire para obtener
 * el mismo objeto CJS y reemplazamos `from` directamente antes de cada test.
 *
 * Los tests de validación de input (400) no tocan supabase, así que son más simples.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';
import crypto from 'crypto';

// ── Mocks que no llegan a supabase ────────────────────────────────────────────
vi.mock('../middleware/rateLimit', () => ({
  loginLimiter:    (_req, _res, next) => next(),
  recoveryLimiter: (_req, _res, next) => next(),
  generalLimiter:  (_req, _res, next) => next(),
}));

vi.mock('../utils/audit', () => ({ default: vi.fn() }));
vi.mock('node-cron', () => ({ schedule: vi.fn() }));

import app from '../app.js';

// ── CJS interop para supabase ─────────────────────────────────────────────────
// Obtenemos el mismo objeto que routes/auth.js tiene en su require cache
const cjsRequire = createRequire(import.meta.url);
const supabase   = cjsRequire('../supabase.js');
const origFrom   = supabase.from.bind(supabase);

// ── Helpers ───────────────────────────────────────────────────────────────────

const REFRESH_TOKEN = 'a-valid-refresh-token-string-for-testing';

const fakeUser = {
  id:        'user-uuid-001',
  name:      'Administrador Test',
  email:     'admin@test.com',
  role:      'admin',
  tenant_id: 'tenant-uuid-001',
  active:    true,
};

const validRow = {
  id:         'row-uuid-001',
  token_hash: crypto.createHash('sha256').update(REFRESH_TOKEN).digest('hex'),
  user_id:    fakeUser.id,
  tenant_id:  fakeUser.tenant_id,
  expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
  revoked_at: null,
  users:      fakeUser,
};

/**
 * Construye una cadena fluent de supabase que resuelve { data, error } al hacer await.
 * Soporta .select().eq().is().gt().single() y .update().eq() y .insert()
 */
function makeSelectChain(data, error = null) {
  const result = { data, error };
  const chain = {
    select: () => chain,
    eq:     () => chain,
    is:     () => chain,
    gt:     () => chain,
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    insert: () => Promise.resolve({ error: null }),
    single: () => Promise.resolve(result),
    // Thenable fallback
    then:   (res, rej) => Promise.resolve(result).then(res, rej),
    catch:  (fn) => Promise.resolve(result).catch(fn),
    finally: (fn) => Promise.resolve(result).finally(fn),
  };
  return chain;
}

afterEach(() => {
  supabase.from = origFrom;
});

// ── Tests: validación de input (no tocan supabase) ────────────────────────────

describe('POST /api/auth/refresh — validación de input', () => {
  it('devuelve 400 cuando no se envía refreshToken', async () => {
    const res = await request(app).post('/api/auth/refresh').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/refresh token/i);
  });

  it('devuelve 400 con body completamente vacío', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(400);
  });

  it('también responde en la ruta versionada /api/v1/auth/refresh', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/refresh token/i);
  });
});

// ── Tests: token inválido ─────────────────────────────────────────────────────

describe('POST /api/auth/refresh — token inválido o expirado', () => {
  beforeEach(() => {
    // Por defecto: token no encontrado en BD
    supabase.from = () => makeSelectChain(null, { message: 'No rows found' });
  });

  it('devuelve 401 cuando el token no existe en BD (error de supabase)', async () => {
    supabase.from = () => makeSelectChain(null, { message: 'No rows found' });
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'invalid-token-xyz' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/inválido|expirado/i);
  });

  it('devuelve 401 cuando supabase no encuentra fila (data null, sin error)', async () => {
    supabase.from = () => makeSelectChain(null, null);
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'nonexistent-token' });
    expect(res.status).toBe(401);
  });

  it('devuelve 401 cuando el usuario asociado está inactivo', async () => {
    supabase.from = () => makeSelectChain(
      { ...validRow, users: { ...fakeUser, active: false } },
      null
    );
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: REFRESH_TOKEN });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/inactivo/i);
  });
});

// ── Tests: token válido rota ──────────────────────────────────────────────────

describe('POST /api/auth/refresh — token válido rota correctamente', () => {
  beforeEach(() => {
    // Simular: SELECT devuelve validRow, UPDATE y INSERT resuelven sin error
    supabase.from = (table) => {
      if (table === 'refresh_tokens') {
        return makeSelectChain(validRow, null);
      }
      return makeSelectChain(null, null);
    };
  });

  it('devuelve 200 con nuevo JWT y nuevo refreshToken', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: REFRESH_TOKEN });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('refreshToken');
    expect(typeof res.body.token).toBe('string');
    expect(typeof res.body.refreshToken).toBe('string');
    expect(res.body.refreshToken).not.toBe(REFRESH_TOKEN);
  });

  it('el nuevo JWT contiene los datos del usuario', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: REFRESH_TOKEN });

    expect(res.status).toBe(200);
    const jwt = (await import('jsonwebtoken')).default;
    const decoded = jwt.verify(res.body.token, 'test-secret-key');
    expect(decoded.userId).toBe(fakeUser.id);
    expect(decoded.role).toBe(fakeUser.role);
    expect(decoded.tenant_id).toBe(fakeUser.tenant_id);
  });

  it('también rota en la ruta versionada /api/v1/auth/refresh', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: REFRESH_TOKEN });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('refreshToken');
  });
});
