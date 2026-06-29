-- migrate:up
-- Auditoría de webhooks de cobro recurrente (Recurrente/Stripe/etc.). "El vagón" de A16:
-- el endpoint POST /api/webhooks/payment registra acá cada evento recibido (firma válida o no,
-- procesado/ignorado/error) para trazabilidad. Multi-tenant (tenant_id viene del payload de la
-- pasarela). RLS activo: el API usa service_role (bypassa); nadie más accede.
-- Seguro/idempotente: IF NOT EXISTS no rompe nada si ya existe.

CREATE TABLE IF NOT EXISTS payment_webhooks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid,
  provider        text,
  event_type      text,
  event_id        text,
  status          text NOT NULL DEFAULT 'received',  -- received | processed | ignored | error
  amount          numeric,
  signature_valid boolean,
  raw_payload     jsonb,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_webhooks_tenant ON payment_webhooks(tenant_id, created_at DESC);
-- Evita procesar/registrar dos veces el mismo evento de la pasarela.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_webhooks_event ON payment_webhooks(provider, event_id) WHERE event_id IS NOT NULL;
ALTER TABLE payment_webhooks ENABLE ROW LEVEL SECURITY;

-- migrate:down
DROP TABLE IF EXISTS payment_webhooks;
