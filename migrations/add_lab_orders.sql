CREATE TABLE IF NOT EXISTS lab_orders (
    id SERIAL PRIMARY KEY,
    patient_id UUID REFERENCES patients(patient_id), -- Optional link to GMH patient
    access_labs_patient_id VARCHAR(50), -- If known
    clinic_id VARCHAR(20) NOT NULL, -- '22937' (Tri-City) or '72152' (NowPrimary)
    
    -- Patient Demographics Snapshot (for order submission)
    patient_first_name VARCHAR(100),
    patient_last_name VARCHAR(100),
    patient_dob DATE,
    patient_gender VARCHAR(10),
    patient_address TEXT,
    patient_phone VARCHAR(20),
    patient_email VARCHAR(100),
    
    ordering_provider VARCHAR(100) DEFAULT 'Phil Schafer NP',
    ordering_provider_npi VARCHAR(20),
    
    -- Test Details
    test_codes JSONB, -- Array of codes e.g. ["9757", "146"]
    custom_codes TEXT, -- Comma separated
    diagnosis_codes JSONB, -- ICD-10
    
    -- Status Tracking
    status VARCHAR(20) DEFAULT 'pending', -- pending_approval, submitted, failed
    approval_required BOOLEAN DEFAULT FALSE,
    approved_by VARCHAR(100),
    approved_at TIMESTAMP,
    submitted_at TIMESTAMP,
    external_order_id VARCHAR(50), -- Access Labs Order ID
    submission_error TEXT,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_lab_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_lab_orders_updated_at ON lab_orders;
CREATE TRIGGER trigger_update_lab_orders_updated_at
BEFORE UPDATE ON lab_orders
FOR EACH ROW
EXECUTE FUNCTION update_lab_orders_updated_at();
