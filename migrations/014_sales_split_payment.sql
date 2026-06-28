-- migrate:up

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS second_method TEXT,
  ADD COLUMN IF NOT EXISTS second_amount NUMERIC(12,2);

-- migrate:down

ALTER TABLE sales
  DROP COLUMN IF EXISTS second_method,
  DROP COLUMN IF EXISTS second_amount;
