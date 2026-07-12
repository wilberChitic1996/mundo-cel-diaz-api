-- 029: Ronda de diseño (12 jul 2026) — TODO ADITIVO, no toca datos existentes.
-- (a) desglose de efectivo del cierre de caja (para el comprobante)
-- (b) variante en items de venta/devolución (reingreso de stock por variante)
-- (c) serial en items de venta/devolución (liberar IMEI al devolver)
-- (d) client_id en ventas/devoluciones (renombrar cliente no desliga historial)
-- client_id es TEXT a propósito: producción usa ids text y staging uuid en clients.

-- Up
ALTER TABLE sales          ADD COLUMN IF NOT EXISTS client_id text;
ALTER TABLE returns        ADD COLUMN IF NOT EXISTS client_id text;
ALTER TABLE sale_items     ADD COLUMN IF NOT EXISTS variant_id uuid;
ALTER TABLE sale_items     ADD COLUMN IF NOT EXISTS serial_id uuid;
ALTER TABLE return_items   ADD COLUMN IF NOT EXISTS variant_id uuid;
ALTER TABLE return_items   ADD COLUMN IF NOT EXISTS serial_id uuid;
ALTER TABLE caja_sesiones  ADD COLUMN IF NOT EXISTS efectivo_desglose jsonb;

-- Down
-- ALTER TABLE sales         DROP COLUMN IF EXISTS client_id;
-- ALTER TABLE returns       DROP COLUMN IF EXISTS client_id;
-- ALTER TABLE sale_items    DROP COLUMN IF EXISTS variant_id;
-- ALTER TABLE sale_items    DROP COLUMN IF EXISTS serial_id;
-- ALTER TABLE return_items  DROP COLUMN IF EXISTS variant_id;
-- ALTER TABLE return_items  DROP COLUMN IF EXISTS serial_id;
-- ALTER TABLE caja_sesiones DROP COLUMN IF EXISTS efectivo_desglose;
