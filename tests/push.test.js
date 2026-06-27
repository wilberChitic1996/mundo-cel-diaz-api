/**
 * Tests de integración para /api/push/*
 * Cubre: GET vapid-public-key (sin auth), POST subscribe (con auth), DELETE subscribe (con auth).
 *
 * Estrategia: routes/push.js es CJS y captura `require('../supabase')` en cache.
 * Usamos createRequire para obtener el mismo objeto y reemplazar `from` directamente.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// ── Mocks de middleware ───────────────────────────────────────────────────────
vi.mock('../middleware/rateLimit', () => ({
  loginLimiter:    (_req, _res, next) => next(),
  recoveryLimiter: (_req, _res, next) => next(),
  generalLimiter:  (_req, _res, next) => next(),
}));

vi.mock('../utils/audit', () => ({ default: vi.fn() }));
vi.mock('node-cron', () => ({ schedule: vi.fn() }));

import app from '../app.js';

// ── CJS interop para supabase ─────────────────────────────────────────────────
const cjsRequire = createRequire(import.meta.url);
const supabase   = cjsRequire('../supabase.js');
const origFrom   = supabase.from.bind(supabase);

// ── Helpers ───────────────────────────────────────────────────────────────────

const TENANT = 'tenant-push-test';

function makeToken(role = 'admin') {
  return jwt.sign(
    { userId: 'user-push-1', name: 'Test User', role, tenant_id: TENANT },
    'test-secret-key',
    { expiresIn: '1h' },
  );
}

const adminToken = makeToken('admin');

/**
 * Cadena fluent para upsert/delete de push_subscriptions.
 */
function makeChain(error = null) {
  return {
    upsert: () => Promise.resolve({ error }),
    delete: () => ({
      eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  };
}

afterEach(() => {
  supabase.from = origFrom;
});

// ── GET /api/push/vapid-public-key ────────────────────────────────────────────

describe('GET /api/push/vapid-public-key — sin auth', () => {
  it('devuelve 200 con key vacía cuando VAPID_PUBLIC_KEY no está configurada', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    const res = await request(app).get('/api/push/vapid-public-key');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('key');
    expect(typeof res.body.key).toBe('string');
  });

  it('devuelve la clave cuando VAPID_PUBLIC_KEY está en env', async () => {
    process.env.VAPID_PUBLIC_KEY = 'test-vapid-public-key-abc';
    const res = await request(app).get('/api/push/vapid-public-key');
    expect(res.status).toBe(200);
    expect(res.body.key).toBe('test-vapid-public-key-abc');
    delete process.env.VAPID_PUBLIC_KEY;
  });

  it('no requiere Authorization header', async () => {
    const res = await request(app).get('/api/push/vapid-public-key');
    expect(res.status).toBe(200);
  });
});

// ── POST /api/push/subscribe ──────────────────────────────────────────────────

describe('POST /api/push/subscribe — requiere auth', () => {
  it('devuelve 401 sin token', async () => {
    const res = await request(app)
      .post('/api/push/subscribe')
      .send({ endpoint: 'https://fcm.example.com/sub', keys: { p256dh: 'key', auth: 'auth' } });
    expect(res.status).toBe(401);
  });

  it('devuelve 400 cuando falta endpoint en body', async () => {
    const res = await request(app)
      .post('/api/push/subscribe')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/suscripción inválida/i);
  });

  it('devuelve 200 ok con suscripción válida', async () => {
    supabase.from = () => makeChain(null);
    const res = await request(app)
      .post('/api/push/subscribe')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        keys: { p256dh: 'public-key', auth: 'auth-secret' },
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('devuelve 500 cuando supabase devuelve error', async () => {
    supabase.from = () => makeChain({ message: 'DB error' });
    const res = await request(app)
      .post('/api/push/subscribe')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ endpoint: 'https://fcm.example.com/sub', keys: { p256dh: 'k', auth: 'a' } });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/error interno/i);
  });
});

// ── DELETE /api/push/subscribe ────────────────────────────────────────────────

describe('DELETE /api/push/subscribe — requiere auth', () => {
  it('devuelve 401 sin token', async () => {
    const res = await request(app)
      .delete('/api/push/subscribe')
      .send({ endpoint: 'https://fcm.example.com/sub' });
    expect(res.status).toBe(401);
  });

  it('devuelve 400 cuando no se envía endpoint', async () => {
    const res = await request(app)
      .delete('/api/push/subscribe')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/endpoint requerido/i);
  });

  it('devuelve 200 ok al eliminar suscripción válida', async () => {
    supabase.from = () => makeChain(null);
    const res = await request(app)
      .delete('/api/push/subscribe')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc123' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
