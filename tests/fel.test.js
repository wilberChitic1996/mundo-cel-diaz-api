import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import felService from '../services/felService';

const { certifySale, buildDTE } = felService;

// FEL es PROVIDER-AGNOSTIC y DORMIDO por defecto. La certificación real va a un certificador
// externo; aquí se prueba el modo dormido (sin BD) y el armado del DTE (función pura).
describe('FEL — felService (B1)', () => {
  beforeEach(() => { delete process.env.FEL_ENABLED; });
  afterEach(() => { delete process.env.FEL_ENABLED; });

  it('dormido por defecto: certifySale → {status:disabled} sin tocar la BD', async () => {
    const r = await certifySale('sale-1', 'tenant-1');
    expect(r.ok).toBe(false);
    expect(r.status).toBe('disabled');
  });

  it('buildDTE arma emisor/receptor/totales/items desde la venta y el tenant', () => {
    const sale = { client: 'Juan', client_nit: '123', total: 112, iva_percent: 12, iva_amount: 12, subtotal_neto: 100,
      sale_items: [{ code: 'A', name: 'Cosa', qty: 2, price: 56, subtotal: 112 }] };
    const tenant = { nit: 'NIT-EMISOR', fiscal_name: 'Mi Negocio SA', address: 'Zona 1', sat_regime: 'general', currency: 'GTQ' };
    const dte = buildDTE(sale, tenant);
    expect(dte.emisor.nit).toBe('NIT-EMISOR');
    expect(dte.emisor.nombre).toBe('Mi Negocio SA');
    expect(dte.receptor.nit).toBe('123');
    expect(dte.totales.iva_amount).toBe(12);
    expect(dte.totales.subtotal_neto).toBe(100);
    expect(dte.items).toHaveLength(1);
    expect(dte.items[0].descripcion).toBe('Cosa');
  });

  it('buildDTE usa CF / Consumidor Final y GTQ por defecto si faltan datos', () => {
    const dte = buildDTE({ total: 50, sale_items: [] }, { name: 'N' });
    expect(dte.receptor.nit).toBe('CF');
    expect(dte.receptor.nombre).toBe('Consumidor Final');
    expect(dte.emisor.moneda).toBe('GTQ');
    expect(dte.items).toHaveLength(0);
  });
});
