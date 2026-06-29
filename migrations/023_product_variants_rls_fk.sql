-- 023_product_variants_rls_fk.sql
-- D2: product_variants tenía RLS activado pero SIN política (bloqueaba todo acceso
-- que no fuera service_role) y no tenía FK tenant_id -> tenants. Se agrega la política
-- tenant_isolation (idéntica a products) y el FK de negocio. Idempotente, no toca datos.
-- Aplicado a staging (aawjhttlaydwsipsifre) y prod (rhecnmfivygkayfvauxt) el 2026-06-29.

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.product_variants;
CREATE POLICY tenant_isolation ON public.product_variants
  FOR ALL
  USING ((tenant_id::text = (auth.jwt() ->> 'tenant_id')) OR ((auth.jwt() ->> 'role') = 'superadmin'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='product_variants' AND constraint_name='product_variants_tenant_id_fkey'
  ) THEN
    ALTER TABLE public.product_variants
      ADD CONSTRAINT product_variants_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
  END IF;
END $$;
