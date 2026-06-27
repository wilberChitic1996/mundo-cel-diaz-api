import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../supabase', () => ({
  default: { from: () => { throw new Error('Supabase should not be called in this test'); } },
}));

vi.mock('../middleware/rateLimit', () => ({
  loginLimiter:    (_req, _res, next) => next(),
  recoveryLimiter: (_req, _res, next) => next(),
  generalLimiter:  (_req, _res, next) => next(),
}));

import app from '../app.js';

// Las cuentas por cobrar manejan deuda de clientes: deben exigir JWT siempre.
describe('Cuentas por cobrar — protección de autenticación', () => {
  it('GET /api/accounts devuelve 401 sin token', async () => {
    const res = await request(app).get('/api/accounts');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/token/i);
  });

  it('POST /api/accounts devuelve 401 sin token', async () => {
    const res = await request(app).post('/api/accounts').send({ client: 'X', total: 100 });
    expect(res.status).toBe(401);
  });

  it('POST /api/accounts/:id/payments devuelve 401 sin token', async () => {
    const res = await request(app).post('/api/accounts/123/payments').send({ amount: 50 });
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/accounts (ruta versionada) también exige token', async () => {
    const res = await request(app).get('/api/v1/accounts');
    expect(res.status).toBe(401);
  });
});
