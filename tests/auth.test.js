import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../supabase', () => ({
  default: { from: () => { throw new Error('Supabase should not be called in this test'); } },
}));

vi.mock('../middleware/rateLimit', () => ({
  loginLimiter:    (_req, _res, next) => next(),
  recoveryLimiter: (_req, _res, next) => next(),
}));

import app from '../app.js';

describe('GET /health', () => {
  it('returns ok status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.system).toMatch(/PraxisGT/i);
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/api/ruta-inexistente-xyz');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

describe('POST /api/auth/login — input validation', () => {
  it('returns 400 when body is empty', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requeridos/i);
  });

  it('returns 400 when only email is provided', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@test.com' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when only password is provided', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'mypassword' });
    expect(res.status).toBe(400);
  });
});

describe('Auth middleware — token validation', () => {
  it('returns 401 when no Authorization header', async () => {
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/token/i);
  });

  it('returns 401 when Authorization header has no bearer token', async () => {
    const res = await request(app)
      .get('/api/products')
      .set('Authorization', 'Bearer ');
    expect(res.status).toBe(401);
  });

  it('returns 401 when token is malformed', async () => {
    const res = await request(app)
      .get('/api/products')
      .set('Authorization', 'Bearer not.a.real.jwt.token');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/token/i);
  });

  it('returns 401 when token is signed with wrong secret', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const badToken = jwt.sign({ userId: '1', role: 'admin' }, 'wrong-secret');
    const res = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${badToken}`);
    expect(res.status).toBe(401);
  });
});
