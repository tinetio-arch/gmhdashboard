-- Phase 5b: patient_signals_cache
-- Per docs/sot-modules/25-patient-classification-and-dashboard.md §5.1 (📋 Intake signal).
-- Caches Healthie-derived signals that are too slow to compute at page-load time
-- (would require 400+ live GraphQL calls otherwise).
--
-- Populated by scripts/refresh-intake-signals.js (run nightly via cron).
-- Read by lib/patientSignals.ts when rendering the /patients Signals column.
--
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS patient_signals_cache (
  patient_id       UUID PRIMARY KEY REFERENCES patients(patient_id) ON DELETE CASCADE,
  -- Intake (Healthie onboarding + form completion)
  intake_state     TEXT NULL,          -- 'good' | 'warn' | 'bad' | 'none'
  intake_any_incomplete   BOOLEAN NULL,
  intake_forms_finished   INTEGER NULL,
  intake_forms_total      INTEGER NULL,
  intake_fetched_at       TIMESTAMPTZ NULL,
  intake_error            TEXT NULL,   -- stores last Healthie error if fetch failed
  -- Generic
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE patient_signals_cache DROP CONSTRAINT IF EXISTS patient_signals_cache_intake_state_check;
ALTER TABLE patient_signals_cache ADD CONSTRAINT patient_signals_cache_intake_state_check
  CHECK (intake_state IS NULL OR intake_state IN ('good','warn','bad','none'));

CREATE INDEX IF NOT EXISTS idx_patient_signals_cache_refreshed
  ON patient_signals_cache(intake_fetched_at);

COMMIT;
