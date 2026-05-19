-- Persist Healthie sync status on patients (mirrors the existing
-- ghl_sync_status / ghl_sync_error / ghl_last_synced_at columns).
--
-- WHY: When `lib/healthieDemographics.ts:syncHealthiePatientDemographics()`
-- raised an error (e.g. "Email is already in use" — a provider+patient email
-- collision, see Whitten / Foster), the caller in app/api/patients/[id]/route.ts
-- only console.error'd. We had no DB record of which patients were stuck and
-- no signal to surface a fix in /ops, so the failure kept happening silently
-- on every PATCH and the rest of the sync (address) was abandoned mid-stream.
--
-- Status values:
--   ok                          — last sync succeeded end-to-end
--   error                       — generic failure; see healthie_sync_error
--   blocked_email_collision     — Healthie rejected an email update because
--                                 the email is already on another user record
--                                 (typically a provider account sharing the
--                                 patient's email). Do not retry until /ops
--                                 surfaces it and a human resolves the dedup.
-- NULL = never attempted (or pre-migration row).
ALTER TABLE patients
    ADD COLUMN IF NOT EXISTS healthie_sync_status TEXT,
    ADD COLUMN IF NOT EXISTS healthie_sync_error  TEXT,
    ADD COLUMN IF NOT EXISTS healthie_last_synced_at TIMESTAMP;

COMMENT ON COLUMN patients.healthie_sync_status IS
    'Last Healthie demographics sync result: ok | error | blocked_email_collision | NULL.';
COMMENT ON COLUMN patients.healthie_sync_error IS
    'Last Healthie sync error message (truncated to 500 chars). NULL when status=ok.';
COMMENT ON COLUMN patients.healthie_last_synced_at IS
    'Timestamp of last Healthie demographics sync attempt (success or failure).';

-- Index for the /ops surface that will list blocked patients.
CREATE INDEX IF NOT EXISTS idx_patients_healthie_sync_blocked
    ON patients (healthie_sync_status)
    WHERE healthie_sync_status IS NOT NULL AND healthie_sync_status <> 'ok';
