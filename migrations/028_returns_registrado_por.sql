-- 028: quien atendio la devolucion (antes no se guardaba -> Historial mostraba '-')
-- Aditiva e idempotente. Aplicada en staging y produccion el 12 jul 2026.
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS registrado_por JSONB;
-- DOWN: ALTER TABLE public.returns DROP COLUMN IF EXISTS registrado_por;
