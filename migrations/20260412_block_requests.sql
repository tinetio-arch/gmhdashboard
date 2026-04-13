-- Block Requests (non-admin Break submissions pending admin approval)
--
-- Non-admin staff can request a Break but it doesn't go live in Healthie until
-- an admin approves. On approval we create the Healthie blocker (with recurring
-- if requested) and stamp healthie_block_id. On deny the row stays for audit.

CREATE TABLE IF NOT EXISTS block_requests (
    request_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id         TEXT NOT NULL,
    provider_name       TEXT,
    start_datetime      TIMESTAMPTZ NOT NULL,       -- ISO with TZ
    end_date            TEXT NOT NULL,              -- YYYY-MM-DD (Healthie input shape)
    end_time            TEXT NOT NULL,              -- HH:MM
    notes               TEXT,
    -- Recurrence (optional)
    repeat_interval     TEXT,                       -- Daily | Weekly | Monthly
    repeat_times        INTEGER,
    -- Request metadata
    requested_by        TEXT NOT NULL,              -- staff email
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Decision
    status              TEXT NOT NULL DEFAULT 'pending',
    decided_by          TEXT,
    decided_at          TIMESTAMPTZ,
    decision_notes      TEXT,
    -- Created block (only set on approve)
    healthie_block_id   TEXT,
    CONSTRAINT block_requests_status_chk
        CHECK (status IN ('pending', 'approved', 'denied'))
);

CREATE INDEX IF NOT EXISTS idx_block_requests_status
    ON block_requests(status);
CREATE INDEX IF NOT EXISTS idx_block_requests_pending
    ON block_requests(status) WHERE status = 'pending';
