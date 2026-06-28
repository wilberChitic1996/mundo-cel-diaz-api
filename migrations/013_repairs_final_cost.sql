-- migrate:up

ALTER TABLE repairs
  ADD COLUMN IF NOT EXISTS final_cost NUMERIC(12,2);

-- migrate:down

ALTER TABLE repairs
  DROP COLUMN IF EXISTS final_cost;
