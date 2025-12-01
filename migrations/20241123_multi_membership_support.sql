-- Migration to support multiple memberships and mixed payment methods
-- Date: 2024-11-23

-- 1. Add support for tracking multiple active memberships per patient
ALTER TABLE clinicsync_memberships 
ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS membership_rank INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS combined_tier TEXT;

-- Create index for faster multi-membership queries
CREATE INDEX IF NOT EXISTS idx_clinicsync_patient_active_multi 
ON clinicsync_memberships (patient_id, is_active, membership_rank);

-- 2. Add new payment method for mixed Jane & QuickBooks patients
INSERT INTO payment_method_lookup (payment_method_key, payment_method_label, description)
VALUES ('jane_quickbooks', 'Jane & QuickBooks', 'Patient uses both Jane and QuickBooks for payments')
ON CONFLICT (payment_method_key) DO NOTHING;

-- 3. Add new client type for mixed primary care patients
INSERT INTO client_type_lookup (client_type_key, client_type_label, description)
VALUES ('mixed_primcare_jane_qbo_tcmh', 'Mixed Primcare (Jane) | QBO TCMH', 'Primary care patient using both Jane and QuickBooks')
ON CONFLICT (client_type_key) DO NOTHING;

-- 4. Add column to track row styling
ALTER TABLE patients 
ADD COLUMN IF NOT EXISTS row_style_class TEXT;

-- 5. Create a view for multi-membership patients
CREATE OR REPLACE VIEW patient_multi_memberships AS
SELECT 
    p.patient_id,
    p.full_name,
    COUNT(DISTINCT cm.clinicsync_patient_id) as active_membership_count,
    STRING_AGG(DISTINCT cm.membership_plan, ' + ' ORDER BY cm.membership_plan) as combined_plans,
    STRING_AGG(DISTINCT cm.pass_id::text, ',' ORDER BY cm.pass_id::text) as pass_ids,
    MAX(CASE WHEN cm.is_active = FALSE THEN 1 ELSE 0 END) as has_expired_memberships
FROM patients p
JOIN clinicsync_memberships cm ON p.patient_id = cm.patient_id
WHERE cm.is_active = TRUE OR cm.contract_end_date > CURRENT_DATE - INTERVAL '90 days'
GROUP BY p.patient_id, p.full_name
HAVING COUNT(DISTINCT cm.clinicsync_patient_id) > 1 
    OR MAX(CASE WHEN cm.is_active = FALSE THEN 1 ELSE 0 END) = 1;

-- 6. Function to detect and update mixed payment method patients
CREATE OR REPLACE FUNCTION update_mixed_payment_patients() 
RETURNS void AS $$
BEGIN
    UPDATE patients p
    SET 
        payment_method_key = 'jane_quickbooks',
        client_type_key = CASE 
            WHEN p.client_type_key IN ('primary_care', 'primcare', 'primary') 
            THEN 'mixed_primcare_jane_qbo_tcmh'
            ELSE p.client_type_key
        END,
        row_style_class = 'mixed-payment-lightblue',
        updated_at = NOW()
    WHERE EXISTS (
        SELECT 1 FROM patient_qb_mapping qb 
        WHERE qb.patient_id = p.patient_id 
        AND qb.is_active = TRUE
    )
    AND EXISTS (
        SELECT 1 FROM clinicsync_memberships cm 
        WHERE cm.patient_id = p.patient_id 
        AND cm.is_active = TRUE
    )
    AND p.payment_method_key != 'jane_quickbooks';
END;
$$ LANGUAGE plpgsql;

-- Run the function to update existing patients
SELECT update_mixed_payment_patients();









