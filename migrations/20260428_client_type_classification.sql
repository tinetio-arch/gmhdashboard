-- Phase 3 (Hardening Plan v3) — Auto-classification scaffolding
--
-- Adds:
--   1. client_type_overrides — Phil-set manual overrides that the reconciler must respect
--   2. client_type_audit     — every change to patients.client_type_key, with source + evidence
--   3. patients.client_type_key_updated_at — companion timestamp
--
-- Idempotent: uses IF NOT EXISTS / IF NOT EXISTS-like guards.
-- No production writes happen until Phase 3.2 (Phil-approved dry-run cutover).

BEGIN;

-- 1. Override table
CREATE TABLE IF NOT EXISTS client_type_overrides (
    patient_id      UUID PRIMARY KEY REFERENCES patients(patient_id) ON DELETE CASCADE,
    type_key        TEXT NOT NULL REFERENCES client_type_lookup(type_key),
    reason          TEXT NOT NULL,
    set_by_user_id  UUID REFERENCES users(user_id),
    set_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_client_type_overrides_expires
    ON client_type_overrides(expires_at)
    WHERE expires_at IS NOT NULL;

-- 2. Audit log
CREATE TABLE IF NOT EXISTS client_type_audit (
    audit_id      BIGSERIAL PRIMARY KEY,
    patient_id    UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    from_value    TEXT,
    to_value      TEXT NOT NULL,
    source        TEXT NOT NULL CHECK (source IN ('reconciler', 'admin_api', 'override', 'manual', 'dry_run')),
    reason        TEXT,
    evidence      JSONB,
    confidence    TEXT CHECK (confidence IN ('high', 'medium', 'low')),
    was_skipped   BOOLEAN NOT NULL DEFAULT false,
    skip_reason   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_type_audit_patient
    ON client_type_audit(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_type_audit_source_created
    ON client_type_audit(source, created_at DESC);

-- 3. Companion timestamp on patients
ALTER TABLE patients
    ADD COLUMN IF NOT EXISTS client_type_key_updated_at TIMESTAMPTZ;

COMMIT;
