-- patient_communications: unified outbound-message ledger
--
-- Why: today, outbound patient comms are scattered across three places
--   * push_send_log         (Expo push)
--   * ghl_messages          (GHL SMS/email — captured back via webhook, mostly inbound)
--   * Healthie native messaging (NOT logged on our side — flows directly Healthie → patient)
-- That makes it impossible to answer "did we already send X to this patient", "what did
-- we send today", or "which template fired the wrong copy". This table is the chokepoint
-- every outbound send (and synthetic record of inbound where useful) writes to.
--
-- Phase 1 (this migration): table + indexes + idempotency. No writers yet.
-- Phase 2 will plumb writers through the comms-suppression gate (see project
-- "untangling-healthie-communications-from-healthie").
--
-- Design notes:
--   * patient_id is ON DELETE SET NULL so the audit trail survives patient deletion
--     (deleting a patient already cascades into half the system — see
--     reference_patients_cascade_delete_danger memory).
--   * idempotency_key is UNIQUE but nullable — Postgres allows multiple NULLs.
--     Writers that need dedup MUST supply a stable key (e.g. "appt:<id>:reminder24h").
--   * account_key mirrors the ghl_messages CHECK so cross-table joins line up.

CREATE TABLE IF NOT EXISTS patient_communications (
    id BIGSERIAL PRIMARY KEY,

    -- Who the message is about
    patient_id          UUID REFERENCES patients(patient_id) ON DELETE SET NULL,
    healthie_client_id  TEXT,
    ghl_contact_id      TEXT,
    clinic              TEXT,
    account_key         TEXT CHECK (account_key IS NULL OR account_key IN ('mensHealth','primaryCare','abxtac')),

    -- What triggered the send
    source              TEXT NOT NULL,
    event_type          TEXT NOT NULL,

    -- How it was delivered
    channel             TEXT NOT NULL CHECK (channel IN ('sms','email','push','voice','in_app','healthie_message','other')),
    direction           TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound','inbound')),
    template_key        TEXT,
    template_variables  JSONB,

    -- Recipient routing (denormalized — the patient row may change after the fact)
    recipient_phone     TEXT,
    recipient_email     TEXT,
    recipient_push_token TEXT,

    -- Content
    subject             TEXT,
    body                TEXT,

    -- Provider identifiers
    provider            TEXT,
    external_id         TEXT,

    -- Status lifecycle
    status              TEXT NOT NULL DEFAULT 'queued'
                         CHECK (status IN ('queued','sent','delivered','failed','opened','clicked','bounced','skipped','suppressed')),
    error_code          TEXT,
    error_message       TEXT,

    -- Idempotency / correlation
    idempotency_key     TEXT,
    triggered_by_user_id TEXT,
    request_id          TEXT,
    raw_metadata        JSONB,

    -- Timestamps
    queued_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at             TIMESTAMPTZ,
    delivered_at        TIMESTAMPTZ,
    opened_at           TIMESTAMPTZ,
    failed_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_patient_comms_idempotency
    ON patient_communications (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patient_comms_patient_time
    ON patient_communications (patient_id, queued_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_comms_event_time
    ON patient_communications (event_type, queued_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_comms_account_time
    ON patient_communications (account_key, queued_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_comms_status_pending
    ON patient_communications (status, queued_at)
    WHERE status IN ('queued','failed');

CREATE INDEX IF NOT EXISTS idx_patient_comms_external_id
    ON patient_communications (provider, external_id)
    WHERE external_id IS NOT NULL;

-- updated_at maintenance
CREATE OR REPLACE FUNCTION patient_communications_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_patient_communications_touch ON patient_communications;
CREATE TRIGGER trg_patient_communications_touch
    BEFORE UPDATE ON patient_communications
    FOR EACH ROW EXECUTE FUNCTION patient_communications_touch_updated_at();

COMMENT ON TABLE  patient_communications IS 'Unified outbound-message ledger. Every send (SMS/email/push/voice/in-app/Healthie) writes a row. Idempotency_key prevents duplicate sends from cron re-runs. Phase 1 of untangling-healthie-communications.';
COMMENT ON COLUMN patient_communications.source           IS 'Subsystem that initiated the send: dashboard | cron | webhook | ghl-workflow | healthie | manual.';
COMMENT ON COLUMN patient_communications.event_type      IS 'Logical event slug, e.g. appointment_reminder_24h, lab_result_notification, intake_invite, payment_receipt.';
COMMENT ON COLUMN patient_communications.idempotency_key IS 'Stable per-logical-event key, e.g. "appt:<id>:reminder24h". UNIQUE but nullable.';
COMMENT ON COLUMN patient_communications.status          IS 'queued → sent → delivered (terminal) | failed | opened | clicked | bounced | skipped | suppressed.';
COMMENT ON COLUMN patient_communications.account_key     IS 'GHL sub-account routing key; mirrors ghl_messages.account_key.';
