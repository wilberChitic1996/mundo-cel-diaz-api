-- migrate:up
-- Crédito fiscal de compras: registra si la compra tuvo factura del proveedor y su IVA
-- (crédito fiscal), más NIT y número de factura. Multi-tenant: `purchases` ya tiene
-- tenant_id; estas columnas son por fila. Idempotente y retrocompatible (defaults seguros).
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS has_factura    boolean NOT NULL DEFAULT false;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS supplier_nit   text;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS factura_numero text;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS iva_amount     numeric NOT NULL DEFAULT 0;

-- migrate:down
ALTER TABLE purchases DROP COLUMN IF EXISTS has_factura;
ALTER TABLE purchases DROP COLUMN IF EXISTS supplier_nit;
ALTER TABLE purchases DROP COLUMN IF EXISTS factura_numero;
ALTER TABLE purchases DROP COLUMN IF EXISTS iva_amount;
