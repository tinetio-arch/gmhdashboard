-- Patient Creation Auto-Integration: Database Schema Updates
-- Created: January 8, 2026
-- Purpose: Add columns for clinic selection and Healthie integration

-- Add clinic column (for routing to correct brand)
ALTER TABLE patients 
ADD COLUMN IF NOT EXISTS clinic VARCHAR(50);

-- Add constraint for valid clinic values
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'clinic_valid_values'
  ) THEN
    ALTER TABLE patients
    ADD CONSTRAINT clinic_valid_values 
    CHECK (clinic IN ('nowprimary.care', 'nowmenshealth.care'));
  END IF;
END $$;

-- Add healthie_client_id column (to store Healthie patient ID)
ALTER TABLE patients 
ADD COLUMN IF NOT EXISTS healthie_client_id VARCHAR(50);

-- Add index for faster Healthie ID lookups
CREATE INDEX IF NOT EXISTS idx_patients_healthie_client_id 
ON patients(healthie_client_id);

-- Add comments for documentation
COMMENT ON COLUMN patients.clinic IS 'Brand/clinic selection: nowprimary.care or nowmenshealth.care';
COMMENT ON COLUMN patients.healthie_client_id IS 'Healthie EMR patient ID (auto-populated on creation)';

-- Verify changes
SELECT column_name, data_type, character_maximum_length 
FROM information_schema.columns 
WHERE table_name = 'patients' 
  AND column_name IN ('clinic', 'healthie_client_id')
ORDER BY column_name;
