import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// La BD no debe tocarse: auth/requireRole rechazan antes que el handler (determinista, sin red).
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

// Las ventas mueven dinero e inventario: deben exigir JWT siempre.
describe('Ventas — protección de autenticación', () => {
  it('GET /api/sales devuelve 401 sin token', async () => {
    const res = await request(app).get('/api/sales');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/token/i);
  });

  it('POST /api/sales devuelve 401 sin token', async () => {
    const res = await request(app).post('/api/sales').send({ client: 'X', total: 100, items: [] });
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/sales (ruta versionada) también exige token', async () => {
    const res = await request(app).get('/api/v1/sales');
    expect(res.status).toBe(401);
  });
});

// A8: crear venta es escritura (admin/cajero); el auditor de solo-lectura no puede.
// requireRole rechaza antes de tocar la BD, así que es determinista sin red.
describe('Ventas — RBAC en creación', () => {
  it('POST /api/sales como auditor → 403', async () => {
    const auditorToken = token({ userId: 'aud-1', role: 'auditor', tenant_id: 'tenant-aaa' });
    const res = await request(app).post('/api/sales').set('Authorization', `Bearer ${auditorToken}`).send({ client: 'X', total: 100, items: [] });
    expect(res.status).toBe(403);
  });
});
