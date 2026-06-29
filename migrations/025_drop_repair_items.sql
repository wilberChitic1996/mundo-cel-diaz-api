-- 025_drop_repair_items.sql
-- D5: repair_items era un dead-write — se escribía al crear/editar reparación pero
-- nadie la leía (la app usa repairs.parts jsonb). Cada fila era copia de datos que
-- siguen vivos en repairs.parts, así que no se pierde nada. Se quitó el doble-guardado
-- en routes/repairs.js y se saca de la lista de borrado de negocio en routes/admin.js.
-- Se ejecuta DESPUÉS de desplegar ese código (el insert previo era tolerante a fallos).
-- Aplicado a staging (aawjhttlaydwsipsifre) y prod (rhecnmfivygkayfvauxt) el 2026-06-29.

DROP TABLE IF EXISTS public.repair_items;
