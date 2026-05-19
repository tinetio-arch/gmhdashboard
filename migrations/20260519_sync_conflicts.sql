-- PHASE 3 (2026-05-19): sync_conflicts — structured record of every time an
-- external system (Healthie today, GHL later) reports a demographic value that
-- DIFFERS from the /ops value, where /ops already has a value.
--
-- SoT direction (Phil-approved): /ops + /ipad + /mobile are the source of truth
-- for patient demographics. The inbound Healthie webhook MUST NOT overwrite a
-- populated /ops field. Instead it logs the disagreement here for human review.
-- (Where the /ops field is NULL, the webhook may still backfill it — that is not
-- a conflict.)
--
-- This SUPERSEDES the additive agent_action_log 'patient_divergence' breadcrumb
-- that the webhook used to write before its COALESCE update. That write is
-- removed in this same change; sync_conflicts is now the structured truth.
--
-- patient_id is patients.patient_id (UUID PK) — NOT an int (the bundled brief
-- specified `int REFERENCES patients(id)`, but the live schema has no `id`
-- column and patient_id is a uuid).
CREATE TABLE IF NOT EXISTS sync_conflicts (
    id                BIGSERIAL PRIMARY KEY,
    patient_id        UUID        NOT NULL REFERENCES patients(patient_id),
    source_system     TEXT        NOT NULL,                 -- 'healthie' | 'ghl'
    field_name        TEXT        NOT NULL,                 -- patients column name
    ops_value         TEXT,                                 -- value /ops holds (kept)
    external_value    TEXT,                                 -- value the source sent (rejected)
    detected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolution_status TEXT        NOT NULL DEFAULT 'pending' -- pending | ops-wins | external-wins | reviewed
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status
    ON sync_conflicts (resolution_status, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_patient
    ON sync_conflicts (patient_id);

COMMENT ON TABLE sync_conflicts IS
    'External system disagreed with a populated /ops demographic field; /ops kept. SoT enforcement Phase 3 (2026-05-19).';
COMMENT ON COLUMN sync_conflicts.resolution_status IS
    'pending | ops-wins | external-wins | reviewed. Default pending; action UI comes later.';
