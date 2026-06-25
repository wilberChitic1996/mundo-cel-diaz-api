-- ============================================================
-- MIGRACIÓN DE DATOS 002 — Normalización de datos existentes
-- Fecha: 2026-06-25
--
-- REVISAR antes de ejecutar. Ejecutar en staging primero.
-- Estos scripts modifican datos existentes.
--
-- TENANT OBJETIVO: 00000000-0000-0000-0000-000000000001 (Mundo Cel Diaz)
-- ============================================================

-- ============================================================
-- A. UNIDADES — normalizar "Unidad" largo → "uni"
--
-- Análisis del Excel: todos los 116 productos tienen "Unidad"
-- pero el sistema ahora usa: uni | pza | serv
-- Los artículos son repuestos físicos → "pza" (pieza) es más preciso
-- pero para no perder la intención original → "uni"
-- ============================================================

-- Ver qué unidades existen antes de cambiar:
-- SELECT unit, COUNT(*) FROM products WHERE tenant_id = '00000000-0000-0000-0000-000000000001' GROUP BY unit;

UPDATE products
SET unit = 'uni', updated_at = NOW()
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND LOWER(TRIM(unit)) IN ('unidad', 'uni', 'unidades', 'u', 'und');

-- Pantallas y baterías son "pza" técnicamente, pero dejamos "uni" para consistencia.
-- Si en el futuro quieren cambiar a "pza", es un UPDATE puntual por categoría.

-- ============================================================
-- B. CATEGORÍAS — normalizar TRIM + titleCase
--
-- Del análisis SQL previo, se detectaron:
--   "Bateria " (con espacio al final) ≠ "Bateria"
--   "Pantalla" y "Pantallas" (singular vs plural)
-- Ya se corrigió el TRIM en sesión anterior.
-- Este script asegura consistencia si quedan más casos.
-- ============================================================

-- Corregir TRIM en categorías (cualquier espacio al inicio/fin):
UPDATE products
SET category = TRIM(category), updated_at = NOW()
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND (category != TRIM(category));

-- Plurales → singulares estándar (solo los detectados en los datos):
UPDATE products
SET category = 'Pantalla', updated_at = NOW()
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND LOWER(TRIM(category)) = 'pantallas';

UPDATE products
SET category = 'Batería', updated_at = NOW()
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND LOWER(TRIM(category)) IN ('bateria', 'baterias', 'batería', 'baterías');

-- ============================================================
-- C. NOMBRES DE PRODUCTOS — TRIM + primera letra mayúscula
-- (titleCase básico — solo capitaliza la primera letra del nombre)
-- ============================================================

UPDATE products
SET name = TRIM(name), updated_at = NOW()
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND name != TRIM(name);

-- Capitalizar primera letra del nombre (si está en minúscula):
UPDATE products
SET name = UPPER(LEFT(TRIM(name),1)) || LOWER(SUBSTRING(TRIM(name),2)), updated_at = NOW()
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND name != UPPER(LEFT(TRIM(name),1)) || LOWER(SUBSTRING(TRIM(name),2))
  AND name IS NOT NULL
  AND name != '';

-- ============================================================
-- D. CÓDIGOS — UPPERCASE + TRIM
-- ============================================================

UPDATE products
SET code = UPPER(TRIM(code)), updated_at = NOW()
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND code IS NOT NULL
  AND code != UPPER(TRIM(code));

-- ============================================================
-- E. ESTANTERÍA — UPPERCASE + TRIM
-- ============================================================

UPDATE products
SET shelf = UPPER(TRIM(shelf)), updated_at = NOW()
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND shelf IS NOT NULL
  AND shelf != ''
  AND shelf != UPPER(TRIM(shelf));

-- ============================================================
-- F. VENTAS SIN NIT — asignar 'CF' (Consumidor Final)
--
-- Las 3 ventas existentes no tienen NIT. Según estándar SAT,
-- si no se emite factura con NIT, se registra como CF.
-- ============================================================

UPDATE sales
SET client_nit = 'CF'
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND client_nit IS NULL;

-- ============================================================
-- G. CONFIGURACIÓN DE TIENDA — tenant Mundo Cel Diaz
--
-- ATENCIÓN: Revisar estos valores con el dueño antes de ejecutar.
-- El NIT real de Dennis Chitic debe ir aquí.
-- Por ahora dejamos placeholder para que se complete.
-- ============================================================

-- NOTA: No ejecutar esta sección hasta confirmar el NIT real con el usuario.
-- Descomentar cuando tengas el NIT del negocio:
/*
UPDATE tenants
SET
  nit = 'XXXXXXX-X',          -- NIT real del negocio
  fiscal_name = 'MUNDO CEL DIAZ',
  address = 'Guatemala',       -- Dirección fiscal real
  sat_regime = 'pequeno',
  currency = 'GTQ'
WHERE id = '00000000-0000-0000-0000-000000000001';
*/

-- ============================================================
-- VERIFICACIÓN — ejecutar estas queries para confirmar cambios:
-- ============================================================

-- SELECT category, COUNT(*) FROM products WHERE tenant_id = '00000000-0000-0000-0000-000000000001' GROUP BY category ORDER BY category;
-- SELECT unit, COUNT(*) FROM products WHERE tenant_id = '00000000-0000-0000-0000-000000000001' GROUP BY unit;
-- SELECT client_nit, COUNT(*) FROM sales WHERE tenant_id = '00000000-0000-0000-0000-000000000001' GROUP BY client_nit;
