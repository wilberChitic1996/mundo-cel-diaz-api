-- 022_tenant_created_indexes.sql
-- D1: índices compuestos (tenant_id, created_at) para las consultas multi-tenant
-- más frecuentes (filtrar por negocio + ordenar/rango por fecha). Antes existían
-- índices por fecha O por negocio, pero no el combinado; `accounts` no tenía
-- ningún índice por fecha. Solo agrega (idempotente), no borra nada.
-- Aplicado a staging (aawjhttlaydwsipsifre) y prod (rhecnmfivygkayfvauxt) el 2026-06-29.

CREATE INDEX IF NOT EXISTS idx_sales_tenant_created           ON public.sales           (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created      ON public.audit_logs      (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_created ON public.stock_movements (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_accounts_tenant_created        ON public.accounts        (tenant_id, created_at DESC);
