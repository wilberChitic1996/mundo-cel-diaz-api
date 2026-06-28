-- migrate:up

CREATE TABLE IF NOT EXISTS product_variants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku         TEXT,
  color       TEXT,
  capacity    TEXT,
  stock       INTEGER NOT NULL DEFAULT 0,
  price       NUMERIC(12,2),
  cost        NUMERIC(12,2),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_variants_tenant_product ON product_variants(tenant_id, product_id);

-- migrate:down

DROP TABLE IF EXISTS product_variants;
