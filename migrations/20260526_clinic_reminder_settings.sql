-- clinic_reminder_settings: per-clinic appointment-reminder cadence config
--
-- Phase 2 of project "untangling-healthie-communications-from-healthie"
-- (dispatch inbox row 20260526-192906-2008).
--
-- Why this exists
--   Healthie's native reminder schedule (5d SMS + 24h SMS + 24h email per
--   appointment) over-fires — three notifications per appointment, multiple
--   channels at once. The new standard: a SINGLE reminder at 24h, on the
--   best available channel (push → SMS → email, decided by the comms gateway),
--   configurable per clinic.
--
--   This migration adds the storage + safe defaults. NO writers, NO cron
--   changes — the helper and any future sender live in separate commits.
--   The existing inert appointment-reminders push cron
--   (app/api/cron/appointment-reminders/route.ts, every 15min, currently
--   patients_checked=0 because no opted-in tokens) is NOT modified here;
--   Phase 3 will migrate that path onto notifyPatient() and consume these
--   settings.
--
-- Phase discipline (per Phil 2026-05-26):
--   * "comms-suppression must be airtight — NO accidental patient/customer
--     contact; read-only + dry-run before going live"
--   * All seeded rows are DISABLED. Enabling is a deliberate per-clinic
--     decision and happens in Phase 4 (rollout).
--
-- Sibling Phase 1 artifacts referenced:
--   * patient_communications     — the ledger (20260526_patient_communications.sql)
--   * patient_comms_preferences  — per-patient opt-outs (20260526_patient_comms_preferences.sql)
--   * lib/comms-gateway.ts       — notifyPatient() entrypoint
--   * lib/comms-ledger.ts        — ledger repo wrapper

BEGIN;

CREATE TABLE IF NOT EXISTS clinic_reminder_settings (
    -- Mirrors the account_key CHECK on patient_communications + ghl_messages.
    -- One row per clinic-side account. Adding a new account_key requires
    -- updating that CHECK constraint in lockstep across all three tables.
    account_key             TEXT PRIMARY KEY
                              CHECK (account_key IN ('mensHealth','primaryCare','abxtac')),

    -- Safe default: every clinic ships DISABLED. A cron that reads this table
    -- must short-circuit when enabled=false so the rollout is opt-in per clinic.
    enabled                 BOOLEAN NOT NULL DEFAULT FALSE,

    -- The single reminder cadence. 24h is the standard; the column exists so
    -- a clinic can override (e.g. ABXTAC may want 48h for shipping windows).
    -- Bounded to prevent typo-driven blasts (1h–7d).
    hours_before            INTEGER NOT NULL DEFAULT 24
                              CHECK (hours_before BETWEEN 1 AND 168),

    -- Stable slug written to patient_communications.event_type. Phase 3
    -- writers MUST use this value so the ledger groups reminders cleanly.
    -- Templating into "appointment_reminder_<hours>h" is a writer concern.
    event_type              TEXT NOT NULL DEFAULT 'appointment_reminder_24h',

    -- Optional override of the gateway's default channel-priority
    -- (push → SMS → email). NULL means "use gateway default". A clinic can
    -- pin to a single channel (e.g. 'email' for ABXTAC if SMS/push are
    -- inappropriate for shipping confirmations).
    preferred_channel       TEXT
                              CHECK (preferred_channel IS NULL
                                  OR preferred_channel IN ('push','sms','email')),

    -- Soft-dedup window the writer passes to notifyPatient(). Matches the
    -- cadence by default so a 15-min cron retry can't double-fire even if
    -- the explicit idempotency_key somehow misses.
    dedup_window_minutes    INTEGER NOT NULL DEFAULT 1440
                              CHECK (dedup_window_minutes BETWEEN 0 AND 10080),

    notes                   TEXT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_clinic_reminder_settings_updated_at ON clinic_reminder_settings;
CREATE TRIGGER trg_clinic_reminder_settings_updated_at
    BEFORE UPDATE ON clinic_reminder_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE clinic_reminder_settings IS
    'Per-clinic appointment-reminder cadence (single 24h standard). Read by future appointment-reminder writers that call lib/comms-gateway notifyPatient(). enabled=FALSE blocks all sends for that clinic. Disabled-by-default per Phase 2 hard rule (comms-suppression must be airtight before any real-patient send).';

COMMENT ON COLUMN clinic_reminder_settings.account_key IS
    'Clinic identifier matching patient_communications.account_key CHECK.';
COMMENT ON COLUMN clinic_reminder_settings.enabled IS
    'When FALSE, writers MUST skip sending for this clinic. Default FALSE.';
COMMENT ON COLUMN clinic_reminder_settings.hours_before IS
    'Hours before appointment to fire the reminder. Standard = 24.';
COMMENT ON COLUMN clinic_reminder_settings.event_type IS
    'Stable event_type slug for the ledger row (e.g. appointment_reminder_24h).';
COMMENT ON COLUMN clinic_reminder_settings.preferred_channel IS
    'NULL = gateway default priority (push → SMS → email). Set to pin a single channel.';
COMMENT ON COLUMN clinic_reminder_settings.dedup_window_minutes IS
    'Soft-dedup window passed to notifyPatient(). Default 1440 (= 24h cadence).';

-- ---------------------------------------------------------------------------
-- Seed: one DISABLED row per account_key.
-- ---------------------------------------------------------------------------
-- ON CONFLICT keeps re-runs idempotent. Flipping enabled=true is a manual
-- per-clinic step (Phase 4) — never seed enabled=true here.
INSERT INTO clinic_reminder_settings (account_key, enabled, hours_before, event_type, preferred_channel, dedup_window_minutes, notes)
VALUES
    ('mensHealth',  FALSE, 24, 'appointment_reminder_24h', NULL, 1440,
        'Disabled at Phase 2 ship. Enable via UPDATE during Phase 4 rollout (row 20260526-192912-737c).'),
    ('primaryCare', FALSE, 24, 'appointment_reminder_24h', NULL, 1440,
        'Disabled at Phase 2 ship. Enable via UPDATE during Phase 4 rollout.'),
    ('abxtac',      FALSE, 24, 'appointment_reminder_24h', NULL, 1440,
        'Disabled at Phase 2 ship. Note: ABXTAC may prefer email-only — set preferred_channel=''email'' when enabling (row 20260526-192902-133c).')
ON CONFLICT (account_key) DO NOTHING;

COMMIT;
