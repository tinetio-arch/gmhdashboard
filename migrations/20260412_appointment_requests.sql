-- Appointment Requests (pending approval over blocked time)
--
-- When a staff member tries to book a patient into time that a provider has
-- marked as blocked (⏸ Break), we don't create the Healthie appointment
-- immediately. Instead we store the request here in 'pending' state and show
-- it on the provider's schedule + Today view for approval.
--
-- On approve: the actual Healthie appointment is created via createAppointment
-- and healthie_appointment_id is populated on this row.
-- On deny: status → 'denied' and the row is kept for audit (no Healthie write).

CREATE TABLE IF NOT EXISTS appointment_requests (
    request_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Target booking details
    patient_healthie_id     TEXT NOT NULL,
    patient_name            TEXT,
    provider_id             TEXT NOT NULL,              -- Healthie provider user id
    provider_name           TEXT,
    appointment_type_id     TEXT NOT NULL,
    appointment_type_name   TEXT,
    datetime                TIMESTAMPTZ NOT NULL,       -- when the patient would be booked
    length_minutes          INTEGER NOT NULL DEFAULT 30,
    contact_type            TEXT,
    location                TEXT,
    location_id             TEXT,
    notes                   TEXT,
    -- Block that caused this request
    block_id                TEXT NOT NULL,              -- Healthie blocker appointment id
    block_reason            TEXT,
    -- Request metadata
    requested_by            TEXT NOT NULL,              -- staff email
    requested_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Decision
    status                  TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | denied
    decided_by              TEXT,                        -- staff email (provider or admin)
    decided_at              TIMESTAMPTZ,
    decision_notes          TEXT,
    -- Created appointment (only set on approve)
    healthie_appointment_id TEXT,
    CONSTRAINT appointment_requests_status_chk
        CHECK (status IN ('pending', 'approved', 'denied'))
);

CREATE INDEX IF NOT EXISTS idx_appointment_requests_provider_status
    ON appointment_requests(provider_id, status);
CREATE INDEX IF NOT EXISTS idx_appointment_requests_datetime
    ON appointment_requests(datetime);
CREATE INDEX IF NOT EXISTS idx_appointment_requests_pending
    ON appointment_requests(status) WHERE status = 'pending';
