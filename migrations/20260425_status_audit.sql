-- Phase 1.0 of Hardening Plan v3 — single-chokepoint status_key audit trail.
-- Additive: new column, new table, new trigger function, new trigger.
-- The trigger is the bypass-proof backstop: ANY UPDATE to patients.status_key
-- — whether through lib/status-transitions.ts or a rogue script — flows through
-- the rules and gets audited.
--
-- Apply with: psql ... -f migrations/20260425_status_audit.sql

BEGIN;

-- 1. Track when status_key last changed (set by trigger)
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS status_key_updated_at TIMESTAMP WITHOUT TIME ZONE;

-- 2. Audit table
CREATE TABLE IF NOT EXISTS patient_status_audit (
  audit_id        BIGSERIAL PRIMARY KEY,
  patient_id      UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  from_status     TEXT REFERENCES patient_status_lookup(status_key),
  to_status       TEXT REFERENCES patient_status_lookup(status_key),
  source          TEXT NOT NULL,            -- 'admin_api', 'webhook_processor', 'cron', 'script:<name>', 'unknown'
  actor           TEXT,                     -- user email or 'system'
  reason          TEXT,                     -- caller-supplied
  blocked         BOOLEAN NOT NULL DEFAULT FALSE,
  block_reason    TEXT,                     -- why rejected (if blocked)
  metadata        JSONB,
  created_at      TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS idx_patient_status_audit_patient
  ON patient_status_audit(patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_status_audit_to_status
  ON patient_status_audit(to_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_status_audit_blocked
  ON patient_status_audit(blocked, created_at DESC) WHERE blocked = TRUE;

-- 3. Trigger function — runs BEFORE UPDATE OF status_key on patients.
--    Reads caller context from session vars (set by lib/status-transitions.ts):
--      gmh.status_source, gmh.status_actor, gmh.status_reason, gmh.status_metadata
--    Enforces hard rules; on accepted transitions, logs audit + sets timestamp.
--    Blocked-pre-check audits are written by the helper itself BEFORE the
--    UPDATE (so they survive the rejection); the trigger only writes the
--    accepted-transition audit row.
CREATE OR REPLACE FUNCTION patient_status_audit_trigger() RETURNS TRIGGER AS $$
DECLARE
  v_source   TEXT;
  v_actor    TEXT;
  v_reason   TEXT;
  v_metadata JSONB;
BEGIN
  -- Only audit actual changes
  IF NEW.status_key IS NOT DISTINCT FROM OLD.status_key THEN
    RETURN NEW;
  END IF;

  v_source := COALESCE(NULLIF(current_setting('gmh.status_source', true), ''), 'unknown');
  v_actor  := NULLIF(current_setting('gmh.status_actor',  true), '');
  v_reason := NULLIF(current_setting('gmh.status_reason', true), '');
  BEGIN
    v_metadata := NULLIF(current_setting('gmh.status_metadata', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_metadata := NULL;
  END;

  -- Rule 1: webhook_processor cannot set inactive
  IF v_source = 'webhook_processor' AND NEW.status_key = 'inactive' THEN
    RAISE EXCEPTION 'patient_status_audit_trigger: webhook_processor cannot set status=inactive (patient %)', NEW.patient_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Rule 2: only admin_api or script:* can move OUT of inactive
  IF OLD.status_key = 'inactive'
     AND NEW.status_key IS DISTINCT FROM 'inactive'
     AND v_source <> 'admin_api'
     AND v_source NOT LIKE 'script:%' THEN
    RAISE EXCEPTION 'patient_status_audit_trigger: cannot move out of inactive via source=% (patient %)', v_source, NEW.patient_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Accepted transition: log it
  INSERT INTO patient_status_audit
    (patient_id, from_status, to_status, source, actor, reason, blocked, metadata)
  VALUES
    (NEW.patient_id, OLD.status_key, NEW.status_key, v_source, v_actor, v_reason, FALSE, v_metadata);

  NEW.status_key_updated_at := (NOW() AT TIME ZONE 'UTC');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_patient_status_audit ON patients;

CREATE TRIGGER trg_patient_status_audit
  BEFORE UPDATE OF status_key ON patients
  FOR EACH ROW
  WHEN (NEW.status_key IS DISTINCT FROM OLD.status_key)
  EXECUTE FUNCTION patient_status_audit_trigger();

COMMIT;
