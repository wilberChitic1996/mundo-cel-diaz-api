import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Supabase no debe ser llamado en los caminos de validación que probamos aquí.
vi.mock('../supabase', () => ({
  default: { from: () => { throw new Error('Supabase should not be called in this test'); } },
}));

vi.mock('../middleware/rateLimit', () => ({
  loginLimiter:    (_req, _res, next) => next(),
  recoveryLimiter: (_req, _res, next) => next(),
  generalLimiter:  (_req, _res, next) => next(),
}));

import app from '../app.js';

describe('POST /api/auth/refresh — validación', () => {
  it('devuelve 400 cuando no se envía refreshToken', async () => {
    const res = await request(app).post('/api/auth/refresh').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/refresh token/i);
  });

  it('devuelve 400 con body vacío', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(400);
  });

  it('también responde en la ruta versionada /api/v1/', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/refresh token/i);
  });
});

describe('POST /api/auth/logout — es idempotente', () => {
  it('devuelve 200 ok aunque no se envíe refreshToken (sin tocar la BD)', async () => {
    const res = await request(app).post('/api/auth/logout').send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('también responde en la ruta versionada /api/v1/', async () => {
    const res = await request(app).post('/api/v1/auth/logout').send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
