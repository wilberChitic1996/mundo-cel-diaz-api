-- 026_account_origin.sql
-- Migración del cuaderno (Fase 1: deudas históricas).
-- Marca el ORIGEN de las cuentas por cobrar para distinguir lo cargado del cuaderno
-- (saldo inicial / "foto de apertura") de la operación normal, y permite revertir
-- una carga completa por lote.
--
-- Solo AGREGA columnas (idempotente), NO borra ni modifica datos. Todas las cuentas
-- existentes quedan como 'operacion' por el DEFAULT, así que no cambia nada de lo actual.
-- Las cuentas migradas se crean por INSERT directo (endpoint /api/migration/debts),
-- nunca por el flujo de venta → por construcción NO tocan stock, caja ni IVA.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS origin             TEXT NOT NULL DEFAULT 'operacion',
  ADD COLUMN IF NOT EXISTS migrated_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS migration_batch_id UUID;

-- Valores válidos de origin (no rompe filas viejas: todas = 'operacion').
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_accounts_origin') THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT chk_accounts_origin CHECK (origin IN ('operacion','migracion'));
  END IF;
END $$;

-- Índice parcial (pequeño): solo indexa las cuentas migradas, para revertir/segregar
-- una carga por lote sin penalizar la operación normal.
CREATE INDEX IF NOT EXISTS idx_accounts_migracion
  ON public.accounts (tenant_id, migration_batch_id) WHERE origin = 'migracion';
