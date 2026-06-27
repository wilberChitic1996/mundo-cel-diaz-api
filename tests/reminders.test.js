/**
 * Tests unitarios para utils/reminders.js
 *
 * Estrategia de mock: utils/reminders.js es CJS y captura require('../supabase')
 * y require('./logger') en el cache de Node al momento de cargarse.
 * Para interceptar esas llamadas usamos createRequire para obtener las MISMAS
 * instancias del cache CJS y reemplazamos los métodos directamente.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

vi.mock('node-cron', () => ({ schedule: vi.fn() }));

// Usamos createRequire para obtener el mismo cache CJS que reminders.js usa
const cjsRequire = createRequire(import.meta.url);

// Cargar en orden: primero los deps, luego reminders (así comparten cache)
const supabase = cjsRequire('../supabase.js');
const logger   = cjsRequire('../utils/logger.js');
const { checkOverdueAccounts, checkExpiringWarranties, checkStalledRepairs } =
  cjsRequire('../utils/reminders.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

const TENANT_A = 'tenant-aaaa-1111';
const TENANT_B = 'tenant-bbbb-2222';

/**
 * Cadena fluent que resuelve { data, error } cuando se hace await.
 */
function makeChain(data, error = null) {
  const result = { data, error };
  const p = Promise.resolve(result);
  ['select','eq','lte','gte','lt','gt','is','not','in'].forEach(m => {
    p[m] = () => p;
  });
  p.single = () => Promise.resolve(result);
  return p;
}

// Guardar originales para restaurar
const origFrom  = supabase.from.bind(supabase);
const origWarn  = logger.warn;
const origInfo  = logger.info;
const origError = logger.error;

// Mocks en el objeto compartido del cache CJS
let sendPushCalls = [];

// Stub de sendPushToTenant: getPush() en reminders llama require('../routes/push') en runtime.
// Usamos createRequire para obtener el mismo objeto CJS y reemplazar la propiedad exportada.
const pushModule = cjsRequire('../routes/push');
const origSendPush = pushModule.sendPushToTenant;

function setupSupabase(data, error = null) {
  supabase.from = () => makeChain(data, error);
}

const warnMock  = vi.fn();
const infoMock  = vi.fn();
const errorMock = vi.fn();

beforeEach(() => {
  sendPushCalls = [];
  logger.warn  = warnMock;
  logger.info  = infoMock;
  logger.error = errorMock;
  warnMock.mockReset();
  infoMock.mockReset();
  errorMock.mockReset();
  // Stub sendPushToTenant en el módulo CJS que reminders.js obtiene por require
  pushModule.sendPushToTenant = (...args) => { sendPushCalls.push(args); };
});

afterEach(() => {
  supabase.from = origFrom;
  logger.warn  = origWarn;
  logger.info  = origInfo;
  logger.error = origError;
  pushModule.sendPushToTenant = origSendPush;
});

// ── checkOverdueAccounts ──────────────────────────────────────────────────────

describe('checkOverdueAccounts', () => {
  it('no hace nada cuando data es array vacío', async () => {
    setupSupabase([]);
    await checkOverdueAccounts();
    expect(warnMock).not.toHaveBeenCalled();
    expect(sendPushCalls.length).toBe(0);
  });

  it('no hace nada cuando data es null', async () => {
    setupSupabase(null);
    await checkOverdueAccounts();
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('registra warn y llama sendPush por cada tenant con cuentas vencidas', async () => {
    const today = new Date().toISOString().split('T')[0];
    setupSupabase([
      { id: '1', client: 'Cliente A', balance: 100, due_date: today, tenant_id: TENANT_A },
      { id: '2', client: 'Cliente B', balance: 200, due_date: today, tenant_id: TENANT_A },
      { id: '3', client: 'Cliente C', balance: 50,  due_date: today, tenant_id: TENANT_B },
    ]);

    await checkOverdueAccounts();

    expect(warnMock).toHaveBeenCalledTimes(2);
    expect(warnMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: TENANT_A, count: 2 }),
      expect.stringMatching(/cuentas vencidas/i),
    );
    expect(warnMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: TENANT_B, count: 1 }),
      expect.stringMatching(/cuentas vencidas/i),
    );
    const tenantsCalled = sendPushCalls.map(c => c[0]);
    expect(tenantsCalled).toContain(TENANT_A);
    expect(tenantsCalled).toContain(TENANT_B);
    expect(sendPushCalls.every(c => c[1].url === '/accounts')).toBe(true);
  });

  it('registra error cuando supabase devuelve error', async () => {
    setupSupabase(null, { message: 'DB failure' });
    await expect(checkOverdueAccounts()).resolves.toBeUndefined();
    expect(errorMock).toHaveBeenCalled();
    expect(warnMock).not.toHaveBeenCalled();
  });
});

