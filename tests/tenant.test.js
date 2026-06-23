import { describe, it, expect } from 'vitest';
import { withTenant, tid } from '../utils/tenant.js';

function fakeQuery() {
  const calls = [];
  const q = { _calls: calls, eq: (col, val) => { calls.push([col, val]); return q; } };
  return q;
}

describe('withTenant', () => {
  it('adds tenant_id filter for regular user', () => {
    const q = fakeQuery();
    withTenant(q, { user: { role: 'admin', tenant_id: 'abc' } });
    expect(q._calls).toContainEqual(['tenant_id', 'abc']);
  });

  it('does NOT filter for superadmin', () => {
    const q = fakeQuery();
    withTenant(q, { user: { role: 'superadmin', tenant_id: null } });
    expect(q._calls.find(c => c[0] === 'tenant_id')).toBeUndefined();
  });

  it('does NOT filter when tenant_id is null', () => {
    const q = fakeQuery();
    withTenant(q, { user: { role: 'admin', tenant_id: null } });
    expect(q._calls.find(c => c[0] === 'tenant_id')).toBeUndefined();
  });

  it('does NOT filter when req.user is missing', () => {
    const q = fakeQuery();
    withTenant(q, {});
    expect(q._calls).toHaveLength(0);
  });
});

describe('tid', () => {
  it('returns tenant_id for regular user', () => {
    expect(tid({ user: { role: 'admin', tenant_id: 'xyz' } })).toBe('xyz');
  });

  it('returns null for superadmin', () => {
    expect(tid({ user: { role: 'superadmin', tenant_id: 'x' } })).toBeNull();
  });

  it('returns null when no user', () => {
    expect(tid({})).toBeNull();
  });
});
