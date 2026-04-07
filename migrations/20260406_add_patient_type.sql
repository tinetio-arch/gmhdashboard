-- Migration: Add patient_type column to patients table
-- Purpose: Distinguish recurring members from one-time/visit patients
-- Values: 'member' (recurring subscription), 'visit' (non-recurring/one-time)

ALTER TABLE patients ADD COLUMN IF NOT EXISTS patient_type TEXT NOT NULL DEFAULT 'member';

CREATE INDEX IF NOT EXISTS idx_patients_patient_type ON patients(patient_type);

-- Backfill: Patients with no payment method and no client type are likely visits
-- All existing patients with active payment methods default to 'member' (the column default)
-- Pro-bono patients stay as 'member' since they have ongoing care
