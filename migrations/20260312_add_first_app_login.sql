-- Add first_app_login column to patients table
-- Tracks when a patient first opens the mobile app
-- Stamped by Lambda on get_dashboard_stats → POST /api/headless/record-app-login/

ALTER TABLE patients ADD COLUMN IF NOT EXISTS first_app_login TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_patients_first_app_login ON patients(first_app_login);
