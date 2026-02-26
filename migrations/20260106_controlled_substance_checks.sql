-- Migration: Create controlled substance daily check table
-- Purpose: DEA Compliance - Staff must verify physical inventory before dispensing each day

CREATE TABLE IF NOT EXISTS controlled_substance_checks (
    check_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    check_date DATE NOT NULL,
    
    -- Who performed the check
    performed_by VARCHAR(255) NOT NULL,
    performed_by_name VARCHAR(255) NOT NULL,
    performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- System counts at time of check
    system_vials_cb_30ml INTEGER NOT NULL DEFAULT 0,
    system_remaining_ml_cb DECIMAL(10,3) NOT NULL DEFAULT 0,
    system_vials_toprx_10ml INTEGER NOT NULL DEFAULT 0,
    system_remaining_ml_toprx DECIMAL(10,3) NOT NULL DEFAULT 0,
    
    -- Physical counts entered by staff
    physical_vials_cb_30ml INTEGER NOT NULL DEFAULT 0,
    physical_partial_ml_cb DECIMAL(10,3) NOT NULL DEFAULT 0,
    physical_vials_toprx_10ml INTEGER NOT NULL DEFAULT 0,
    physical_partial_ml_toprx DECIMAL(10,3) NOT NULL DEFAULT 0,
    
    -- Discrepancy tracking
    discrepancy_found BOOLEAN NOT NULL DEFAULT FALSE,
    discrepancy_ml_cb DECIMAL(10,3) NOT NULL DEFAULT 0,
    discrepancy_ml_toprx DECIMAL(10,3) NOT NULL DEFAULT 0,
    discrepancy_notes TEXT,
    
    -- General notes
    notes TEXT,
    
    -- Status: pending, completed, discrepancy_flagged, discrepancy_resolved
    status VARCHAR(50) NOT NULL DEFAULT 'completed',
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for quick lookup of today's check
CREATE INDEX IF NOT EXISTS idx_cs_checks_date ON controlled_substance_checks(check_date);

-- Index for audit trail queries
CREATE INDEX IF NOT EXISTS idx_cs_checks_performed_by ON controlled_substance_checks(performed_by);

-- Index for discrepancy reporting
CREATE INDEX IF NOT EXISTS idx_cs_checks_discrepancy ON controlled_substance_checks(discrepancy_found) WHERE discrepancy_found = TRUE;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_cs_check_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cs_check_updated_at ON controlled_substance_checks;
CREATE TRIGGER cs_check_updated_at
    BEFORE UPDATE ON controlled_substance_checks
    FOR EACH ROW
    EXECUTE FUNCTION update_cs_check_timestamp();

-- Comment for documentation
COMMENT ON TABLE controlled_substance_checks IS 'DEA Compliance: Daily staff verification of controlled substance inventory before dispensing';
