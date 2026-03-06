-- Tag-Based Patient Service Control
-- Created: 2026-03-05

-- Patient service tags (additive — unlock extra services)
CREATE TABLE IF NOT EXISTS patient_service_tags (
  id SERIAL PRIMARY KEY,
  patient_id TEXT NOT NULL,
  healthie_user_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  added_by TEXT,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(patient_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_service_tags_patient ON patient_service_tags(patient_id);
CREATE INDEX IF NOT EXISTS idx_service_tags_healthie ON patient_service_tags(healthie_user_id);

-- Tag configuration (what each tag unlocks)
CREATE TABLE IF NOT EXISTS service_tag_config (
  id SERIAL PRIMARY KEY,
  tag TEXT NOT NULL,
  appointment_type_id TEXT,
  form_id TEXT,
  label TEXT,
  active BOOLEAN DEFAULT true
);

-- Seed: map tags to appointment types
INSERT INTO service_tag_config (tag, appointment_type_id, label) VALUES
  ('peptides', '504736', 'Peptide Education & Supply Pickup'),
  ('weight-loss', '504717', 'Weight Loss Consult'),
  ('iv-therapy', '505647', 'IV Therapy GFE'),
  ('evexipel', '504727', 'EvexiPel Initial Pelleting'),
  ('evexipel', '504728', 'EvexiPel Repeat Pelleting'),
  ('telehealth', '504726', 'General TRT Telemedicine');
