-- migrate:up
-- A1/A15 — Versiona la función decrement_stock ROBUSTA (FOR UPDATE + validación) que ya
-- está aplicada en vivo en ambos ambientes, y elimina el overload legacy de 2 argumentos
-- (sin filtro de tenant) que es un riesgo multi-tenant y ya no se usa (el API llama siempre
-- a la versión de 3 args). Copia EXACTA del definition vivo en staging (verificado 29 jun).

CREATE OR REPLACE FUNCTION public.decrement_stock(p_product_id uuid, p_qty integer, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE v_stock INTEGER;
BEGIN
  SELECT stock INTO v_stock FROM products
   WHERE id = p_product_id AND (p_tenant_id IS NULL OR tenant_id = p_tenant_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  IF v_stock < p_qty THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK:% disponible,% solicitado', v_stock, p_qty; END IF;
  UPDATE products SET stock = stock - p_qty, updated_at = NOW()
   WHERE id = p_product_id AND (p_tenant_id IS NULL OR tenant_id = p_tenant_id);
  RETURN v_stock - p_qty;
END; $function$;

-- Eliminar el overload legacy de 2 argumentos (sin tenant): riesgo multi-tenant, sin uso.
DROP FUNCTION IF EXISTS public.decrement_stock(uuid, integer);

-- migrate:down
-- Revertir al estado anterior: versión plana de 3 args (000_full_schema) + recrear overload.

CREATE OR REPLACE FUNCTION public.decrement_stock(p_product_id uuid, p_qty integer, p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE products SET stock = stock - p_qty, updated_at = NOW()
   WHERE id = p_product_id AND tenant_id = p_tenant_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.decrement_stock(p_id uuid, p_qty integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE products SET stock = stock - p_qty WHERE id = p_id AND stock >= p_qty;
END; $function$;
