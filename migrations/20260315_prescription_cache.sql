-- Migration: Create prescription_cache table
-- This caches DoseSpot prescription data fetched via Healthie's GraphQL API.
-- Used as fallback when Healthie is unavailable and for background analytics.

CREATE TABLE IF NOT EXISTS prescription_cache (
  id                          SERIAL PRIMARY KEY,
  healthie_patient_id         TEXT NOT NULL,
  prescription_id             TEXT NOT NULL,

  -- Drug info
  product_name                TEXT,
  display_name                TEXT,
  dosage                      TEXT,
  dose_form                   TEXT,
  directions                  TEXT,
  quantity                    TEXT,
  unit                        TEXT,
  refills                     INTEGER,
  days_supply                 INTEGER,

  -- Status
  status                      TEXT,              -- Free-text status from DoseSpot
  normalized_status           TEXT NOT NULL DEFAULT 'active',  -- active|inactive|pending|error|hidden
  drug_classification         TEXT,
  schedule                    TEXT,              -- Controlled substance schedule: II, III, IV, V, or NULL

  -- Identifiers
  ndc                         TEXT,
  rxcui                       TEXT,

  -- Dates
  date_written                TEXT,
  effective_date              TEXT,
  date_inactive               TEXT,
  last_fill_date              TEXT,

  -- Prescriber
  prescriber_name             TEXT,
  prescriber_id               TEXT,

  -- Notes
  comment                     TEXT,
  pharmacy_notes              TEXT,

  -- Flags
  no_substitutions            BOOLEAN DEFAULT false,
  is_rx_renewal               BOOLEAN DEFAULT false,
  is_urgent                   BOOLEAN DEFAULT false,
  error_ignored               BOOLEAN DEFAULT false,
  formulary                   BOOLEAN,
  otc                         BOOLEAN DEFAULT false,

  -- Additional
  route                       TEXT,
  type                        TEXT,
  rx_reference_number         TEXT,

  -- Pharmacy (flattened from nested object)
  pharmacy_name               TEXT,
  pharmacy_address            TEXT,
  pharmacy_city               TEXT,
  pharmacy_state              TEXT,
  pharmacy_zip                TEXT,
  pharmacy_phone              TEXT,
  pharmacy_fax                TEXT,

  -- Diagnoses
  first_prescription_diagnosis  TEXT,
  second_prescription_diagnosis TEXT,

  -- Metadata
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  UNIQUE(healthie_patient_id, prescription_id)
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_rx_cache_patient
  ON prescription_cache (healthie_patient_id);

CREATE INDEX IF NOT EXISTS idx_rx_cache_status
  ON prescription_cache (normalized_status);

CREATE INDEX IF NOT EXISTS idx_rx_cache_controlled
  ON prescription_cache (schedule)
  WHERE schedule IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rx_cache_date_written
  ON prescription_cache (date_written DESC);

CREATE INDEX IF NOT EXISTS idx_rx_cache_patient_active
  ON prescription_cache (healthie_patient_id, normalized_status)
  WHERE normalized_status = 'active';

-- Comment
COMMENT ON TABLE prescription_cache IS 'Cached DoseSpot prescriptions fetched via Healthie GraphQL API. Updated on patient view and via cron sync.';
