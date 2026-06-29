-- migrate:up
-- Idempotencia en abonos (B2): evita duplicar un pago por doble-click o reintento de red,
-- igual que ya hacen `sales` y `accounts`. El cliente envía una clave estable por intento;
-- si llega dos veces, el segundo se rechaza por el índice único y la ruta devuelve el abono previo.
-- Aditivo y seguro: IF NOT EXISTS no rompe nada si ya existe.
ALTER TABLE account_payments ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_payments_idem
  ON account_payments (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS uq_account_payments_idem;
ALTER TABLE account_payments DROP COLUMN IF EXISTS idempotency_key;
