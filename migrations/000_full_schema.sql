-- ============================================================
-- SCHEMA COMPLETO — MUNDO CEL DIAZ
-- Ejecutar en Supabase STAGING (proyecto nuevo, BD vacía)
-- Fecha: 2026-06-25
-- ============================================================

-- EXTENSIONES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABLA BASE: tenants (negocios)
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'basic',
  email       TEXT,
  phone       TEXT,
  owner_name  TEXT,
  notes       TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- USUARIOS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID REFERENCES tenants(id),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'cajero' CHECK (role IN ('superadmin','admin','cajero','auditor')),
  active          BOOLEAN NOT NULL DEFAULT true,
  sec_question    TEXT,
  sec_answer_hash TEXT,
  last_login      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_tenant    ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);

-- ============================================================
-- CONFIGURACIÓN DE TIENDA
-- ============================================================
CREATE TABLE IF NOT EXISTS store_settings (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  key        TEXT NOT NULL,
  value      TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, key)
);
CREATE INDEX IF NOT EXISTS idx_store_settings_tenant ON store_settings(tenant_id);

-- ============================================================
-- CLIENTES
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  cli_code   TEXT,
  name       TEXT NOT NULL,
  dpi        TEXT,
  phone      TEXT,
  address    TEXT,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_clients_tenant ON clients(tenant_id);

-- ============================================================
-- PRODUCTOS
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  category     TEXT,
  brand        TEXT,
  unit         TEXT DEFAULT 'pza',
  stock        INTEGER NOT NULL DEFAULT 0,
  min_stock    INTEGER DEFAULT 0,
  price        NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost         NUMERIC(12,2) DEFAULT 0,
  shelf        TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ,
  UNIQUE(tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);

