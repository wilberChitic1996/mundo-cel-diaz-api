import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// NOTA DE INFRAESTRUCTURA: el middleware consume cache/supabase con `require()` (CJS) y
// vitest no intercepta esos require desde el test (instancia de módulo distinta). Por eso
// el camino "bloqueado → 403" NO se prueba por HTTP (sería no determinista): se cubre con
// tests de la decisión pura `isSubscriptionBlocked` (la regla de negocio real de B2) y de
// las ramas de bypass del middleware. Los tests HTTP quedan como guardas de regresión del
// camino feliz (que el cableado no rompe las escrituras de un tenant al día).

vi.mock('../middleware/rateLimit', () => ({
  loginLimiter: (_q, _s, n) => n(), recoveryLimiter: (_q, _s, n) => n(),
}));
vi.mock('../utils/audit', () => ({ default: vi.fn() }));

import app from '../app.js';
import enforceSubscription from '../middleware/enforceSubscription';
const { isSubscriptionBlocked } = enforceSubscription;

function token(p) { return jwt.sign(p, 'test-secret-key', { expiresIn: '1h' }); }

// --- Unidad: la decisión pura de bloqueo (regla de negocio de B2, sin red) ---
describe('B2 — isSubscriptionBlocked (decisión pura)', () => {
  it('tenant inactivo → bloquea', () => {
    expect(isSubscriptionBlocked({ active: false, expires_at: null })).toBe(true);
  });
  it('tenant vencido (expires_at en el pasado) → bloquea', () => {
    expect(isSubscriptionBlocked({ active: true, expires_at: '2020-01-01T00:00:00Z' })).toBe(true);
  });
  it('tenant activo y vigente → NO bloquea', () => {
    expect(isSubscriptionBlocked({ active: true, expires_at: '2999-01-01T00:00:00Z' })).toBe(false);
  });
  it('tenant activo sin fecha de expiración → NO bloquea', () => {
    expect(isSubscriptionBlocked({ active: true, expires_at: null })).toBe(false);
  });
  it('sin información confirmada (null) → NO bloquea (fail-open)', () => {
    expect(isSubscriptionBlocked(null)).toBe(false);
  });
  it('inactivo aunque la fecha siga vigente → bloquea', () => {
    expect(isSubscriptionBlocked({ active: false, expires_at: '2999-01-01T00:00:00Z' })).toBe(true);
  });
});

// --- Ramas de bypass del middleware: no consultan caché ni BD ---
describe('B2 — enforceSubscription (bypass sin consulta)', () => {
  function fakeRes() {
    return { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  }
  it('superadmin → next() sin consultar', async () => {
    let called = false;
    await enforceSubscription({ user: { role: 'superadmin' } }, fakeRes(), () => { called = true; });
    expect(called).toBe(true);
  });
  it('request sin tenant → next() sin consultar', async () => {
    let called = false;
    await enforceSubscription({ user: { role: 'admin', tenant_id: null } }, fakeRes(), () => { called = true; });
    expect(called).toBe(true);
  });
  it('request sin user → next() sin consultar', async () => {
    let called = false;
    await enforceSubscription({}, fakeRes(), () => { called = true; });
    expect(called).toBe(true);
  });
});

// --- Integración HTTP: guardas de regresión del camino feliz (sin red confirmada) ---
// Sin un estado confirmado en caché/BD el middleware hace fail-open (no bloquea), así que
// estas escrituras NO deben devolver 403 por suscripción — prueba que el cableado del
// middleware no rompe a un tenant operando con normalidad.
describe('B2 — el cableado no bloquea el camino feliz (HTTP)', () => {
  it('admin sin bloqueo confirmado → NO es 403 por suscripción', async () => {
    const tk = token({ userId: 'u1', role: 'admin', tenant_id: 't-ok' });
    const res = await request(app).post('/api/sales').set('Authorization', `Bearer ${tk}`).send({}); // body inválido → 400
    expect(res.status).not.toBe(403);
  });

  it('superadmin no requiere suscripción', async () => {
    const tk = token({ userId: 'sa', role: 'superadmin', tenant_id: null });
    const res = await request(app).post('/api/sales').set('Authorization', `Bearer ${tk}`).send({});
    expect(res.status).not.toBe(403);
  });
});
