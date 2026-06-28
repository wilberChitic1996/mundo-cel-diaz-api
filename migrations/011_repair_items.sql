-- migrate:up

CREATE TABLE IF NOT EXISTS repair_items (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  repair_id   UUID          NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
  product_id  UUID          REFERENCES products(id) ON DELETE SET NULL,
  code        TEXT          NOT NULL,
  name        TEXT          NOT NULL,
  qty         INTEGER       NOT NULL DEFAULT 1 CHECK (qty > 0),
  cost        NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal    NUMERIC(12,2) GENERATED ALWAYS AS (qty * cost) STORED,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS repair_items_repair_idx ON repair_items (tenant_id, repair_id);
CREATE INDEX IF NOT EXISTS repair_items_product_idx ON repair_items (tenant_id, product_id) WHERE product_id IS NOT NULL;

ALTER TABLE repair_items ENABLE ROW LEVEL SECURITY;

-- migrate:down

DROP TABLE IF EXISTS repair_items CASCADE;
