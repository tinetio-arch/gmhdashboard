-- patient_comms_preferences + v_patient_comms_profile
--
-- The single per-patient signal the comms-gateway (lib/comms-gateway.ts) reads
-- to decide channel routing + suppression. Phase 1 of project
-- "untangling-healthie-communications-from-healthie".
--
-- Sibling sessions today shipped:
--   * patient_communications  (ledger, 20260526_patient_communications.sql)
--   * lib/comms-gateway.ts    (notifyPatient() chokepoint, no opt-out logic yet)
--   * lib/comms-ledger.ts     (thin repo wrapper)
--
-- This migration adds the missing input signal. NO writers, NO callers wired —
-- the gateway will swap its current eligibility logic to read from
-- v_patient_comms_profile in a later phase.
--
-- SAFETY (per Phil 2026-05-26 q_20260526_155124_139ac3 answer):
--   * Entire comms-gateway stack must be fully tested before any real-patient
--     send. Phase 1 is read-only so it cannot cause sends on its own.
--   * Clinical/lab content is NEVER auto-sent. lab_critical / clinical results
--     are out of scope — humans handle by phone. Bypass map lives in
--     lib/comms-profile.ts and explicitly excludes any clinical category.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. App-state instrumentation on patient_push_tokens
-- ---------------------------------------------------------------------------
-- app_version: reported by mobile on heartbeat (NULL until mobile is wired in
-- a future phase; the view treats NULL as "unknown — assume current").
-- last_heartbeat_at: distinct from last_seen_at (which Expo updates on token
-- register/refresh). Heartbeat is a stronger "app is alive on this device"
-- signal, set by a foreground ping. NULL until mobile is wired.
ALTER TABLE patient_push_tokens
    ADD COLUMN IF NOT EXISTS app_version       TEXT,
    ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 2. patient_comms_preferences — locally-managed opt-out overrides
