-- Migration 005: IVA configurable por tenant
-- Inserta iva_percent = 12 (IVA Guatemala por defecto) para todos los tenants
-- que aún no lo tengan configurado.
-- Ejecutar en Supabase staging primero, luego en producción.

INSERT INTO store_settings (tenant_id, key, value)
SELECT t.id, 'iva_percent', '12'
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM store_settings s
  WHERE s.tenant_id = t.id AND s.key = 'iva_percent'
);
