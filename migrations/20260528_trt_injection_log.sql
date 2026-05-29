-- Phil 2026-05-28 — patient-self-logged TRT injections (NMH only).
--
-- Why: staff dispenses prefilled syringes; patients then inject AT HOME and
-- need to log the actual injection in the NowOptimal app so the TRT card
-- shows accurate next-due math and "doses left" instead of just assuming
-- they take it on schedule.
--
-- Boundary vs. peptide_injection_log:
--   peptide_injection_log → patient_peptide_stack items (peptides)
--   trt_injection_log     → testosterone, sourced from dispenses pipeline
-- Kept separate so the TRT eligibility engine (lib/trtEligibility.ts) can
-- count them in O(1) without filtering across types, and so a NULL
-- stack_id (TRT is a "virtual" stack item synthesized per patient) doesn't
-- pollute the peptide schema.

CREATE TABLE IF NOT EXISTS trt_injection_log (
  log_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  healthie_id   text,
  injected_at   timestamptz NOT NULL DEFAULT NOW(),
  dose_ml       numeric(10,3) NOT NULL CHECK (dose_ml > 0),
  syringes_used integer NOT NULL DEFAULT 1 CHECK (syringes_used > 0),
  site          text,
  note          text,
  logged_via    text NOT NULL DEFAULT 'patient_app'
                CHECK (logged_via IN ('patient_app', 'ipad', 'provider', 'retro_import')),
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  created_by    uuid REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_trt_inj_log_patient_recent
  ON trt_injection_log (patient_id, injected_at DESC);

COMMENT ON TABLE trt_injection_log IS
  'Patient-self-logged TRT injections from the NowOptimal app. NMH-only. '
  'Feeds lib/trtEligibility.computeDispenseEligibility — each row decrements '
  'syringes_remaining (relative to last dispense) and advances last_injection_at.';
