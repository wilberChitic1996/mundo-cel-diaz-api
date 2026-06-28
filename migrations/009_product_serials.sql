-- migrate:up

-- Tabla de números de serie / IMEI para productos individuales (equipos)
CREATE TABLE IF NOT EXISTS product_serials (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id    UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  imei          VARCHAR(20) NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'disponible'
                            CHECK (status IN ('disponible', 'vendido', 'defectuoso', 'devuelto')),
  sale_id       UUID        REFERENCES sales(id) ON DELETE SET NULL,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- IMEI único por tenant (mismo IMEI no puede existir dos veces en el mismo negocio)
CREATE UNIQUE INDEX IF NOT EXISTS product_serials_imei_tenant_idx
  ON product_serials (tenant_id, imei);

-- Búsqueda rápida por producto
CREATE INDEX IF NOT EXISTS product_serials_product_idx
  ON product_serials (tenant_id, product_id, status);

-- Búsqueda rápida por venta (para vincular al devolver)
CREATE INDEX IF NOT EXISTS product_serials_sale_idx
  ON product_serials (tenant_id, sale_id)
  WHERE sale_id IS NOT NULL;

-- RLS
ALTER TABLE product_serials ENABLE ROW LEVEL SECURITY;

-- migrate:down

DROP TABLE IF EXISTS product_serials CASCADE;
