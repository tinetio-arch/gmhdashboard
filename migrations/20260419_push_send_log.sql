-- Push Send Log
-- Records every push attempt (appointment reminders, messages, etc.) for idempotency + audit.
-- Dedupe key is (category, dedupe_key) so a reminder cron can safely re-run without double-sending.

CREATE TABLE IF NOT EXISTS push_send_log (
    id BIGSERIAL PRIMARY KEY,
    expo_token TEXT NOT NULL,
    healthie_client_id TEXT,
    category VARCHAR(32) NOT NULL,
    dedupe_key TEXT NOT NULL,
    title TEXT,
    body TEXT,
    data JSONB,
    ticket_id TEXT,
    receipt_status VARCHAR(16),
    receipt_error TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    receipt_checked_at TIMESTAMPTZ,
    UNIQUE (category, dedupe_key, expo_token)
);

CREATE INDEX IF NOT EXISTS idx_push_log_pending_receipts
    ON push_send_log(ticket_id) WHERE ticket_id IS NOT NULL AND receipt_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_push_log_sent_at
    ON push_send_log(sent_at DESC);

COMMENT ON TABLE push_send_log IS 'One row per push attempt. UNIQUE(category, dedupe_key, expo_token) prevents duplicate sends when crons re-run.';
COMMENT ON COLUMN push_send_log.dedupe_key IS 'Stable key per logical event, e.g. "appt:<id>:24h" or "appt:<id>:1h".';
COMMENT ON COLUMN push_send_log.receipt_status IS 'ok | error — populated by the receipt poller.';
