-- 027_caja_sesion_unica.sql
-- Ronda C de auditoría: evita que un tenant tenga DOS sesiones de caja abiertas
-- a la vez (carrera check-then-insert en POST /api/caja/abrir).
-- Índice único PARCIAL: solo aplica a sesiones abiertas (closed_at IS NULL).
--
-- ⚠️ ANTES de aplicar, verificar que no existan dobles sesiones abiertas ya:
--   SELECT tenant_id, count(*) FROM caja_sesiones
--   WHERE closed_at IS NULL GROUP BY tenant_id HAVING count(*) > 1;
-- Si devuelve filas, cerrar las duplicadas primero (UPDATE ... SET closed_at = now()).

-- UP
CREATE UNIQUE INDEX IF NOT EXISTS caja_sesiones_una_abierta_por_tenant
  ON caja_sesiones (tenant_id)
  WHERE closed_at IS NULL;

-- DOWN (revertir):
-- DROP INDEX IF EXISTS caja_sesiones_una_abierta_por_tenant;
