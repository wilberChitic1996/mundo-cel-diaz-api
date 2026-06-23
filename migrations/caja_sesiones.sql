-- Sesiones de caja (apertura / cierre)
CREATE TABLE IF NOT EXISTS caja_sesiones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fondo_inicial NUMERIC(10,2) NOT NULL DEFAULT 0,
  nota_apertura TEXT,
  opened_by     TEXT NOT NULL,
  opened_role   TEXT NOT NULL,
  closed_at     TIMESTAMPTZ,
  closed_by     TEXT,
  closed_role   TEXT,
  efectivo_contado NUMERIC(10,2),
  nota_cierre   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Gastos de caja (salidas manuales)
CREATE TABLE IF NOT EXISTS caja_gastos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sesion_id        UUID REFERENCES caja_sesiones(id) ON DELETE SET NULL,
  concepto         TEXT NOT NULL,
  monto            NUMERIC(10,2) NOT NULL,
  categoria        TEXT NOT NULL DEFAULT 'general',
  registrado_por   TEXT NOT NULL,
  registrado_role  TEXT NOT NULL DEFAULT 'cajero',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_caja_sesiones_closed ON caja_sesiones(closed_at);
CREATE INDEX IF NOT EXISTS idx_caja_gastos_sesion   ON caja_gastos(sesion_id);
