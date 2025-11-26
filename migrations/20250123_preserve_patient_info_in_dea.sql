-- Migration: Preserve patient information in DEA transactions when patients are deleted
-- This ensures DEA compliance records remain complete even after patient deletion

-- Add patient information columns to dea_transactions
ALTER TABLE dea_transactions
    ADD COLUMN IF NOT EXISTS patient_name TEXT,
    ADD COLUMN IF NOT EXISTS phone_primary TEXT,
    ADD COLUMN IF NOT EXISTS address_line1 TEXT,
    ADD COLUMN IF NOT EXISTS city TEXT,
    ADD COLUMN IF NOT EXISTS state TEXT,
    ADD COLUMN IF NOT EXISTS postal_code TEXT;

-- Backfill existing dea_transactions with patient info from patients table
UPDATE dea_transactions dt
   SET patient_name = p.full_name,
       phone_primary = p.phone_primary,
       address_line1 = p.address_line1,
       city = p.city,
       state = p.state,
       postal_code = p.postal_code
  FROM patients p
 WHERE dt.patient_id = p.patient_id
   AND dt.patient_name IS NULL;

-- Update the view to use stored patient info, falling back to patients table
DROP VIEW IF EXISTS dea_dispense_log_v;

CREATE VIEW dea_dispense_log_v AS
SELECT
    d.dispense_id,
    COALESCE(dt.transaction_time, d.dispense_date) AS transaction_time,
    COALESCE(dt.dea_drug_name, v.dea_drug_name) AS dea_drug_name,
    COALESCE(dt.dea_drug_code, v.dea_drug_code) AS dea_drug_code,
    COALESCE(dt.dea_schedule, 'Schedule TBD') AS dea_schedule,
    COALESCE(dt.quantity_dispensed, d.total_dispensed_ml) AS quantity_dispensed,
    COALESCE(dt.units, 'mL') AS units,
    COALESCE(dt.prescriber, d.prescriber) AS prescriber,
    -- Preserve patient info: use stored values first, then fall back to patients table
    COALESCE(dt.patient_name, d.patient_name, p.full_name) AS patient_name,
    COALESCE(dt.phone_primary, p.phone_primary) AS phone_primary,
    COALESCE(dt.address_line1, p.address_line1) AS address_line1,
    COALESCE(dt.city, p.city) AS city,
    COALESCE(dt.state, p.state) AS state,
    COALESCE(dt.postal_code, p.postal_code) AS postal_code,
    p.date_added,
    v.lot_number,
    v.expiration_date,
    d.notes,
    dt.reporting_period
FROM dispenses d
LEFT JOIN patients p ON p.patient_id = d.patient_id
LEFT JOIN vials v ON v.vial_id = d.vial_id
LEFT JOIN dea_transactions dt ON dt.dispense_id = d.dispense_id;

