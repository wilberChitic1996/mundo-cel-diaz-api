import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../supabase', () => ({
  default: { from: () => { throw new Error('Supabase should not be called here'); } },
}));

vi.mock('../middleware/rateLimit', () => ({
  loginLimiter:    (_req, _res, next) => next(),
  recoveryLimiter: (_req, _res, next) => next(),
}));

vi.mock('../utils/audit', () => ({ default: vi.fn() }));

import app from '../app.js';

const TENANT_A = 'tenant-aaa';

function token(payload) {
  return jwt.sign(payload, 'test-secret-key', { expiresIn: '1h' });
}

const cajeroToken = token({ userId: 'u2', name: 'Cajero', role: 'cajero',  tenant_id: TENANT_A });
const auditorToken = token({ userId: 'u3', name: 'Aud',   role: 'auditor', tenant_id: TENANT_A });

describe('POST /api/products — role-based access control', () => {
  it('returns 403 for cajero (read-only role)', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${cajeroToken}`)
      .send({ name: 'Celular', price: 500, stock: 10 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/permisos/i);
  });

  it('returns 403 for auditor (read-only role)', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${auditorToken}`)
      .send({ name: 'Celular', price: 500, stock: 10 });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/products/:id — role-based access control', () => {
  it('returns 403 for cajero', async () => {
    const res = await request(app)
      .put('/api/products/some-id')
      .set('Authorization', `Bearer ${cajeroToken}`)
      .send({ price: 999 });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/products/:id — role-based access control', () => {
  it('returns 403 for cajero', async () => {
    const res = await request(app)
      .delete('/api/products/some-id')
      .set('Authorization', `Bearer ${cajeroToken}`);
    expect(res.status).toBe(403);
  });
});
