-- PHASE 7 (2026-05-19): Drop the dead patient_ghl_mapping table.
--
-- WHY: The GHL contact id now lives on patients.ghl_contact_id (alongside the
-- ghl_sync_status / ghl_sync_error / ghl_last_synced_at columns). The legacy
-- patient_ghl_mapping table was verified EMPTY (0 rows) with ZERO code
-- callsites — every GHL contact write goes through patients.ghl_contact_id.
-- It was only being chased by docs/DEPENDENCIES.md and the morning-pulse
-- snapshot (scripts/refresh-project-tracker.sh), both updated alongside this
-- migration.
--
-- Safety: guarded so re-running is a no-op, and we refuse to drop if a future
-- backfill ever populates it (paranoia — it is empty today).
DO $$
DECLARE
    row_count BIGINT;
BEGIN
    IF to_regclass('public.patient_ghl_mapping') IS NULL THEN
        RAISE NOTICE 'patient_ghl_mapping already absent — nothing to drop.';
        RETURN;
    END IF;

    EXECUTE 'SELECT COUNT(*) FROM patient_ghl_mapping' INTO row_count;
    IF row_count > 0 THEN
        RAISE EXCEPTION 'Refusing to drop patient_ghl_mapping: % rows present (expected 0). Investigate before dropping.', row_count;
    END IF;

    EXECUTE 'DROP TABLE patient_ghl_mapping';
    RAISE NOTICE 'Dropped empty patient_ghl_mapping table.';
END $$;
