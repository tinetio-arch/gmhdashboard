-- Migration: Add tables for membership audit resolutions and patient merges
-- This enables tracking of resolved audit issues and patient merge history

-- Table to track resolved audit issues
CREATE TABLE IF NOT EXISTS membership_audit_resolutions (
  normalized_name TEXT PRIMARY KEY,
  resolution_type TEXT NOT NULL,
  resolved_at TIMESTAMP DEFAULT NOW(),
  resolved_by TEXT,
  resolution_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_resolutions_resolved_at 
  ON membership_audit_resolutions (resolved_at DESC);

-- Table to track patient merges
CREATE TABLE IF NOT EXISTS patient_merges (
  merge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_patient_id UUID REFERENCES patients(patient_id) ON DELETE CASCADE,
  merged_patient_id UUID REFERENCES patients(patient_id) ON DELETE CASCADE,
  merged_at TIMESTAMP DEFAULT NOW(),
  merged_by TEXT,
  merge_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_patient_merges_primary 
  ON patient_merges (primary_patient_id);

CREATE INDEX IF NOT EXISTS idx_patient_merges_merged 
  ON patient_merges (merged_patient_id);

CREATE INDEX IF NOT EXISTS idx_patient_merges_merged_at 
  ON patient_merges (merged_at DESC);

-- Ensure patient_qb_mapping has the necessary columns
DO $$
BEGIN
  -- Add is_active column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patient_qb_mapping' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE patient_qb_mapping ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
    CREATE INDEX IF NOT EXISTS idx_patient_qb_mapping_active 
      ON patient_qb_mapping (is_active) WHERE is_active = TRUE;
  END IF;

  -- Add match_method column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patient_qb_mapping' AND column_name = 'match_method'
  ) THEN
    ALTER TABLE patient_qb_mapping ADD COLUMN match_method TEXT;
  END IF;

  -- Add qb_customer_name column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patient_qb_mapping' AND column_name = 'qb_customer_name'
  ) THEN
    ALTER TABLE patient_qb_mapping ADD COLUMN qb_customer_name TEXT;
  END IF;
END $$;

