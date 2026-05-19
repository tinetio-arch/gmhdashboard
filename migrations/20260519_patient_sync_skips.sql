-- PHASE 6 (2026-05-19): patient_sync_skips — audit trail for every time a
-- downstream sync (Healthie today, GHL later) is SKIPPED rather than attempted.
--
-- WHY: The Healthie demographics sync gate previously hid an entire
-- client_type allowlist gate (NowMensHealth.Care + NowPrimary.Care only),
-- silently skipping ~83 Healthie-billed patients (NOWLongevity, Sick Visit,
-- PrimeCare Premier/Elite, Pro-Bono). The gate is now removed — every
-- Healthie-billed active patient ATTEMPTS sync. The skips that legitimately
-- remain (patient inactive, not Healthie-billed) must no longer be SILENT:
-- each one writes a row here with a machine-readable reason so /ops can see
-- exactly who is not propagating and why.
--
-- patient_id is patients.patient_id (UUID PK) — NOT an int. (The original
-- bundled brief specified `int REFERENCES patients(id)`; the live schema has
-- no `id` column and patient_id is a uuid, so this matches reality.)
CREATE TABLE IF NOT EXISTS patient_sync_skips (
    id            BIGSERIAL PRIMARY KEY,
    patient_id    UUID        NOT NULL REFERENCES patients(patient_id),
    target_system TEXT        NOT NULL,            -- 'healthie' | 'ghl'
    reason        TEXT        NOT NULL,            -- machine-readable reason code
    details       JSONB,                           -- optional context
    detected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_sync_skips_patient
    ON patient_sync_skips (patient_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_sync_skips_target
    ON patient_sync_skips (target_system, detected_at DESC);

COMMENT ON TABLE patient_sync_skips IS
    'Audit of skipped downstream demographic syncs. A row per skip with a reason code. SoT enforcement Phase 6 (2026-05-19).';
COMMENT ON COLUMN patient_sync_skips.reason IS
    'Machine-readable code, e.g. patient_inactive | not_healthie_billed.';
