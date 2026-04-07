-- Migration: Create patient_status_activity_log table
-- Purpose: Audit trail for all patient status changes (activation, deactivation, holds)
-- FIX(2026-04-06): This table was referenced in code but never created.
-- All audit log inserts were silently failing (caught by try/catch for error 42P01).

CREATE TABLE IF NOT EXISTS patient_status_activity_log (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         UUID NOT NULL REFERENCES patients(patient_id),
  previous_status    TEXT NOT NULL,
  new_status         TEXT NOT NULL,
  changed_by_user_id UUID,
  change_source      TEXT NOT NULL DEFAULT 'unknown',
  change_reason      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_psal_patient ON patient_status_activity_log(patient_id);
CREATE INDEX IF NOT EXISTS idx_psal_created ON patient_status_activity_log(created_at);
