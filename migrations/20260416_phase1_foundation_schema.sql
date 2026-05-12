-- PR-2 / Phase 1 Foundation Schema Additions
-- Date: 2026-04-16
-- Per docs/sot-modules/25-patient-classification-and-dashboard.md
-- All additions are nullable with safe defaults. Zero application code reads these yet.
-- Safe to re-run (IF NOT EXISTS guards on every statement).

BEGIN;

-- 1. Dependent tracking (§7.4 Family Members & Dependents)
--    Nullable FK: a patient may or may not have a paying parent on record.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS parent_patient_id UUID REFERENCES patients(patient_id);
CREATE INDEX IF NOT EXISTS idx_patients_parent_patient_id
  ON patients(parent_patient_id) WHERE parent_patient_id IS NOT NULL;

-- 2. TRT dose cadence (§8.7.3)
--    Nullable numeric (e.g., 3.5, 4, 7). Fallback default 3.5 is applied in code, not DB.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS dose_frequency_days NUMERIC NULL;

-- 3. ABXTAC membership lifecycle (§8.6.9)
--    Default 'active' preserves current behavior for every existing row.
ALTER TABLE abxtac_customer_access
  ADD COLUMN IF NOT EXISTS membership_status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE abxtac_customer_access
  DROP CONSTRAINT IF EXISTS abxtac_membership_status_check;

ALTER TABLE abxtac_customer_access
  ADD CONSTRAINT abxtac_membership_status_check
  CHECK (membership_status IN ('active', 'payment_hold', 'inactive'));

-- 4. Dispense override audit (§8.7.5)
--    Nullable; populated only when staff overrides a "not-yet-eligible" warning.
ALTER TABLE dispense_history
  ADD COLUMN IF NOT EXISTS override_reason TEXT NULL;

-- 5. Broaden clinic CHECK constraint (§8.6 / §9 gap #12)
--    Existing constraint: clinic_valid_values, allows only nowprimary.care + nowmenshealth.care.
--    New: also allow abxtac + reserved placeholders. NULL still allowed.
ALTER TABLE patients DROP CONSTRAINT IF EXISTS clinic_valid_values;

ALTER TABLE patients ADD CONSTRAINT clinic_valid_values
  CHECK (clinic IS NULL OR clinic = ANY (ARRAY[
    'nowprimary.care'::text,
    'nowmenshealth.care'::text,
    'abxtac'::text,
    'nowlongevity.care'::text,
    'nowmentalhealth.care'::text
  ]));

COMMIT;
