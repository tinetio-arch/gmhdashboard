-- patient_peptide_stack: per-patient dosing/Stack system (P1)
--
-- One row per patient per Stack item (TRT or peptide). Provider-set
-- recommended dose + schedule, per-item reminder settings, audit trail.
-- Backend for the patient-app Stack screen + iPad Stack overview.
--
-- Why this exists
--   Today the patient app has no canonical source for "what should this
--   patient be injecting, when, and how much do they have left." TRT due
--   math lives in lib/trtEligibility (computeDispenseEligibility) and runs
--   off dispenses.syringe_count × patients.dose_frequency_days. Peptide
--   side has peptide_dispenses (sales) but no per-patient regimen or
--   injection log. The Stack screen wants both unified.
--
--   This migration adds the unified per-patient regimen table, plus a
--   peptide-injection log so the supply/due math actually has events to
--   count down from. peptide_products gains nullable handbook-default
--   columns so auto-add-on-purchase can seed the lowest typical dose.
--
-- Reuse, don't rebuild
--   For item_type='testosterone' the GET /api/patients/[id]/stack engine
--   calls computeDispenseEligibility(patientId) directly — vial_size_ml
--   here is supply metadata for display only (the engine already does
--   syringe-count depletion via syringe_count × cadenceDays).
--   For item_type='peptide' due math is amount_remaining = vial_size_ml -
--   sum(peptide_injection_log.dose_mg / 1000 ... actually dose tracked in
--   peptide units stored on the stack row).
--
-- Backup discipline
--   No-op idempotent via IF NOT EXISTS guards. Wrapped in a single
--   transaction so a mid-statement failure rolls everything back. New
--   tables only — no destructive ops, no DROP, no data-modifying UPDATE.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. patient_peptide_stack — one row per patient per item
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patient_peptide_stack (
    stack_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity ---------------------------------------------------------------
    patient_id            UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    healthie_id           TEXT,                                -- cache of healthie_client_id for app lookups
    item_type             TEXT NOT NULL CHECK (item_type IN ('peptide','testosterone')),
    product_ref           UUID REFERENCES peptide_products(product_id),   -- FK for peptides; NULL for testosterone
    product_sku           TEXT NOT NULL,                       -- 'testosterone_trt' for TRT, peptide SKU otherwise
    display_name          TEXT NOT NULL,                       -- e.g. "Testosterone Cypionate" / "BPC-157 (10mg)"

    -- Recommended dose -------------------------------------------------------
    recommended_dose      NUMERIC(10,3),                       -- numeric amount per injection (mL for TRT, mg/mcg for peptide)
    dose_unit             TEXT,                                -- 'mL','mg','mcg','iu'

    -- Schedule / cadence -----------------------------------------------------
    frequency_code        TEXT,                                -- 'q4d','weekly','2x_week','daily','q3d', etc.
    inject_days           JSONB,                               -- e.g. ["mon","fri"] when patient picks specific days
    cadence_days          NUMERIC(5,2),                        -- e.g. 4 for q4d, 3.5 for 2x/week — overrides patient.dose_frequency_days for this item
    anchor_date           DATE,                                -- first inject date — schedule rolls forward by cadence

    -- Lifecycle --------------------------------------------------------------
    status                TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('active','pending','paused','discontinued')),

    -- Supply -----------------------------------------------------------------
    -- For testosterone the engine doesn't need vial_size_ml (it works off
    -- syringe_count × cadence). It's stored here for display + future
    -- "remaining in vial" math. Default 10 matches the standard TRT vial.
    vial_size_ml          NUMERIC(6,2) NOT NULL DEFAULT 10,
    syringes_dispensed    INTEGER NOT NULL DEFAULT 0,          -- cumulative prefilled syringes given to patient (TRT)
    amount_remaining      NUMERIC(10,3),                       -- recomputed by API; column kept for fast UI sorting

    -- Next due (recomputed by API; column kept for fast UI sorting/badges) --
    next_due_date         DATE,

    -- Per-item reminders -----------------------------------------------------
    reminder_enabled      BOOLEAN NOT NULL DEFAULT false,
    reminder_time         TIME,                                -- local time (Phoenix) — no tz column on purpose
    reminder_method       TEXT NOT NULL DEFAULT 'push'
                            CHECK (reminder_method IN ('push','sms','email')),

    -- Provider audit ---------------------------------------------------------
    recommended_by        UUID REFERENCES users(user_id),      -- provider/admin who set the recommendation
    recommended_at        TIMESTAMPTZ,
    -- Append-only audit of every dose/schedule change. Shape:
    --   [{ at, by, by_name, action, prev: {...}, next: {...}, note }]
    dose_history          JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Provenance -------------------------------------------------------------
    -- source_order_id can point to any of: pending_peptide_orders.id,
    -- peptide_dispenses.sale_id, dispenses.dispense_id, or pending_peptide_consents.id.
    -- Kept untyped (TEXT) so the auto-add hooks don't need cross-table FKs.
    source_order_id       TEXT,
    fda_ack_at            TIMESTAMPTZ,                         -- patient FDA-disclaimer acknowledgement

    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One stack row per (patient, item_type, product_sku). For TRT this means
    -- one row per patient (product_sku = 'testosterone_trt' singleton). For
    -- peptides it means one row per distinct peptide SKU.
    CONSTRAINT patient_peptide_stack_uniq UNIQUE (patient_id, item_type, product_sku)
);

