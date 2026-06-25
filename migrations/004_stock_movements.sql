-- ============================================================
-- MIGRACIÓN 004 — Historial de movimientos de stock
-- Fecha: 2026-06-25
--
-- Aditivo y no destructivo. No modifica datos existentes.
-- El stock actual de los productos queda intacto.
-- Los movimientos futuros (ventas, compras, ajustes) quedan registrados.
-- ============================================================

CREATE TABLE IF NOT EXISTS stock_movements (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  product_id   UUID NOT NULL REFERENCES products(id),
  type         TEXT NOT NULL CHECK (type IN ('venta','compra','ajuste','devolucion')),
  qty_before   INTEGER NOT NULL,
  qty_change   INTEGER NOT NULL,   -- positivo = entrada, negativo = salida
  qty_after    INTEGER NOT NULL,
  reason       TEXT,               -- motivo (obligatorio para ajustes)
  reference_id TEXT,               -- id de venta/compra relacionada
  user_name    TEXT NOT NULL,
  user_role    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product  ON stock_movements (product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant   ON stock_movements (tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created  ON stock_movements (created_at DESC);

-- ============================================================
-- FIN DE MIGRACIÓN 004
-- ============================================================
