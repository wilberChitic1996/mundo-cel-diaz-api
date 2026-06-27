-- Migration 008: tabla backups para snapshots automáticos por tenant
-- Aplicar en Supabase staging PRIMERO, luego en producción

CREATE TABLE IF NOT EXISTS backups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  size_bytes      BIGINT,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | success | failed
  type            TEXT NOT NULL DEFAULT 'auto',      -- auto | manual
  storage_path    TEXT,
  error_msg       TEXT,
  tables_included TEXT[],
  record_counts   JSONB
);

CREATE INDEX IF NOT EXISTS idx_backups_tenant ON backups(tenant_id, created_at DESC);
