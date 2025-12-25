-- Healthie webhook event staging table for idempotent processing
CREATE TABLE IF NOT EXISTS healthie_webhook_events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(255) NOT NULL,
    resource_id VARCHAR(255) NOT NULL,
    resource_id_type VARCHAR(255) NOT NULL,
    changed_fields JSONB,
    raw_payload JSONB NOT NULL,
    signature TEXT,
    content_digest TEXT,
    content_length INTEGER NOT NULL,
    body_sha256 TEXT NOT NULL,
    received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) DEFAULT 'received',
    error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_healthie_webhook_events_body_sha256 ON healthie_webhook_events(body_sha256);
CREATE INDEX IF NOT EXISTS idx_healthie_webhook_events_event_type ON healthie_webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_healthie_webhook_events_received_at ON healthie_webhook_events(received_at);
CREATE INDEX IF NOT EXISTS idx_healthie_webhook_events_status ON healthie_webhook_events(status);
