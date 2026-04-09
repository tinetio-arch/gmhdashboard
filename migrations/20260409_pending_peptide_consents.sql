-- Pending peptide consent requests (iPad staff → mobile app patient)
CREATE TABLE IF NOT EXISTS pending_peptide_consents (
  id SERIAL PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(patient_id),
  healthie_id TEXT,
  items JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'expired', 'cancelled')),
  created_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  signed_at TIMESTAMP,
  document_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_consent_patient ON pending_peptide_consents(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_pending_consent_healthie ON pending_peptide_consents(healthie_id, status);