// ── checkExpiringWarranties ───────────────────────────────────────────────────

describe('checkExpiringWarranties', () => {
  it('no hace nada cuando no hay garantías próximas a vencer', async () => {
    setupSupabase([]);
    await checkExpiringWarranties();
    expect(sendPushCalls.length).toBe(0);
  });

  it('registra info y llama sendPush por tenant con garantías por vencer', async () => {
    const in3days = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];
    setupSupabase([
      { id: 'w1', client: 'Cliente D', description: 'Pantalla', end_date: in3days, tenant_id: TENANT_A },
      { id: 'w2', client: 'Cliente E', description: 'Batería',  end_date: in3days, tenant_id: TENANT_A },
    ]);

    await checkExpiringWarranties();

    expect(infoMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: TENANT_A, count: 2 }),
      expect.stringMatching(/garantías/i),
    );
    const tenantsCalled = sendPushCalls.map(c => c[0]);
    expect(tenantsCalled).toContain(TENANT_A);
    expect(sendPushCalls.every(c => c[1].url === '/warranties')).toBe(true);
  });

  it('registra error cuando supabase falla', async () => {
    setupSupabase(null, { message: 'connection timeout' });
    await expect(checkExpiringWarranties()).resolves.toBeUndefined();
    expect(errorMock).toHaveBeenCalled();
  });
});

// ── checkStalledRepairs ───────────────────────────────────────────────────────

describe('checkStalledRepairs', () => {
  it('no hace nada cuando no hay reparaciones estancadas', async () => {
    setupSupabase([]);
    await checkStalledRepairs();
    expect(warnMock).not.toHaveBeenCalled();
    expect(sendPushCalls.length).toBe(0);
  });

  it('registra warn y llama sendPush por tenant con reparaciones >30 días sin movimiento', async () => {
    const old = new Date(Date.now() - 35 * 86400000).toISOString();
    setupSupabase([
      { id: 'r1', client: 'Juan', device: 'Samsung A12', status: 'recibido',   updated_at: old, tenant_id: TENANT_A },
      { id: 'r2', client: 'Ana',  device: 'iPhone 11',   status: 'en_proceso', updated_at: old, tenant_id: TENANT_B },
    ]);

    await checkStalledRepairs();

    expect(warnMock).toHaveBeenCalledTimes(2);
    expect(warnMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: TENANT_A, count: 1 }),
      expect.stringMatching(/reparaciones/i),
    );
    const tenantsCalled = sendPushCalls.map(c => c[0]);
    expect(tenantsCalled).toContain(TENANT_A);
    expect(tenantsCalled).toContain(TENANT_B);
    expect(sendPushCalls.every(c => c[1].url === '/repairs')).toBe(true);
  });

  it('registra error cuando supabase falla', async () => {
    setupSupabase(null, { message: 'query error' });
    await expect(checkStalledRepairs()).resolves.toBeUndefined();
    expect(errorMock).toHaveBeenCalled();
  });
});
