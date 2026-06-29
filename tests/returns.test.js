import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../supabase', () => ({
  default: {
    from: () => { throw new Error('Supabase should not be called in this test'); },
    rpc:  () => { throw new Error('Supabase should not be called in this test'); },
  },
}));

vi.mock('../middleware/rateLimit', () => ({
  loginLimiter:    (_req, _res, next) => next(),
  recoveryLimiter: (_req, _res, next) => next(),
  generalLimiter:  (_req, _res, next) => next(),
}));

import app from '../app.js';

function token(p) { return jwt.sign(p, 'test-secret-key', { expiresIn: '1h' }); }

// Las devoluciones reembolsan dinero y reingresan stock: exigen JWT siempre.
describe('Devoluciones — protección de autenticación', () => {
  it('GET /api/returns devuelve 401 sin token', async () => {
    const res = await request(app).get('/api/returns');
    expect(res.status).toBe(401);
  });

  it('POST /api/returns devuelve 401 sin token', async () => {
    const res = await request(app).post('/api/returns').send({ client: 'X', itemCondition: 'bueno', items: [] });
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/returns (ruta versionada) también exige token', async () => {
    const res = await request(app).get('/api/v1/returns');
    expect(res.status).toBe(401);
  });
});

// Procesar devolución es escritura (admin/cajero); auditor de solo-lectura no puede.
describe('Devoluciones — RBAC en creación', () => {
  it('POST /api/returns como auditor → 403', async () => {
    const auditorToken = token({ userId: 'aud-1', role: 'auditor', tenant_id: 'tenant-aaa' });
    const res = await request(app).post('/api/returns').set('Authorization', `Bearer ${auditorToken}`).send({ client: 'X', itemCondition: 'bueno', items: [] });
    expect(res.status).toBe(403);
  });
});
