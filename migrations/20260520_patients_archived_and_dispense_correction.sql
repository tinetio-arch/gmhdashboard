-- ============================================================================
-- Migration — patients_archived table + dispenses.corrected_from_patient_id
-- Status: Phil-approved 2026-05-20 (dedup "full per-record split", Keira/Greg Gannon).
-- Implements SOT module 25 §7.3 (soft-archive, never hard-delete) + §7.6
-- (dispense misattribution correction records the original wrong patient_id).
-- These are the prerequisites for the first real patient merge; both are
-- additive / non-destructive DDL.
--
-- Applied in-transaction by .tmp/dedup-keira-split.js (DDL + data move + archive
-- are one atomic unit). This file is the canonical repo record of the schema.
-- ============================================================================

-- 1) Soft-archive table for merged/duplicate patient rows (SOT §7.3).
--    Mirror of `patients` plus archive metadata. No FK to patients (the live
--    row is removed on archive); merged_into_patient_id is an advisory pointer.
CREATE TABLE IF NOT EXISTS patients_archived (
  LIKE patients INCLUDING DEFAULTS
);
ALTER TABLE patients_archived
  ADD COLUMN IF NOT EXISTS archived_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS archived_by         TEXT,
  ADD COLUMN IF NOT EXISTS archived_reason     TEXT,
  ADD COLUMN IF NOT EXISTS merged_into_patient_id UUID;

-- patient_id is the natural key for an archived row; prevent accidental dupes.
-- (LIKE ... INCLUDING DEFAULTS does not copy the PK, so add it; guard for re-run.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patients_archived_pkey'
  ) THEN
    ALTER TABLE patients_archived ADD CONSTRAINT patients_archived_pkey PRIMARY KEY (patient_id);
  END IF;
END $$;

-- 2) Record the original (wrong) patient on a misattribution-corrected dispense
--    (SOT §7.6 step 5). Plain UUID, no FK — the original row may be archived.
ALTER TABLE dispenses
  ADD COLUMN IF NOT EXISTS corrected_from_patient_id UUID;

COMMENT ON COLUMN dispenses.corrected_from_patient_id IS
  'SOT §7.6: original patient_id this dispense was reassigned away from (misattribution correction). NULL = never reassigned.';
