-- Migration: Jane Revenue Tracking System
-- Creates table for tracking historical revenue snapshots to enable accurate daily/weekly/monthly metrics

CREATE TABLE IF NOT EXISTS jane_revenue_snapshots (
    snapshot_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    clinicsync_patient_id TEXT NOT NULL,
    snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
    total_payment_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_payments NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_purchased NUMERIC(12, 2) NOT NULL DEFAULT 0,
    outstanding_balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_visits INTEGER NOT NULL DEFAULT 0,
    webhook_timestamp TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- Ensure one snapshot per patient per day
    UNIQUE (patient_id, snapshot_date, clinicsync_patient_id)
);

CREATE INDEX IF NOT EXISTS idx_jane_revenue_snapshots_patient 
    ON jane_revenue_snapshots (patient_id, clinicsync_patient_id);

CREATE INDEX IF NOT EXISTS idx_jane_revenue_snapshots_date 
    ON jane_revenue_snapshots (snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_jane_revenue_snapshots_range 
    ON jane_revenue_snapshots (snapshot_date, patient_id, clinicsync_patient_id);

COMMENT ON TABLE jane_revenue_snapshots IS 'Historical snapshots of Jane patient revenue for accurate time-based metrics';
COMMENT ON COLUMN jane_revenue_snapshots.snapshot_date IS 'Date of the snapshot (typically the date the webhook was received)';
COMMENT ON COLUMN jane_revenue_snapshots.total_payment_amount IS 'Total lifetime revenue at time of snapshot';
COMMENT ON COLUMN jane_revenue_snapshots.total_visits IS 'Total completed visits at time of snapshot';


