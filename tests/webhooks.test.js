import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';

vi.mock('../middleware/rateLimit', () => ({
  loginLimiter: (_q, _s, n) => n(), recoveryLimiter: (_q, _s, n) => n(), generalLimiter: (_q, _s, n) => n(),
}));
vi.mock('../utils/audit', () => ({ default: vi.fn() }));

import app from '../app.js';

const SECRET = 'test-webhook-secret';
function sign(body) { return crypto.createHmac('sha256', SECRET).update(body).digest('hex'); }

// El webhook de cobro es PROVIDER-AGNOSTIC y DORMIDO por defecto. Estos tests cubren el
// cableado y la seguridad sin tocar la BD (la renovación real solo ocurre con firma válida +
// tenant_id + evento de pago, camino que va a supabase y no se prueba aquí).
describe('Cobro — webhook de pago (B-cobro)', () => {
  beforeEach(() => { delete process.env.PAYMENTS_ENABLED; process.env.WEBHOOK_SECRET = SECRET; });
  afterEach(() => { delete process.env.PAYMENTS_ENABLED; delete process.env.WEBHOOK_SECRET; });

  it('dormido por defecto → 503 PAYMENTS_DISABLED', async () => {
    const res = await request(app).post('/api/webhooks/payment')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ event_type: 'payment_success', tenant_id: 't1' }));
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('PAYMENTS_DISABLED');
  });

  it('habilitado + firma inválida → 401', async () => {
    process.env.PAYMENTS_ENABLED = 'true';
    const res = await request(app).post('/api/webhooks/payment')
      .set('Content-Type', 'application/json').set('x-signature', 'firma-mala')
      .send(JSON.stringify({ event_type: 'payment_success', tenant_id: 't1' }));
    expect(res.status).toBe(401);
  });

  it('habilitado + firma válida + sin tenant_id → 400', async () => {
    process.env.PAYMENTS_ENABLED = 'true';
    const body = JSON.stringify({ event_type: 'payment_success' });
    const res = await request(app).post('/api/webhooks/payment')
      .set('Content-Type', 'application/json').set('x-signature', sign(body)).send(body);
    expect(res.status).toBe(400);
  });

  it('habilitado + firma válida + evento no-renovación → 200 ignored (sin tocar BD)', async () => {
    process.env.PAYMENTS_ENABLED = 'true';
    const body = JSON.stringify({ event_type: 'payment_failed', tenant_id: 't1' });
    const res = await request(app).post('/api/webhooks/payment')
      .set('Content-Type', 'application/json').set('x-signature', sign(body)).send(body);
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe('payment_failed');
  });
});
