-- migrate:up

-- Agregar campos de checklist de recepción y fotos a la tabla de reparaciones
ALTER TABLE repairs
  ADD COLUMN IF NOT EXISTS reception_checklist JSONB,
  ADD COLUMN IF NOT EXISTS reception_photos     TEXT[],
  ADD COLUMN IF NOT EXISTS delivery_photos      TEXT[];

-- Índice para búsqueda por estado de checklist (útil para reportes futuros)
CREATE INDEX IF NOT EXISTS repairs_checklist_idx
  ON repairs (tenant_id)
  WHERE reception_checklist IS NOT NULL;

-- migrate:down

ALTER TABLE repairs
  DROP COLUMN IF EXISTS reception_checklist,
  DROP COLUMN IF EXISTS reception_photos,
  DROP COLUMN IF EXISTS delivery_photos;
