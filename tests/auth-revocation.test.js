import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../middleware/rateLimit', () => ({
  loginLimiter: (_q, _s, n) => n(), recoveryLimiter: (_q, _s, n) => n(), generalLimiter: (_q, _s, n) => n(),
}));
vi.mock('../utils/audit', () => ({ default: vi.fn() }));

import app from '../app.js';
import auth from '../middleware/auth';
const { isSessionRevoked } = auth;

function token(p) { return jwt.sign(p, 'test-secret-key', { expiresIn: '1h' }); }

// NOTA DE INFRAESTRUCTURA: el camino "revocado → 401 SESSION_REVOKED" depende de que supabase
// devuelva active=false; vitest no intercepta el require CJS de supabase en el middleware, así
// que esa decisión se cubre con la función pura isSessionRevoked. Los tests HTTP cubren sin token,
// token inválido, y fail-open (BD inalcanzable → una sesión válida NO se revoca).

describe('B4 — isSessionRevoked (decisión pura)', () => {
  it('usuario activo → no revoca', () => expect(isSessionRevoked('active')).toBe(false));
  it('usuario inactivo → revoca', () => expect(isSessionRevoked('revoked')).toBe(true));
  it('usuario eliminado → revoca', () => expect(isSessionRevoked('gone')).toBe(true));
  it('estado desconocido (error/timeout) → no revoca (fail-open)', () => expect(isSessionRevoked('unknown')).toBe(false));
  it('sin estado (null) → no revoca (fail-open)', () => expect(isSessionRevoked(null)).toBe(false));
});

describe('B4 — middleware de revocación (HTTP)', () => {
  it('sin token → 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('token mal formado → 401', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer no-es-un-jwt');
    expect(res.status).toBe(401);
  });

  it('token firmado con secret equivocado → 401', async () => {
    const bad = jwt.sign({ userId: 'x', role: 'admin' }, 'otro-secret', { expiresIn: '1h' });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${bad}`);
    expect(res.status).toBe(401);
  });

  it('token válido con BD inalcanzable → fail-open (200, sesión NO revocada)', async () => {
    const tk = token({ userId: 'u-activo', name: 'Ana', role: 'admin', tenant_id: 't1' });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tk}`);
    expect(res.status).toBe(200);
    expect(res.body.user.userId).toBe('u-activo');
    expect(res.body.code).not.toBe('SESSION_REVOKED');
  });
});
