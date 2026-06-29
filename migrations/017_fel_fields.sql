-- migrate:up
-- Campos adicionales de FEL en `sales` para guardar el resultado de la certificación.
-- `fel_serie`, `fel_numero`, `fel_status` ya existen (migración 002). Acá se agregan los que
-- faltan para un DTE completo. Correr SOLO al activar FEL (ver checklist FEL en CLAUDE.md).
-- Seguro/idempotente: ADD COLUMN IF NOT EXISTS no rompe nada si ya existen.

ALTER TABLE sales ADD COLUMN IF NOT EXISTS fel_uuid    TEXT;  -- número de autorización SAT (UUID)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS fel_fecha   TIMESTAMPTZ; -- fecha/hora de certificación
ALTER TABLE sales ADD COLUMN IF NOT EXISTS fel_error   TEXT;  -- último error de certificación (para reintentos)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS fel_xml_url TEXT;  -- URL del XML certificado (si el proveedor la da)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS fel_pdf_url TEXT;  -- URL del PDF/representación gráfica

CREATE INDEX IF NOT EXISTS idx_sales_fel_status ON sales(tenant_id, fel_status);

-- migrate:down
ALTER TABLE sales DROP COLUMN IF EXISTS fel_uuid;
ALTER TABLE sales DROP COLUMN IF EXISTS fel_fecha;
ALTER TABLE sales DROP COLUMN IF EXISTS fel_error;
ALTER TABLE sales DROP COLUMN IF EXISTS fel_xml_url;
ALTER TABLE sales DROP COLUMN IF EXISTS fel_pdf_url;
DROP INDEX IF EXISTS idx_sales_fel_status;
