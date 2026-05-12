-- BioSCOPE third-party API patient allowlist.
-- Active rows have revoked_at IS NULL; revoked rows are kept for audit history.
-- Apply with: psql ... -f migrations/20260429_bioscope_authorized_patients.sql

BEGIN;

CREATE TABLE IF NOT EXISTS bioscope_authorized_patients (
  id                   SERIAL PRIMARY KEY,
  healthie_patient_id  TEXT NOT NULL,
  patient_name         TEXT,
  added_by             TEXT NOT NULL,
  added_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at           TIMESTAMPTZ,
  revoked_by           TEXT,
  notes                TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bioscope_active_patient
  ON bioscope_authorized_patients(healthie_patient_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bioscope_lookup_active
  ON bioscope_authorized_patients(healthie_patient_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE bioscope_authorized_patients IS
  'Patient allowlist for BioSCOPE third-party API. Server-side scope enforcement: any patient_id NOT present here as an active row gets rejected at the proxy layer regardless of what BioSCOPE sends.';

INSERT INTO bioscope_authorized_patients
  (healthie_patient_id, patient_name, added_by, notes)
VALUES
  ('12743455', 'Doug Dolan', 'admin@granitemountainhealth.com', 'Initial seed — BioSCOPE pilot patient')
ON CONFLICT DO NOTHING;

COMMIT;
