-- ClinicSync Sync Tracking Table
-- This table tracks webhook activity to monitor sync frequency and last sync times

CREATE TABLE IF NOT EXISTS clinicsync_sync_tracking (
    id SERIAL PRIMARY KEY,
    sync_date DATE NOT NULL DEFAULT CURRENT_DATE,
    last_webhook_received TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    total_webhooks_received INTEGER NOT NULL DEFAULT 1,
    patients_processed INTEGER NOT NULL DEFAULT 0,
    patients_skipped INTEGER NOT NULL DEFAULT 0,
    patients_matched INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create unique index on sync_date to ensure one record per day
CREATE UNIQUE INDEX IF NOT EXISTS idx_clinicsync_sync_tracking_date 
ON clinicsync_sync_tracking (sync_date);

-- Create index on last_webhook_received for quick lookups
CREATE INDEX IF NOT EXISTS idx_clinicsync_sync_tracking_last_webhook 
ON clinicsync_sync_tracking (last_webhook_received);

-- Insert initial record for today if it doesn't exist
INSERT INTO clinicsync_sync_tracking (sync_date, total_webhooks_received, patients_processed, patients_skipped, patients_matched)
VALUES (CURRENT_DATE, 0, 0, 0, 0)
ON CONFLICT (sync_date) DO NOTHING;

-- Create a view for easy querying of sync stats
CREATE OR REPLACE VIEW clinicsync_sync_summary AS
SELECT 
    sync_date,
    last_webhook_received,
    total_webhooks_received,
    patients_processed,
    patients_skipped,
    patients_matched,
    ROUND((patients_processed::DECIMAL / NULLIF(total_webhooks_received, 0)) * 100, 2) as processing_rate_percent,
    EXTRACT(EPOCH FROM (NOW() - last_webhook_received)) / 60 as minutes_since_last_sync,
    CASE 
        WHEN last_webhook_received > NOW() - INTERVAL '5 minutes' THEN 'Active'
        WHEN last_webhook_received > NOW() - INTERVAL '30 minutes' THEN 'Recent'
        WHEN last_webhook_received > NOW() - INTERVAL '2 hours' THEN 'Delayed'
        ELSE 'Stale'
    END as sync_status
FROM clinicsync_sync_tracking
ORDER BY sync_date DESC;

COMMENT ON TABLE clinicsync_sync_tracking IS 'Tracks ClinicSync webhook activity and sync frequency';
COMMENT ON VIEW clinicsync_sync_summary IS 'Summary view of ClinicSync sync activity with calculated metrics';


