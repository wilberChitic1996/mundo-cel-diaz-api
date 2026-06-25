-- ============================================================
-- MIGRACIÓN 003 — Catálogos: Categorías y Ubicaciones (Estanterías)
-- Fecha: 2026-06-25
--
-- IMPORTANTE: Ejecutar en STAGING primero, luego en PRODUCCIÓN.
-- Todo es ADD/CREATE IF NOT EXISTS — seguro de re-ejecutar.
-- NO modifica ni borra datos existentes.
-- Las columnas viejas products.category y products.shelf SE CONSERVAN
-- (se usan como fuente para migrar datos; se eliminarán en una migración
--  futura SOLO cuando confirmes que todo quedó migrado).
--
-- MULTI-TENANT: cada tabla lleva tenant_id. Cada negocio ve solo SUS
-- categorías y SUS ubicaciones. Nunca se mezclan.
-- ============================================================

-- ============================================================
-- 1. CATEGORÍAS — catálogo cerrado administrable por el admin
-- ============================================================
CREATE TABLE IF NOT EXISTS categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  name        TEXT NOT NULL,
  icon        TEXT,                       -- emoji o nombre de icono (opcional)
  color       TEXT,                       -- color hex para la UI (opcional)
  sort_order  INTEGER NOT NULL DEFAULT 0, -- orden de visualización
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ
);
-- No se permite el mismo nombre de categoría dos veces dentro del mismo negocio
-- (case-insensitive: "Baterías" y "baterias" cuentan como la misma).
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_tenant_name
  ON categories (tenant_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_categories_tenant ON categories (tenant_id);

-- ============================================================
-- 2. UBICACIONES / ESTANTERÍAS — catálogo cerrado administrable
-- ============================================================
-- Estándar POS: el "mueble/estante" es la unidad administrable (rack,
-- vitrina, bodega). La POSICIÓN dentro del mueble (bandeja/gaveta) se
-- guarda por producto como texto corto (products.position), porque varía
-- mucho y no vale la pena catalogarla.
CREATE TABLE IF NOT EXISTS locations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  name        TEXT NOT NULL,              -- ej. "Vitrina 1", "Bodega", "Rack A"
  zone        TEXT,                       -- ej. "A" (mostrador), "B" (bodega) — opcional
  description TEXT,                       -- nota opcional
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_tenant_name
  ON locations (tenant_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_locations_tenant ON locations (tenant_id);

-- ============================================================
-- 3. PRODUCTS — referencias a los catálogos
-- ============================================================
-- category_id: reemplaza gradualmente a la columna de texto "category".
ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id);
-- location_id: el mueble/estante. Reemplaza gradualmente a "shelf".
ALTER TABLE products ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id);
-- position: bandeja/gaveta dentro del mueble (texto corto, ej. "B3", "A2-2").
ALTER TABLE products ADD COLUMN IF NOT EXISTS position TEXT;

CREATE INDEX IF NOT EXISTS idx_products_category_id ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_location_id ON products (location_id);

-- ============================================================
-- FIN DE MIGRACIÓN 003
--
-- SIGUIENTE PASO (script aparte, lo revisas antes):
--   003_data_migration.sql — mapea los valores viejos de cada negocio
--   (products.category / products.shelf en texto) hacia las nuevas
--   tablas categories/locations, usando tu tabla de equivalencias.
--   Se corre POR TENANT, nunca tocando data de un negocio sin aprobación.
-- ============================================================
