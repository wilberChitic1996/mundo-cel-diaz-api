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

// store_settings guarda el IVA configurable por negocio: debe exigir JWT.
describe('Configuración de la tienda (IVA configurable) — protección de auth', () => {
  it('GET /api/settings devuelve 401 sin token', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/token/i);
  });

  it('PUT /api/settings devuelve 401 sin token', async () => {
    const res = await request(app).put('/api/settings').send({ iva_percent: '12' });
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/settings (ruta versionada) también exige token', async () => {
    const res = await request(app).get('/api/v1/settings');
    expect(res.status).toBe(401);
  });
});
