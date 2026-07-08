// tests/validate.test.js — Blindaje de dinero (Ronda A)
import { describe, it, expect } from 'vitest';
import { validateSaleInput, validatePaymentAmount, validateRefund } from '../utils/validate.js';

describe('validateSaleInput — ventas', () => {
  const items = [{ name: 'Tel A', price: 1000, qty: 2 }, { name: 'Cable', price: 50, qty: 1 }];

  it('acepta una venta con total correcto', () => {
    expect(validateSaleInput({ total: 2050, items }).ok).toBe(true);
  });
  it('rechaza total que no coincide con la suma de items', () => {
    const r = validateSaleInput({ total: 5, items });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no coincide/);
  });
  it('tolera diferencia de centavos por redondeo', () => {
    expect(validateSaleInput({ total: 2050.009, items }).ok).toBe(true);
  });
  it('rechaza cantidad negativa (que inflaría stock)', () => {
    const r = validateSaleInput({ total: -3000, items: [{ name: 'X', price: 1000, qty: -3 }] });
    expect(r.ok).toBe(false);
  });
  it('rechaza cantidad cero y precio negativo', () => {
    expect(validateSaleInput({ total: 0, items: [{ price: 10, qty: 0 }] }).ok).toBe(false);
    expect(validateSaleInput({ total: -10, items: [{ price: -10, qty: 1 }] }).ok).toBe(false);
  });
  it('rechaza total negativo o no numérico', () => {
    expect(validateSaleInput({ total: -100, items: [] }).ok).toBe(false);
    expect(validateSaleInput({ total: 'abc', items: [] }).ok).toBe(false);
  });
  it('pago dividido: segundo monto debe estar entre 0 y el total', () => {
    expect(validateSaleInput({ total: 2050, items, secondMethod: 'Tarjeta', secondAmount: 600 }).ok).toBe(true);
    expect(validateSaleInput({ total: 2050, items, secondMethod: 'Tarjeta', secondAmount: -5 }).ok).toBe(false);
    expect(validateSaleInput({ total: 2050, items, secondMethod: 'Tarjeta', secondAmount: 3000 }).ok).toBe(false);
    expect(validateSaleInput({ total: 2050, items, secondMethod: 'Tarjeta', secondAmount: 0 }).ok).toBe(false);
  });
  it('venta parcial: abono inicial negativo se rechaza', () => {
    const r = validateSaleInput({ total: 2050, items, payType: 'parcial', initialPay: -100 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/negativo/);
  });
  it('venta parcial: abono inicial 0 o positivo pasa', () => {
    expect(validateSaleInput({ total: 2050, items, payType: 'parcial', initialPay: 0 }).ok).toBe(true);
    expect(validateSaleInput({ total: 2050, items, payType: 'parcial', initialPay: 500 }).ok).toBe(true);
  });
});

describe('validatePaymentAmount — abonos', () => {
  it('acepta abono válido dentro del saldo', () => {
    expect(validatePaymentAmount(100, 300).ok).toBe(true);
    expect(validatePaymentAmount(300, 300).ok).toBe(true);
  });
  it('rechaza abono negativo o cero (que "reabriría" deuda)', () => {
    expect(validatePaymentAmount(-500, 300).ok).toBe(false);
    expect(validatePaymentAmount(0, 300).ok).toBe(false);
  });
  it('rechaza abono mayor al saldo', () => {
    const r = validatePaymentAmount(10000, 300);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/saldo/);
  });
  it('rechaza monto no numérico', () => {
    expect(validatePaymentAmount('abc', 300).ok).toBe(false);
  });
});

describe('validateRefund — devoluciones', () => {
  it('acepta reembolso normal', () => {
    expect(validateRefund({ refundAmount: 500, saleTotal: 2000, prevRefunded: 0, itemsTotal: 500 }).ok).toBe(true);
  });
  it('rechaza reembolso negativo', () => {
    expect(validateRefund({ refundAmount: -50 }).ok).toBe(false);
  });
  it('anti-doble-devolución: rechaza si ya se reembolsó el total', () => {
    const r = validateRefund({ refundAmount: 2000, saleTotal: 2000, prevRefunded: 2000 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/queda por devolver/);
  });
  it('permite el remanente exacto tras una devolución parcial', () => {
    expect(validateRefund({ refundAmount: 800, saleTotal: 2000, prevRefunded: 1200 }).ok).toBe(true);
  });
  it('rechaza reembolso mayor al valor de los artículos', () => {
    expect(validateRefund({ refundAmount: 999999, itemsTotal: 350 }).ok).toBe(false);
  });
  it('reembolso 0 ("Sin reembolso") pasa', () => {
    expect(validateRefund({ refundAmount: 0, itemsTotal: 350 }).ok).toBe(true);
  });
});
