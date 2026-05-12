-- Patient Push Tokens
-- Stores Expo push tokens for the NOW Optimal patient mobile app.
-- One row per (expo_token) — a patient may have multiple devices.

CREATE TABLE IF NOT EXISTS patient_push_tokens (
    id SERIAL PRIMARY KEY,
    expo_token TEXT NOT NULL UNIQUE,
    healthie_client_id TEXT NOT NULL,
    user_group_id TEXT,
    platform VARCHAR(16) NOT NULL,
    preferences JSONB NOT NULL DEFAULT '{"appointments":true,"messages":true,"results":true,"billing":true,"announcements":true,"promotions":false}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_healthie
    ON patient_push_tokens(healthie_client_id) WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_push_tokens_group
    ON patient_push_tokens(user_group_id) WHERE active = TRUE;

COMMENT ON TABLE patient_push_tokens IS 'Expo push tokens registered by the patient mobile app; one row per device.';
COMMENT ON COLUMN patient_push_tokens.preferences IS 'Per-category opt-in flags: appointments, messages, results, billing, announcements, promotions.';
COMMENT ON COLUMN patient_push_tokens.active IS 'Set FALSE when Expo returns DeviceNotRegistered in a receipt, or on logout.';