-- ---------------------------------------------------------------------------
-- One row per patient (NOT per account_key — Phil 2026-05-26 Q1).
-- Row may be absent — view LEFT JOINs and treats absence as "no opt-outs".
--
-- channel_optouts shape:
--   { "push": true, "sms": false, "email": false, "voice": true }
--   Missing key = NOT opted out. We store the explicit value when set so we
--   can tell "deliberately allowed" from "never asked".
--
-- category_optouts shape:
--   { "billing": false, "messages": true, "appointments": false,
--     "promotions": true, "announcements": false, "results": false }
--   Categories mirror the existing patient_push_tokens.preferences keys for
--   continuity. "results" here means routine "your labs are ready to view"
--   notifications — NOT critical-value escalation (those are phone-only,
--   see SAFETY note above).
--
-- updated_by_user_id is TEXT (not FK) because edits can come from staff
-- (users.user_id UUID), patient self-serve (Healthie/mobile), or system
-- backfills ('system'). Free-form by design.
CREATE TABLE IF NOT EXISTS patient_comms_preferences (
    patient_id          UUID PRIMARY KEY REFERENCES patients(patient_id) ON DELETE CASCADE,
    channel_optouts     JSONB NOT NULL DEFAULT '{}'::jsonb,
    category_optouts    JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes               TEXT,
    updated_by_user_id  TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_patient_comms_preferences_updated_at ON patient_comms_preferences;
CREATE TRIGGER trg_patient_comms_preferences_updated_at
    BEFORE UPDATE ON patient_comms_preferences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. v_patient_comms_profile — the single read point
-- ---------------------------------------------------------------------------
-- Gateway calls one SELECT against this view. All derivation lives here so
-- the TypeScript read API stays a thin shape-mapper.
--
-- Eligibility semantics (each column is "can we send on this channel"):
--   push_eligible  = has any active push token AND not opted out of push
--   sms_eligible   = has phone + GHL contact AND not opted out of SMS
--   email_eligible = has email AND not opted out of email
--   voice_eligible = has phone AND not opted out of voice
-- Channel viability (phone/email/etc presence) is computed separately from
-- opt-out so the gateway can log a precise suppress_reason.

CREATE OR REPLACE VIEW v_patient_comms_profile AS
WITH push_agg AS (
    SELECT
        healthie_client_id,
        BOOL_OR(active)                                            AS app_installed,
        COUNT(*) FILTER (WHERE active)                             AS active_device_count,
        MAX(last_seen_at)      FILTER (WHERE active)               AS last_seen_at,
        MAX(last_heartbeat_at) FILTER (WHERE active)               AS last_heartbeat_at,
        -- app_version_max: NULL when no device has reported a version yet.
        -- Lexicographic max is fine for semver-ish "x.y.z" strings within
        -- the same major; the gateway treats this as informational only.
        MAX(app_version)       FILTER (WHERE active)               AS app_version_max,
        -- Per-device category prefs OR'd together: if ANY device opted in for
        -- a category, the patient is considered opted in (matches the
        -- existing loadTokensForPatient() semantics in lib/expoPush.ts).
        BOOL_OR(COALESCE((preferences->>'billing')::boolean,       TRUE)) FILTER (WHERE active) AS device_pref_billing,
        BOOL_OR(COALESCE((preferences->>'results')::boolean,       TRUE)) FILTER (WHERE active) AS device_pref_results,
        BOOL_OR(COALESCE((preferences->>'messages')::boolean,      TRUE)) FILTER (WHERE active) AS device_pref_messages,
        BOOL_OR(COALESCE((preferences->>'promotions')::boolean,    FALSE)) FILTER (WHERE active) AS device_pref_promotions,
        BOOL_OR(COALESCE((preferences->>'appointments')::boolean,  TRUE)) FILTER (WHERE active) AS device_pref_appointments,
        BOOL_OR(COALESCE((preferences->>'announcements')::boolean, TRUE)) FILTER (WHERE active) AS device_pref_announcements
    FROM patient_push_tokens
    GROUP BY healthie_client_id
)
SELECT
    p.patient_id,
    p.healthie_client_id,
    p.ghl_contact_id,
    p.phone_primary,
    p.email,
    p.clinic,

    -- ---- app state ----
    COALESCE(pa.app_installed, FALSE)                                  AS app_installed,
    COALESCE(pa.active_device_count, 0)                                AS active_device_count,
    pa.last_seen_at                                                    AS push_last_seen_at,
    pa.last_heartbeat_at                                               AS push_last_heartbeat_at,
    pa.app_version_max                                                 AS app_version_max,

    -- ---- channel viability (can we physically reach them) ----
    COALESCE(pa.app_installed, FALSE)                                  AS push_reachable,
    (p.phone_primary IS NOT NULL AND p.ghl_contact_id IS NOT NULL)     AS sms_reachable,
    (p.email IS NOT NULL)                                              AS email_reachable,
    (p.phone_primary IS NOT NULL)                                      AS voice_reachable,

    -- ---- channel opt-outs (local override; missing key = not opted out) ----
    COALESCE((cp.channel_optouts->>'push')::boolean,  FALSE)           AS push_optout,
    COALESCE((cp.channel_optouts->>'sms')::boolean,   FALSE)           AS sms_optout,
    COALESCE((cp.channel_optouts->>'email')::boolean, FALSE)           AS email_optout,
    COALESCE((cp.channel_optouts->>'voice')::boolean, FALSE)           AS voice_optout,

    -- ---- channel eligibility (reachable AND not opted out) ----
    (COALESCE(pa.app_installed, FALSE) AND NOT COALESCE((cp.channel_optouts->>'push')::boolean, FALSE))
        AS push_eligible,
    (p.phone_primary IS NOT NULL AND p.ghl_contact_id IS NOT NULL
        AND NOT COALESCE((cp.channel_optouts->>'sms')::boolean, FALSE))
        AS sms_eligible,
    (p.email IS NOT NULL AND NOT COALESCE((cp.channel_optouts->>'email')::boolean, FALSE))
        AS email_eligible,
    (p.phone_primary IS NOT NULL AND NOT COALESCE((cp.channel_optouts->>'voice')::boolean, FALSE))
        AS voice_eligible,

    -- ---- category opt-outs (patient-level override beats per-device push pref) ----
    -- Effective category pref = local override (if set) ELSE per-device push pref
    -- (defaulting per the existing patient_push_tokens.preferences defaults).
    COALESCE(
        NOT (cp.category_optouts->>'billing')::boolean,
        pa.device_pref_billing,
        TRUE
    )                                                                  AS allow_billing,
    COALESCE(
        NOT (cp.category_optouts->>'results')::boolean,
        pa.device_pref_results,
        TRUE
    )                                                                  AS allow_results,
    COALESCE(
        NOT (cp.category_optouts->>'messages')::boolean,
        pa.device_pref_messages,
        TRUE
    )                                                                  AS allow_messages,
    COALESCE(
        NOT (cp.category_optouts->>'promotions')::boolean,
        pa.device_pref_promotions,
        FALSE
    )                                                                  AS allow_promotions,
    COALESCE(
        NOT (cp.category_optouts->>'appointments')::boolean,
        pa.device_pref_appointments,
        TRUE
    )                                                                  AS allow_appointments,
    COALESCE(
        NOT (cp.category_optouts->>'announcements')::boolean,
        pa.device_pref_announcements,
        TRUE
    )                                                                  AS allow_announcements,

    -- ---- raw payloads (for read API to expose without re-parsing) ----
    COALESCE(cp.channel_optouts,  '{}'::jsonb)                         AS channel_optouts_raw,
    COALESCE(cp.category_optouts, '{}'::jsonb)                         AS category_optouts_raw,
    cp.notes                                                           AS prefs_notes,
    cp.updated_at                                                      AS prefs_updated_at,
    cp.updated_by_user_id                                              AS prefs_updated_by
FROM patients p
LEFT JOIN push_agg pa
    ON pa.healthie_client_id = p.healthie_client_id::text
LEFT JOIN patient_comms_preferences cp
    ON cp.patient_id = p.patient_id;

COMMIT;
