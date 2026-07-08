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

// La migración crea cuentas por cobrar (dinero): debe exigir JWT siempre.
describe('Migración del cuaderno — protección de autenticación', () => {
  it('POST /api/migration/debts devuelve 401 sin token', async () => {
    const res = await request(app).post('/api/migration/debts').send({ debts: [{ client: 'X', total: 100 }] });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/token/i);
  });

  it('DELETE /api/migration/debts/:batchId devuelve 401 sin token', async () => {
    const res = await request(app).delete('/api/migration/debts/abc');
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/migration/batches (ruta versionada) también exige token', async () => {
    const res = await request(app).get('/api/v1/migration/batches');
    expect(res.status).toBe(401);
  });
});

// Migrar es una acción de administración (carga inicial): solo admin.
// requireRole rechaza antes de tocar la BD, así que es determinista sin red.
describe('Migración del cuaderno — RBAC (solo admin)', () => {
  it('POST /api/migration/debts como auditor → 403', async () => {
    const t = token({ userId: 'aud-1', role: 'auditor', tenant_id: 'tenant-aaa' });
    const res = await request(app).post('/api/migration/debts').set('Authorization', `Bearer ${t}`).send({ debts: [{ client: 'X', total: 100 }] });
    expect(res.status).toBe(403);
  });

  it('POST /api/migration/debts como cajero → 403 (no es admin)', async () => {
    const t = token({ userId: 'caj-1', role: 'cajero', tenant_id: 'tenant-aaa' });
    const res = await request(app).post('/api/migration/debts').set('Authorization', `Bearer ${t}`).send({ debts: [{ client: 'X', total: 100 }] });
    expect(res.status).toBe(403);
  });

  it('DELETE /api/migration/debts/:batchId como auditor → 403', async () => {
    const t = token({ userId: 'aud-1', role: 'auditor', tenant_id: 'tenant-aaa' });
    const res = await request(app).delete('/api/migration/debts/abc').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(403);
  });
});
