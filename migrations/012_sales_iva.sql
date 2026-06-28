-- migrate:up

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS iva_percent  NUMERIC(5,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS iva_amount   NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subtotal_neto NUMERIC(12,2) DEFAULT 0;

-- migrate:down

ALTER TABLE sales
  DROP COLUMN IF EXISTS iva_percent,
  DROP COLUMN IF EXISTS iva_amount,
  DROP COLUMN IF EXISTS subtotal_neto;