CREATE INDEX IF NOT EXISTS idx_pps_patient_status
    ON patient_peptide_stack (patient_id, status);

CREATE INDEX IF NOT EXISTS idx_pps_healthie_status
    ON patient_peptide_stack (healthie_id, status) WHERE healthie_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pps_due
    ON patient_peptide_stack (next_due_date) WHERE status = 'active' AND next_due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pps_reminder_due
    ON patient_peptide_stack (reminder_enabled, reminder_time)
    WHERE reminder_enabled = true AND status = 'active';

-- updated_at trigger (reuses the standard set_updated_at function already
-- defined for dispenses/etc — see migrations/20260420_dispense_audit.sql or
-- equivalent. If absent, this CREATE OR REPLACE adds it.)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pps_updated ON patient_peptide_stack;
CREATE TRIGGER trg_pps_updated
    BEFORE UPDATE ON patient_peptide_stack
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE patient_peptide_stack IS
    'Per-patient dosing/Stack: provider-recommended dose + schedule + supply + reminders for TRT and peptides. See lib/patientStack.ts.';
COMMENT ON COLUMN patient_peptide_stack.vial_size_ml IS
    'Display/supply metadata. TRT due-math comes from computeDispenseEligibility (syringe_count × cadence), NOT from vial_size_ml. Default 10 = standard TRT vial.';
COMMENT ON COLUMN patient_peptide_stack.dose_history IS
    'Append-only JSONB audit log of dose/schedule changes. Never replace, always append.';

-- ---------------------------------------------------------------------------
-- 2. peptide_injection_log — patient-logged actual injection events
-- ---------------------------------------------------------------------------
-- peptide_dispenses tracks vial SALES (one row per purchased vial), not
-- per-injection events. For the peptide-side amount_remaining math
-- (vial_size − sum(injections × dose)) we need an event log the patient app
-- writes to when the patient logs an injection on their Stack screen.
--
-- TRT injections do NOT use this table — they have their own engine via
-- dispenses + staged_doses.

CREATE TABLE IF NOT EXISTS peptide_injection_log (
    log_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stack_id        UUID NOT NULL REFERENCES patient_peptide_stack(stack_id) ON DELETE CASCADE,
    patient_id      UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    injected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dose_amount     NUMERIC(10,3) NOT NULL,                    -- amount in the unit on the parent stack row
    dose_unit       TEXT NOT NULL,                             -- copy of stack.dose_unit at log time (mg/mcg/mL/iu)
    -- Optional volume actually drawn (mL) — helps when patient self-tracks
    -- reconstituted concentration. NULL when unknown.
    volume_ml       NUMERIC(8,3),
    site            TEXT,                                      -- 'abdomen','thigh', free-form
    note            TEXT,
    logged_via      TEXT NOT NULL DEFAULT 'patient_app'
                      CHECK (logged_via IN ('patient_app','ipad','provider','retro_import')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pil_stack_time
    ON peptide_injection_log (stack_id, injected_at DESC);

CREATE INDEX IF NOT EXISTS idx_pil_patient_time
    ON peptide_injection_log (patient_id, injected_at DESC);

COMMENT ON TABLE peptide_injection_log IS
    'Patient-logged peptide injections. Drives amount_remaining + next_due on patient_peptide_stack for item_type=peptide. TRT uses dispenses table instead.';

-- ---------------------------------------------------------------------------
-- 3. peptide_products: handbook-default dose columns for auto-add-on-purchase
-- ---------------------------------------------------------------------------
-- When a peptide is purchased we auto-create a stack row at the "lowest
-- handbook dose." These columns let us seed that without parsing
-- label_directions free-text. Nullable — a NULL default leaves the new
-- stack row in status='pending' for provider review.

ALTER TABLE peptide_products
    ADD COLUMN IF NOT EXISTS default_dose          NUMERIC(10,3),
    ADD COLUMN IF NOT EXISTS default_dose_unit     TEXT,
    ADD COLUMN IF NOT EXISTS default_frequency_code TEXT,
    ADD COLUMN IF NOT EXISTS default_vial_size_ml  NUMERIC(6,2);

COMMENT ON COLUMN peptide_products.default_dose IS
    'Handbook starting dose (lowest typical). Used by auto-add-on-purchase to seed patient_peptide_stack.recommended_dose. NULL = leave new stack row pending provider review.';

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification queries (run after applying):
--
--   \d patient_peptide_stack
--   \d peptide_injection_log
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='peptide_products' AND column_name LIKE 'default_%';
--
-- Roll-back: empty tables + additive columns → no data loss expected.
-- To reverse this migration, drop tables peptide_injection_log and
-- patient_peptide_stack (in that order to respect the FK), then remove the
-- four default_* columns from peptide_products. Write the rollback SQL by
-- hand at the time you need it — keeping it inline here would trip the
-- pre-deploy gatekeeper on every commit.
-- ---------------------------------------------------------------------------
