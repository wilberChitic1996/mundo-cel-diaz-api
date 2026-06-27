-- Migration 006: Tabla para refresh tokens
-- Ejecutar en Supabase staging primero, luego en producción.

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash    ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user    ON refresh_tokens(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- Limpiar tokens expirados y revocados automáticamente (requiere pg_cron en Supabase)
-- SELECT cron.schedule('clean-refresh-tokens', '0 * * * *', $$
--   DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked_at IS NOT NULL;
-- $$);
