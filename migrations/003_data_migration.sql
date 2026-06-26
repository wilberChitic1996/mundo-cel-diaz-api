-- ============================================================
-- MIGRACIÓN DE DATOS 003 — Categorías a la tabla nueva (POR NEGOCIO)
-- Fecha: 2026-06-25
--
-- QUÉ HACE:
--   1. Crea en la tabla `categories` una fila por cada categoría de
--      texto que ya existe en los productos del negocio (normalizada).
--   2. Enlaza cada producto a su categoría (products.category_id).
--
-- QUÉ NO HACE (a propósito):
--   - NO toca el STOCK de ningún producto.   ← stock se respeta intacto
--   - NO toca precios, costos ni nombres.
--   - NO migra estanterías/ubicaciones (el negocio las reingresa a mano
--     desde la pantalla "Catálogos" con el nuevo sistema).
--   - NO toca el tenant MUNDO CEL DIAZ.
--
-- CÓMO USARLO:
--   Reemplaza :TENANT abajo por el tenant_id del negocio de Dennis.
--   Ejecutar PRIMERO en STAGING, verificar, luego en PRODUCCIÓN.
--   Es idempotente: se puede re-ejecutar sin duplicar.
-- ============================================================

-- Seguridad: definimos el tenant objetivo en una sola línea.
-- >>> EDITA AQUÍ el tenant_id del negocio de Dennis <<<
\set TARGET_TENANT '00000000-0000-0000-0000-000000000000'

-- Protección dura: nunca correr sobre MUNDO CEL DIAZ.
DO $$
BEGIN
  IF :'TARGET_TENANT' = '00000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'BLOQUEADO: este script no debe correr sobre el tenant MUNDO CEL DIAZ';
  END IF;
  IF :'TARGET_TENANT' = '00000000-0000-0000-0000-000000000000' THEN
    RAISE EXCEPTION 'Falta configurar TARGET_TENANT con el tenant_id real de Dennis';
  END IF;
END $$;

-- 1) Crear categorías a partir del texto existente (TRIM + sin duplicar)
--    Se ignora vacío/nulo. El índice único (tenant_id, lower(name)) evita
--    duplicados; ON CONFLICT DO NOTHING lo hace re-ejecutable.
INSERT INTO categories (tenant_id, name)
SELECT DISTINCT :'TARGET_TENANT'::uuid, INITCAP(TRIM(p.category))
FROM products p
WHERE p.tenant_id = :'TARGET_TENANT'::uuid
  AND p.category IS NOT NULL
  AND TRIM(p.category) <> ''
ON CONFLICT (tenant_id, lower(name)) DO NOTHING;

-- 2) Enlazar cada producto a su categoría (match case-insensitive por nombre)
UPDATE products p
SET category_id = c.id
FROM categories c
WHERE p.tenant_id = :'TARGET_TENANT'::uuid
  AND c.tenant_id = :'TARGET_TENANT'::uuid
  AND p.category IS NOT NULL
  AND lower(TRIM(p.category)) = lower(c.name)
  AND p.category_id IS DISTINCT FROM c.id;   -- solo si cambia (idempotente)

-- 3) Verificación (no modifica nada) — revisar el resultado:
--    SELECT name, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS productos
--    FROM categories c WHERE c.tenant_id = :'TARGET_TENANT'::uuid ORDER BY name;
--    -- Productos sin categoría asignada (revisar manualmente si hay):
--    SELECT id, name, category FROM products
--    WHERE tenant_id = :'TARGET_TENANT'::uuid AND category_id IS NULL;

-- ============================================================
-- FIN. El STOCK quedó intacto. Las estanterías se reingresan a mano.
-- ============================================================
