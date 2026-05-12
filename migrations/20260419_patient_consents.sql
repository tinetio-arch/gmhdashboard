-- Phase 7: patient_consents table
-- Per docs/sot-modules/25-patient-classification-and-dashboard.md §8.5.1
-- Unified consent tracking — replaces scattered consent-per-product tables long-term.
-- Schema-only; no application code consumes this yet.
-- The existing pending_peptide_consents table stays untouched until Phase 7b backfills into this one.
-- Safe to re-run (IF NOT EXISTS on everything).

BEGIN;

CREATE TABLE IF NOT EXISTS patient_consents (
  consent_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  consent_type     TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  signed_at        TIMESTAMPTZ NULL,
  expires_at       TIMESTAMPTZ NULL,
  document_id      TEXT NULL,             -- Healthie doc ID or S3 key
  signed_via       TEXT NULL,             -- 'ipad_kiosk' | 'mobile_app' | 'web' | 'paper_scan' | 'ipad_kiosk_guardian'
  guardian_consent_id UUID NULL REFERENCES patient_consents(consent_id),  -- for minors: links to guardian's parallel consent
  revoked_at       TIMESTAMPTZ NULL,
  revoked_reason   TEXT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Allowed consent types (extensible — add via DB if new types appear)
ALTER TABLE patient_consents DROP CONSTRAINT IF EXISTS patient_consents_type_check;
ALTER TABLE patient_consents ADD CONSTRAINT patient_consents_type_check
  CHECK (consent_type IN (
    'hipaa',
    'telehealth',
    'treatment',
    'peptide',
    'abxtac_terms',
    'photo_release',
    'lab_auth'
  ));

ALTER TABLE patient_consents DROP CONSTRAINT IF EXISTS patient_consents_status_check;
ALTER TABLE patient_consents ADD CONSTRAINT patient_consents_status_check
  CHECK (status IN ('pending', 'signed', 'expired', 'withdrawn', 'superseded'));

-- Fast lookup by patient + type for the signals badge
CREATE INDEX IF NOT EXISTS idx_patient_consents_patient_type
  ON patient_consents(patient_id, consent_type);

-- Active-consent lookup (for "what's currently signed?" queries)
CREATE INDEX IF NOT EXISTS idx_patient_consents_active
  ON patient_consents(patient_id)
  WHERE status = 'signed' AND revoked_at IS NULL;

-- updated_at auto-maintain trigger
CREATE OR REPLACE FUNCTION patient_consents_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS patient_consents_updated_at_trigger ON patient_consents;
CREATE TRIGGER patient_consents_updated_at_trigger
  BEFORE UPDATE ON patient_consents
  FOR EACH ROW EXECUTE FUNCTION patient_consents_touch_updated_at();

COMMIT;
