import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// El orden de middleware es `auth → requireRole → enforceSubscription`, así que un rol no
// autorizado se rechaza con 403 ANTES de cualquier consulta a la BD: estos tests miden RBAC puro.
vi.mock('../middleware/rateLimit', () => ({
  loginLimiter:    (_req, _res, next) => next(),
  recoveryLimiter: (_req, _res, next) => next(),
}));

vi.mock('../utils/audit', () => ({ default: vi.fn() }));

import app from '../app.js';

const T = 'tenant-aaa';
function token(payload) { return jwt.sign(payload, 'test-secret-key', { expiresIn: '1h' }); }

const auditorToken = token({ userId: 'aud-1', name: 'Aud',    role: 'auditor', tenant_id: T });
const cajeroToken  = token({ userId: 'caj-1', name: 'Cajero', role: 'cajero',  tenant_id: T });

// A8 — RBAC server-side: auditor (solo lectura) NO puede ejecutar escrituras por API.
describe('A8 — auditor (solo lectura) bloqueado en endpoints de escritura → 403', () => {
  const casos = [
    ['post', '/api/sales',            {}],
    ['post', '/api/accounts',         {}],
    ['post', '/api/accounts/x1/payments', { amount: 10 }],
    ['post', '/api/returns',          { itemCondition: 'bueno' }],
    ['post', '/api/warranties',       {}],
    ['post', '/api/caja/abrir',       { fondo_inicial: 100 }],
    ['post', '/api/caja/gastos',      { concepto: 'x', monto: 5 }],
    ['put',  '/api/repairs/r1/status', { status: 'entregado' }],
    ['post', '/api/products/p1/variants', { color: 'rojo' }],
  ];
  for (const [method, path, body] of casos) {
    it(`${method.toUpperCase()} ${path} → 403`, async () => {
      const res = await request(app)[method](path).set('Authorization', `Bearer ${auditorToken}`).send(body);
      expect(res.status).toBe(403);
    });
  }
});

// El cajero SÍ puede operar (pasa RBAC). No debe recibir 403 en ventas/caja.
describe('A8 — cajero conserva acceso operativo (no 403)', () => {
  it('POST /api/sales (cajero) no es 403 (pasa RBAC; falla luego por validación)', async () => {
    const res = await request(app).post('/api/sales').set('Authorization', `Bearer ${cajeroToken}`).send({});
    expect(res.status).not.toBe(403);
  });
  it('POST /api/caja/abrir (cajero) no es 403', async () => {
    const res = await request(app).post('/api/caja/abrir').set('Authorization', `Bearer ${cajeroToken}`).send({});
    expect(res.status).not.toBe(403);
  });
});

// Variantes son admin-only: un cajero NO puede.
describe('A8 — variantes solo admin', () => {
  it('POST /api/products/p1/variants (cajero) → 403', async () => {
    const res = await request(app).post('/api/products/p1/variants').set('Authorization', `Bearer ${cajeroToken}`).send({ color: 'rojo' });
    expect(res.status).toBe(403);
  });
});
