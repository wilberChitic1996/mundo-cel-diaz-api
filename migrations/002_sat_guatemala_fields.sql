-- ============================================================
-- MIGRACIÓN 002 — Campos SAT Guatemala + Estándares POS
-- Fecha: 2026-06-25
--
-- IMPORTANTE: Ejecutar en staging primero, luego en producción.
-- Todos los ALTER son ADD COLUMN IF NOT EXISTS — seguros de re-ejecutar.
-- NO modifica datos existentes, solo agrega columnas opcionales.
-- ============================================================

-- ============================================================
-- 1. TENANTS — datos fiscales del negocio
-- ============================================================
-- NIT del negocio (requerido para emitir facturas FEL)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nit TEXT;
-- Dirección fiscal (aparece en facturas)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address TEXT;
-- Régimen SAT: 'pequeno' = Pequeño Contribuyente, 'general' = Régimen General
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sat_regime TEXT DEFAULT 'pequeno';
-- Moneda (ISO 4217): 'GTQ' para Quetzal guatemalteco
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'GTQ';
-- Nombre fiscal/razón social (puede diferir del nombre del negocio)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS fiscal_name TEXT;

-- ============================================================
-- 2. CLIENTS — NIT del cliente para facturas FEL
-- ============================================================
-- NIT del cliente (distinto al DPI — DPI es identificación, NIT es tributario)
-- 'CF' = Consumidor Final (cuando el cliente no tiene NIT)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS nit TEXT;
-- email del cliente (para enviar facturas electrónicas)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email TEXT;

-- ============================================================
-- 3. SUPPLIERS — NIT del proveedor
-- ============================================================
-- NIT del proveedor (para registros de compras en Libro SAT)
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS nit TEXT;

-- ============================================================
-- 4. SALES — referencia al cliente y NIT para FEL
-- ============================================================
-- client_id: FK a tabla clients (antes solo guardaba nombre en text)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
-- NIT del cliente en el momento de la venta (snapshot para FEL)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_nit TEXT;
-- Número de serie FEL (cuando se emita la factura electrónica)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS fel_serie TEXT;
-- Número de autorización FEL (UUID devuelto por SAT/certificador)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS fel_numero TEXT;
-- Estado FEL: NULL = no emitida, 'emitida' = certificada, 'anulada' = anulada
ALTER TABLE sales ADD COLUMN IF NOT EXISTS fel_status TEXT;

-- ============================================================
-- 5. ACCOUNTS — referencia al cliente
-- ============================================================
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);

-- ============================================================
-- 6. REPAIRS — NIT del cliente para garantías y facturas
-- ============================================================
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS client_nit TEXT;

-- ============================================================
-- 7. ÍNDICES nuevos
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sales_client_id    ON sales(client_id);
CREATE INDEX IF NOT EXISTS idx_accounts_client_id ON accounts(client_id);
CREATE INDEX IF NOT EXISTS idx_clients_nit        ON clients(nit);
CREATE INDEX IF NOT EXISTS idx_suppliers_nit      ON suppliers(nit);

-- ============================================================
-- FIN DE MIGRACIÓN 002
--
-- SCRIPTS DE DATOS (ejecutar DESPUÉS de correr esta migración):
-- Ver archivo 002_data_migration.sql para:
--   - Normalizar unidades ("Unidad" → "uni") en datos existentes
--   - Normalizar categorías (TRIM, titleCase)
--   - Asignar CF como NIT por defecto en ventas sin NIT
-- ============================================================
