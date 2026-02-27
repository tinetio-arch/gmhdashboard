-- Migration: Create patient_metrics table for vitals/metrics tracking
-- Run with: psql -f migrations/009_patient_metrics.sql

CREATE TABLE IF NOT EXISTS patient_metrics (
    metric_id SERIAL PRIMARY KEY,
    patient_id TEXT NOT NULL,
    metric_type TEXT NOT NULL,
    value TEXT NOT NULL,
    unit TEXT DEFAULT '',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recorded_by_email TEXT NOT NULL,
    notes TEXT DEFAULT '',
    healthie_entry_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_metrics_patient_id ON patient_metrics(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_metrics_recorded_at ON patient_metrics(recorded_at DESC);
