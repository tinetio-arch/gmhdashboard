-- Database Schema Fix - Dec 28, 2025, 04:17 UTC
-- Emergency fix for missing database objects causing AWS monitoring alerts
--
-- ISSUE: AWS CloudWatch detected 60 errors for missing quickbooks_connection_health table
--        and missing created_at column in clinicsync_webhook_events
--
-- ROOT CAUSE: 
--   1. quickbooks_connection_health table was never created (QuickBooks health monitoring code added
--      but migration never run)
--   2. created_at column expected by some legacy queries but not in schema
--
-- RESOLUTION: Created missing table and column

BEGIN;

-- 1. Create quickbooks_connection_health table for monitoring QuickBooks OAuth connection status
CREATE TABLE IF NOT EXISTS quickbooks_connection_health (
    id SERIAL PRIMARY KEY,
    connected BOOLEAN NOT NULL,
    error TEXT,
    checked_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create index for efficient time-based queries (used by health monitoring)
CREATE INDEX IF NOT EXISTS idx_qb_health_checked_at 
ON quickbooks_connection_health(checked_at DESC);

-- Add helpful comment
COMMENT ON TABLE quickbooks_connection_health IS 
'Stores QuickBooks OAuth connection health check results. Used for monitoring connection reliability and detecting token expiration issues. Cleaned up after 30 days.';

-- 2. Add created_at column to clinicsync_webhook_events if missing
-- Note: This table is deprecated (ClinicSync removed Dec 28, 2025) but some legacy queries still reference it
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='clinicsync_webhook_events' AND column_name='created_at'
    ) THEN
        ALTER TABLE clinicsync_webhook_events 
        ADD COLUMN created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW();
        
        -- Backfill with received_at for existing rows
        UPDATE clinicsync_webhook_events 
        SET created_at = COALESCE(received_at, NOW())
        WHERE created_at IS NULL;
        
        RAISE NOTICE 'Added created_at column to clinicsync_webhook_events and backfilled % rows', 
            (SELECT COUNT(*) FROM clinicsync_webhook_events);
    END IF;
END $$;

COMMIT;

-- Verification
SELECT 
    'quickbooks_connection_health' as object,
    'table' as type,
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'quickbooks_connection_health')
        THEN '✅ EXISTS' 
        ELSE '❌ MISSING' 
    END as status
UNION ALL
SELECT 
    'clinicsync_webhook_events.created_at',
    'column',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clinicsync_webhook_events' AND column_name = 'created_at')
        THEN '✅ EXISTS'
        ELSE '❌ MISSING'
    END;

-- Show recent health check records (should be empty or show test data)
SELECT COUNT(*) as health_check_records 
FROM quickbooks_connection_health;
