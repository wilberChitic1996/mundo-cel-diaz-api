import { describe, it, expect } from 'vitest';
import { parsePaging } from '../utils/paging';

// A14 — paginación opcional y retrocompatible.
describe('A14 — parsePaging', () => {
  it('sin params → no pagina (compat: devuelve todo)', () => {
    const p = parsePaging({});
    expect(p.hasPaging).toBe(false);
    expect(p.page).toBe(1);
    expect(p.limit).toBe(50);
    expect(p.from).toBe(0);
    expect(p.to).toBe(49);
  });

  it('page=2 → pagina, rango correcto', () => {
    const p = parsePaging({ page: '2' });
    expect(p.hasPaging).toBe(true);
    expect(p.page).toBe(2);
    expect(p.from).toBe(50);
    expect(p.to).toBe(99);
  });

  it('limit=10 → pagina con ese tamaño', () => {
    const p = parsePaging({ limit: '10' });
    expect(p.hasPaging).toBe(true);
    expect(p.limit).toBe(10);
    expect(p.from).toBe(0);
    expect(p.to).toBe(9);
  });

  it('page=3 & limit=20 → rango [40,59]', () => {
    const p = parsePaging({ page: '3', limit: '20' });
    expect(p.from).toBe(40);
    expect(p.to).toBe(59);
  });

  it('limit excesivo se acota a 200', () => {
    expect(parsePaging({ limit: '999' }).limit).toBe(200);
  });

  it('valores inválidos → defaults seguros', () => {
    const p = parsePaging({ page: '0', limit: 'abc' });
    expect(p.page).toBe(1);
    expect(p.limit).toBe(50);
  });

  it('page negativa → 1', () => {
    expect(parsePaging({ page: '-5' }).page).toBe(1);
  });

  it('defaultLimit configurable', () => {
    expect(parsePaging({ page: '1' }, 25).limit).toBe(25);
  });
});
