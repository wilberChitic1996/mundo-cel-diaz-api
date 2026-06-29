-- 024_payment_webhooks_rls_fk.sql
-- D3: payment_webhooks (cobro recurrente, dormido) no tenía FK tenant_id -> tenants
-- ni política RLS. Se agregan ambos para que nazca blindada antes de activar A16.
-- Tabla vacía en ambas bases → riesgo nulo. Idempotente.
-- Aplicado a staging (aawjhttlaydwsipsifre) y prod (rhecnmfivygkayfvauxt) el 2026-06-29.

ALTER TABLE public.payment_webhooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.payment_webhooks;
CREATE POLICY tenant_isolation ON public.payment_webhooks
  FOR ALL
  USING ((tenant_id::text = (auth.jwt() ->> 'tenant_id')) OR ((auth.jwt() ->> 'role') = 'superadmin'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='payment_webhooks' AND constraint_name='payment_webhooks_tenant_id_fkey'
  ) THEN
    ALTER TABLE public.payment_webhooks
      ADD CONSTRAINT payment_webhooks_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
  END IF;
END $$;
