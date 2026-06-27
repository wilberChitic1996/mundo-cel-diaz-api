-- Migration 007: Tabla para suscripciones push (Web Push / PWA)
-- Ejecutar en Supabase staging primero, luego en producción.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth_key    TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subs_tenant ON push_subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_push_subs_user   ON push_subscriptions(tenant_id, user_id);

-- Variables de entorno requeridas en Railway (ambos proyectos):
-- VAPID_PUBLIC_KEY   = BIjYtF8qfNvyycwBbJ6iZen_ocKkoPy24wgyoQHd67Rh1CW7152SJbFQwXZraVBYIuXk_E-wDnPPKbFXh1nUeJI
-- VAPID_PRIVATE_KEY  = Kp--SARiU7GCPCTcBaEjLyjAwLFAVHUe8_E_Bsz-Ze8
-- VAPID_EMAIL        = admin@mundoceldiaz.com