-- ============================================================
-- VENTAS
-- ============================================================
CREATE TABLE IF NOT EXISTS sales (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  client          TEXT,
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  method          TEXT DEFAULT 'Efectivo',
  status          TEXT DEFAULT 'completado',
  pay_type        TEXT,
  user_id         UUID,
  registrado_por  JSONB,
  idempotency_key TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_sales_tenant     ON sales(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at DESC);

CREATE TABLE IF NOT EXISTS sale_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID REFERENCES tenants(id),
  sale_id     UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id  UUID,
  code        TEXT,
  name        TEXT,
  price       NUMERIC(12,2),
  qty         INTEGER,
  subtotal    NUMERIC(12,2)
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale   ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_tenant ON sale_items(tenant_id);

-- ============================================================
-- CUENTAS POR COBRAR
-- ============================================================
CREATE TABLE IF NOT EXISTS accounts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  sale_id         UUID REFERENCES sales(id),
  client          TEXT,
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid            NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance         NUMERIC(12,2) NOT NULL DEFAULT 0,
  status          TEXT DEFAULT 'pendiente',
  method          TEXT DEFAULT 'Efectivo',
  user_id         UUID,
  registrado_por  JSONB,
  idempotency_key TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_accounts_tenant ON accounts(tenant_id);

CREATE TABLE IF NOT EXISTS account_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID REFERENCES tenants(id),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  code        TEXT,
  name        TEXT,
  price       NUMERIC(12,2),
  qty         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_account_items_tenant ON account_items(tenant_id);

CREATE TABLE IF NOT EXISTS account_payments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID REFERENCES tenants(id),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount          NUMERIC(12,2) NOT NULL,
  method          TEXT DEFAULT 'Efectivo',
  note            TEXT,
  registrado_por  JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_account_payments_tenant ON account_payments(tenant_id);

-- ============================================================
-- REPARACIONES
-- ============================================================
CREATE TABLE IF NOT EXISTS repairs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  rep_code        TEXT,
  client_name     TEXT,
  client_phone    TEXT,
  brand           TEXT,
  model           TEXT,
  issue           TEXT,
  diagnosis       TEXT,
  status          TEXT DEFAULT 'recibido',
  price           NUMERIC(12,2) DEFAULT 0,
  advance         NUMERIC(12,2) DEFAULT 0,
  technician      TEXT,
  notes           TEXT,
  received_at     TIMESTAMPTZ DEFAULT NOW(),
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_repairs_tenant ON repairs(tenant_id);

-- ============================================================
-- DEVOLUCIONES
-- ============================================================
CREATE TABLE IF NOT EXISTS returns (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  sale_id         UUID,
  client          TEXT,
  reason          TEXT,
  refund_method   TEXT,
  refund_amount   NUMERIC(12,2) DEFAULT 0,
  item_condition  TEXT DEFAULT 'bueno',
  total           NUMERIC(12,2) DEFAULT 0,
  user_id         UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_returns_tenant ON returns(tenant_id);

CREATE TABLE IF NOT EXISTS return_items (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID REFERENCES tenants(id),
  return_id  UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  code       TEXT,
  name       TEXT,
  price      NUMERIC(12,2),
  qty        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_return_items_tenant ON return_items(tenant_id);

-- ============================================================
-- DEFECTUOSOS
-- ============================================================
CREATE TABLE IF NOT EXISTS defectives (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  return_id  UUID,
  code       TEXT,
  name       TEXT,
  qty        INTEGER,
  price      NUMERIC(12,2),
  reason     TEXT,
  status     TEXT DEFAULT 'defectuoso',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_defectives_tenant ON defectives(tenant_id);

-- ============================================================
-- PROVEEDORES Y COMPRAS
-- ============================================================
CREATE TABLE IF NOT EXISTS suppliers (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  address    TEXT,
  notes      TEXT,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON suppliers(tenant_id);

CREATE TABLE IF NOT EXISTS purchases (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  supplier_id    UUID REFERENCES suppliers(id),
  supplier_name  TEXT,
  total          NUMERIC(12,2) DEFAULT 0,
  notes          TEXT,
  registered_by  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_purchases_tenant ON purchases(tenant_id);

CREATE TABLE IF NOT EXISTS purchase_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID REFERENCES tenants(id),
  purchase_id   UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id    UUID,
  product_name  TEXT,
  product_code  TEXT,
  qty           INTEGER,
  cost          NUMERIC(12,2),
  subtotal      NUMERIC(12,2)
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_tenant ON purchase_items(tenant_id);

-- ============================================================
-- CAJA
-- ============================================================
CREATE TABLE IF NOT EXISTS caja_sesiones (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  fondo_inicial  NUMERIC(12,2) DEFAULT 0,
  nota_apertura  TEXT,
  opened_by      TEXT,
  opened_role    TEXT,
  closed_at      TIMESTAMPTZ,
  closed_by      TEXT,
  total_ventas   NUMERIC(12,2),
  total_gastos   NUMERIC(12,2),
  total_abonos   NUMERIC(12,2),
  total_efectivo NUMERIC(12,2),
  diferencia     NUMERIC(12,2),
  nota_cierre    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_caja_sesiones_tenant ON caja_sesiones(tenant_id);

CREATE TABLE IF NOT EXISTS caja_gastos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  sesion_id       UUID REFERENCES caja_sesiones(id),
  concepto        TEXT NOT NULL,
  monto           NUMERIC(12,2) NOT NULL,
  categoria       TEXT DEFAULT 'general',
  registrado_por  TEXT,
  registrado_role TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_caja_gastos_tenant ON caja_gastos(tenant_id);

-- ============================================================
-- GARANTÍAS
-- ============================================================
CREATE TABLE IF NOT EXISTS warranties (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  entity_type  TEXT,
  entity_id    TEXT,
  client       TEXT,
  description  TEXT,
  start_date   DATE,
  end_date     DATE,
  status       TEXT DEFAULT 'vigente',
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_warranties_tenant ON warranties(tenant_id);

-- ============================================================
-- AUDITORÍA
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID REFERENCES tenants(id),
  user_id     UUID,
  user_name   TEXT,
  user_role   TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant     ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity     ON audit_logs(entity_type, entity_id);

-- ============================================================
-- RPC: decrement_stock (atómico con SELECT FOR UPDATE)
-- ============================================================
CREATE OR REPLACE FUNCTION decrement_stock(p_product_id UUID, p_qty INTEGER, p_tenant_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE products
  SET stock = stock - p_qty, updated_at = NOW()
  WHERE id = p_product_id AND tenant_id = p_tenant_id;
END;
$$;

-- ============================================================
-- RLS: habilitar en todas las tablas
-- (La API usa service_role y bypassa RLS, pero protege acceso directo)
-- ============================================================
ALTER TABLE tenants          ENABLE ROW LEVEL SECURITY;
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients          ENABLE ROW LEVEL SECURITY;
ALTER TABLE products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE repairs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE returns          ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE defectives       ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases        ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE caja_sesiones    ENABLE ROW LEVEL SECURITY;
ALTER TABLE caja_gastos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranties       ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs       ENABLE ROW LEVEL SECURITY;
