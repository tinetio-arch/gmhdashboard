-- PR-3a: Add spouse_patient_id column
-- Date: 2026-04-17
-- Per policy §7.5 (spouse relationships, distinct from dependents)
-- Nullable FK; does not affect existing rows.

ALTER TABLE patients ADD COLUMN IF NOT EXISTS spouse_patient_id UUID REFERENCES patients(patient_id);
CREATE INDEX IF NOT EXISTS idx_patients_spouse_patient_id
  ON patients(spouse_patient_id) WHERE spouse_patient_id IS NOT NULL;
