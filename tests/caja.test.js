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

// La caja maneja efectivo y arqueos: exige JWT siempre.
describe('Caja — protección de autenticación', () => {
  it('GET /api/caja/sesiones devuelve 401 sin token', async () => {
    const res = await request(app).get('/api/caja/sesiones');
    expect(res.status).toBe(401);
  });

  it('POST /api/caja/abrir devuelve 401 sin token', async () => {
    const res = await request(app).post('/api/caja/abrir').send({ fondo_inicial: 100 });
    expect(res.status).toBe(401);
  });

  it('POST /api/caja/cerrar/:id devuelve 401 sin token', async () => {
    const res = await request(app).post('/api/caja/cerrar/abc').send({ efectivo_contado: 100 });
    expect(res.status).toBe(401);
  });

  it('POST /api/caja/gastos devuelve 401 sin token', async () => {
    const res = await request(app).post('/api/caja/gastos').send({ concepto: 'X', monto: 10 });
    expect(res.status).toBe(401);
  });
});

// Abrir/cerrar caja y registrar gastos son escrituras (admin/cajero); auditor no puede.
describe('Caja — RBAC en escrituras', () => {
  it('POST /api/caja/abrir como auditor → 403', async () => {
    const auditorToken = token({ userId: 'aud-1', role: 'auditor', tenant_id: 'tenant-aaa' });
    const res = await request(app).post('/api/caja/abrir').set('Authorization', `Bearer ${auditorToken}`).send({ fondo_inicial: 100 });
    expect(res.status).toBe(403);
  });

  it('POST /api/caja/cerrar/:id como auditor → 403', async () => {
    const auditorToken = token({ userId: 'aud-1', role: 'auditor', tenant_id: 'tenant-aaa' });
    const res = await request(app).post('/api/caja/cerrar/abc').set('Authorization', `Bearer ${auditorToken}`).send({ efectivo_contado: 100 });
    expect(res.status).toBe(403);
  });
});
