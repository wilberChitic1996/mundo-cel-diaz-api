-- migrate:up
-- B1/B4 — Función espejo de decrement_stock (016): suma stock de forma atómica
-- (SELECT ... FOR UPDATE). La usa la venta para COMPENSAR/revertir un descuento ya
-- aplicado si otro ítem falla (B1), y las compras para sumar stock sin race (B4).
-- Aditivo y seguro. Ya aplicada en staging y producción (con «cambia», 29 jun 2026).
CREATE OR REPLACE FUNCTION public.increment_stock(p_product_id uuid, p_qty integer, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE v_stock INTEGER;
BEGIN
  SELECT stock INTO v_stock FROM products
   WHERE id = p_product_id AND (p_tenant_id IS NULL OR tenant_id = p_tenant_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  UPDATE products SET stock = stock + p_qty, updated_at = NOW()
   WHERE id = p_product_id AND (p_tenant_id IS NULL OR tenant_id = p_tenant_id);
  RETURN v_stock + p_qty;
END; $function$;

-- migrate:down
DROP FUNCTION IF EXISTS public.increment_stock(uuid, integer, uuid);
