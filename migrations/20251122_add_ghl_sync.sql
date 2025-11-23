-- Migration to add GoHighLevel sync tracking
-- This adds tracking fields to monitor sync status between GMH dashboard and GoHighLevel

-- Add GHL sync tracking columns to patients table
ALTER TABLE patients
    ADD COLUMN IF NOT EXISTS ghl_contact_id TEXT,
    ADD COLUMN IF NOT EXISTS ghl_sync_status TEXT DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS ghl_last_synced_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS ghl_sync_error TEXT,
    ADD COLUMN IF NOT EXISTS ghl_tags JSONB DEFAULT '[]'::JSONB;

-- Create index for efficient sync queries
CREATE INDEX IF NOT EXISTS idx_patients_ghl_sync_status ON patients(ghl_sync_status);
CREATE INDEX IF NOT EXISTS idx_patients_ghl_contact_id ON patients(ghl_contact_id);
CREATE INDEX IF NOT EXISTS idx_patients_ghl_last_synced ON patients(ghl_last_synced_at);

-- Create GHL sync history table for audit trail
CREATE TABLE IF NOT EXISTS ghl_sync_history (
    sync_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    sync_type TEXT NOT NULL CHECK (sync_type IN ('create', 'update', 'tag_add', 'tag_remove', 'error')),
    ghl_contact_id TEXT,
    sync_payload JSONB,
    sync_result JSONB,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    created_by UUID REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_ghl_sync_history_patient ON ghl_sync_history(patient_id);
CREATE INDEX IF NOT EXISTS idx_ghl_sync_history_created ON ghl_sync_history(created_at);

-- Create GHL tag mapping table for automatic tag management
CREATE TABLE IF NOT EXISTS ghl_tag_mappings (
    mapping_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    condition_type TEXT NOT NULL CHECK (condition_type IN ('status', 'membership', 'client_type', 'custom')),
    condition_value TEXT NOT NULL,
    ghl_tag_name TEXT NOT NULL,
    ghl_tag_id TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(condition_type, condition_value)
);

-- Insert default tag mappings
INSERT INTO ghl_tag_mappings (condition_type, condition_value, ghl_tag_name)
VALUES
    -- Status-based tags
    ('status', 'active', 'Active Patient'),
    ('status', 'active_pending', 'Active - Pending Labs'),
    ('status', 'inactive', 'Inactive Patient'),
    ('status', 'hold_payment_research', 'Hold - Payment Issue'),
    ('status', 'hold_service_change', 'Hold - Service Change'),
    ('status', 'hold_contract_renewal', 'Hold - Contract Renewal'),
    
    -- Membership-based tags
    ('membership', 'mens_health', 'Men''s Health Service'),
    ('membership', 'primecare_elite', 'PrimeCare Elite'),
    ('membership', 'primecare_premier', 'PrimeCare Premier'),
    ('membership', 'tcmh', 'TCMH Member'),
    
    -- Client type tags - Men's Health patients get "existing" tag
    ('client_type', 'qbo_tcmh_180_month', 'existing'),
    ('client_type', 'qbo_f_f_fr_veteran_140_month', 'existing'),
    ('client_type', 'jane_tcmh_180_month', 'existing'),
    ('client_type', 'jane_f_f_fr_veteran_140_month', 'existing'),
    ('client_type', 'approved_disc_pro_bono_pt', 'existing'),
    ('client_type', 'primecare_elite_100_month', 'PrimeCare Elite $100'),
    ('client_type', 'primecare_premier_50_month', 'PrimeCare Premier $50'),
    ('client_type', 'mens_health_qbo', 'existing'),
    
    -- Custom tags
    ('custom', 'has_labs_overdue', 'Labs Overdue'),
    ('custom', 'has_membership_balance', 'Has Membership Balance'),
    ('custom', 'verified_patient', 'Verified Patient')
ON CONFLICT (condition_type, condition_value) DO NOTHING;

-- Add trigger to update the updated_at timestamp
CREATE TRIGGER trg_ghl_tag_mappings_updated
    BEFORE UPDATE ON ghl_tag_mappings
    FOR EACH ROW
    EXECUTE FUNCTION touch_updated_at();

-- Create a view to show patients with their GHL sync status
CREATE OR REPLACE VIEW patient_ghl_sync_v AS
SELECT
    p.patient_id,
    p.full_name AS patient_name,
    p.email,
    p.phone_primary,
    p.status_key,
    ps.display_name AS status_name,
    p.client_type_key,
    ct.display_name AS client_type,
    p.ghl_contact_id,
    p.ghl_sync_status,
    p.ghl_last_synced_at,
    p.ghl_sync_error,
    p.ghl_tags,
    CASE
        WHEN p.ghl_sync_status = 'synced' AND p.ghl_last_synced_at > NOW() - INTERVAL '24 hours' THEN 'current'
        WHEN p.ghl_sync_status = 'synced' AND p.ghl_last_synced_at <= NOW() - INTERVAL '24 hours' THEN 'stale'
        WHEN p.ghl_sync_status = 'error' THEN 'error'
        WHEN p.ghl_sync_status = 'pending' THEN 'pending'
        ELSE 'unknown'
    END AS sync_freshness
FROM patients p
LEFT JOIN patient_status_lookup ps ON ps.status_key = p.status_key
LEFT JOIN client_type_lookup ct ON ct.type_key = p.client_type_key
WHERE p.email IS NOT NULL OR p.phone_primary IS NOT NULL;

-- Add comment explaining the sync status values
COMMENT ON COLUMN patients.ghl_sync_status IS 'GoHighLevel sync status: pending (never synced), syncing (in progress), synced (successful), error (failed)';
