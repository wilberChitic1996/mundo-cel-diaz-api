-- ============================================================
-- MIGRACIÓN 001: Agregar tenant_id a tablas hijo
-- Ejecutar en: Supabase SQL Editor (producción Y staging)
-- Fecha: 2026-06-25
-- ============================================================

-- 1. Agregar columna tenant_id (nullable primero para backfill)
ALTER TABLE sale_items       ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE account_items    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE account_payments ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE return_items     ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE purchase_items   ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

-- 2. Backfill desde tabla padre
UPDATE sale_items       si SET tenant_id = s.tenant_id  FROM sales     s WHERE si.sale_id      = s.id AND si.tenant_id IS NULL;
UPDATE account_items    ai SET tenant_id = a.tenant_id  FROM accounts  a WHERE ai.account_id   = a.id AND ai.tenant_id IS NULL;
UPDATE account_payments ap SET tenant_id = a.tenant_id  FROM accounts  a WHERE ap.account_id   = a.id AND ap.tenant_id IS NULL;
UPDATE return_items     ri SET tenant_id = r.tenant_id  FROM returns   r WHERE ri.return_id    = r.id AND ri.tenant_id IS NULL;
UPDATE purchase_items   pi SET tenant_id = p.tenant_id  FROM purchases p WHERE pi.purchase_id  = p.id AND pi.tenant_id IS NULL;

-- 3. Índices para queries por tenant (mejoran velocidad)
CREATE INDEX IF NOT EXISTS idx_sale_items_tenant       ON sale_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_account_items_tenant    ON account_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_account_payments_tenant ON account_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_return_items_tenant     ON return_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_tenant   ON purchase_items(tenant_id);

-- 4. RLS policies para tablas hijo (misma lógica que tablas padre)
-- NOTA: La API usa service_role (bypassa RLS), pero estas policies
--       protegen contra acceso directo no autorizado a la BD.

ALTER TABLE sale_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items   ENABLE ROW LEVEL SECURITY;

-- Verificar que el backfill fue exitoso antes de poner NOT NULL
-- Si algún COUNT > 0, hay registros huérfanos — investigar antes de continuar
SELECT 'sale_items sin tenant'       AS tabla, COUNT(*) FROM sale_items       WHERE tenant_id IS NULL
UNION ALL
SELECT 'account_items sin tenant',             COUNT(*) FROM account_items    WHERE tenant_id IS NULL
UNION ALL
SELECT 'account_payments sin tenant',          COUNT(*) FROM account_payments WHERE tenant_id IS NULL
UNION ALL
SELECT 'return_items sin tenant',              COUNT(*) FROM return_items     WHERE tenant_id IS NULL
UNION ALL
SELECT 'purchase_items sin tenant',            COUNT(*) FROM purchase_items   WHERE tenant_id IS NULL;

-- 5. Una vez confirmado que todos los COUNT = 0, ejecutar esto:
-- (Comentado intencionalmente — descomentar solo si paso 4 muestra 0s)
-- ALTER TABLE sale_items       ALTER COLUMN tenant_id SET NOT NULL;
-- ALTER TABLE account_items    ALTER COLUMN tenant_id SET NOT NULL;
-- ALTER TABLE account_payments ALTER COLUMN tenant_id SET NOT NULL;
-- ALTER TABLE return_items     ALTER COLUMN tenant_id SET NOT NULL;
-- ALTER TABLE purchase_items   ALTER COLUMN tenant_id SET NOT NULL;
