-- Migration: Create QuickBooks connection health monitoring table

-- Table to track connection health checks
CREATE TABLE IF NOT EXISTS quickbooks_connection_health (
    check_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    checked_at TIMESTAMP DEFAULT NOW() NOT NULL,
    connected BOOLEAN NOT NULL,
    error TEXT,
    response_time_ms INTEGER, -- Future: track API response times
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index for efficient querying of recent checks
CREATE INDEX IF NOT EXISTS idx_qb_health_checked_at 
    ON quickbooks_connection_health (checked_at DESC);

-- Index for filtering by connection status
CREATE INDEX IF NOT EXISTS idx_qb_health_connected 
    ON quickbooks_connection_health (connected, checked_at DESC);

-- Note: We don't use a unique constraint on checked_at because we want to allow
-- multiple checks per second if needed (e.g., from different API calls)

-- View for easy access to latest health status
CREATE OR REPLACE VIEW quickbooks_health_latest_v AS
SELECT 
    checked_at,
    connected,
    error,
    response_time_ms,
    -- Calculate health score (success rate in last 24h)
    (
        SELECT COUNT(*) FILTER (WHERE connected = TRUE)::float / 
               NULLIF(COUNT(*), 0) * 100
        FROM quickbooks_connection_health
        WHERE checked_at > NOW() - INTERVAL '24 hours'
    ) AS health_score_24h,
    -- Time since last successful check
    (
        SELECT EXTRACT(EPOCH FROM (NOW() - MAX(checked_at))) / 60
        FROM quickbooks_connection_health
        WHERE connected = TRUE
    ) AS minutes_since_last_success
FROM quickbooks_connection_health
ORDER BY checked_at DESC
LIMIT 1;

