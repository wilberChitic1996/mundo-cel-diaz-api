import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// supabase no debe alcanzarse en los caminos rechazados por validación (400/403).
vi.mock('../supabase', () => ({
  default: { from: () => { throw new Error('Supabase no debería alcanzarse en un camino rechazado'); } },
}));

vi.mock('../middleware/rateLimit', () => ({
  loginLimiter:    (_req, _res, next) => next(),
  recoveryLimiter: (_req, _res, next) => next(),
}));

vi.mock('../utils/audit', () => ({ default: vi.fn() }));

import app from '../app.js';

const TENANT_A = 'tenant-aaa';
function token(payload) { return jwt.sign(payload, 'test-secret-key', { expiresIn: '1h' }); }

const adminToken  = token({ userId: 'admin-1', name: 'Admin',  role: 'admin',  tenant_id: TENANT_A });
const cajeroToken = token({ userId: 'caj-1',   name: 'Cajero', role: 'cajero', tenant_id: TENANT_A });

describe('B3 — users.js no permite escalada a superadmin', () => {
  it('POST /api/users con role=superadmin → 400 (bloquea escalada)', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'X', email: 'x@x.com', password: 'secret123', role: 'superadmin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rol inválido/i);
  });

  it('POST /api/users sin role → 400', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'X', email: 'x@x.com', password: 'secret123' });
    expect(res.status).toBe(400);
  });

  it('PUT /api/users/:id con role=superadmin → 400', async () => {
    const res = await request(app)
      .put('/api/users/other-1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'superadmin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rol inválido/i);
  });

  it('PUT sobre la propia cuenta cambiando rol → 400 (no auto-edición de rol)', async () => {
    const res = await request(app)
      .put('/api/users/admin-1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'cajero' });
    expect(res.status).toBe(400);
  });

  it('PUT sobre la propia cuenta desactivándose → 400', async () => {
    const res = await request(app)
      .put('/api/users/admin-1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false });
    expect(res.status).toBe(400);
  });

  it('cajero no puede crear usuarios → 403 (RBAC intacto)', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${cajeroToken}`)
      .send({ name: 'X', email: 'x@x.com', password: 'secret123', role: 'cajero' });
    expect(res.status).toBe(403);
  });

  it('rol válido (cajero) pasa la whitelist (no devuelve 400)', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Nuevo', email: 'n@x.com', password: 'secret123', role: 'cajero' });
    // pasa la validación de rol; luego falla al tocar supabase (mock) → cualquier cosa menos 400.
    expect(res.status).not.toBe(400);
  });
});
