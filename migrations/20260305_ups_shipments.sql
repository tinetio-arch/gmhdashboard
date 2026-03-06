-- UPS Shipments table for tracking medical supply shipments to patients
-- Created: March 5, 2026

CREATE TABLE IF NOT EXISTS ups_shipments (
  id                  SERIAL PRIMARY KEY,
  patient_id          UUID NOT NULL REFERENCES patients(patient_id),
  tracking_number     TEXT NOT NULL,
  shipment_id         TEXT,                 -- UPS shipment identification number (for voids)
  service_code        TEXT NOT NULL,        -- e.g. '03' = Ground, '02' = 2nd Day, '01' = Next Day
  service_name        TEXT,                 -- e.g. 'UPS Ground'
  status              TEXT NOT NULL DEFAULT 'label_created',
  -- status values: label_created, in_transit, out_for_delivery, delivered, voided, exception, returned
  ship_to_name        TEXT NOT NULL,
  ship_to_address     TEXT NOT NULL,
  ship_to_city        TEXT,
  ship_to_state       TEXT,
  ship_to_zip         TEXT,
  package_weight      NUMERIC(8,2),        -- lbs
  package_description TEXT,
  shipping_cost       NUMERIC(10,2),
  label_format        TEXT DEFAULT 'GIF',   -- GIF, PNG, ZPL
  label_data          TEXT,                 -- base64 encoded label image
  estimated_delivery  TEXT,
  actual_delivery     TIMESTAMPTZ,
  created_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_at           TIMESTAMPTZ,
  notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_ups_shipments_patient ON ups_shipments(patient_id);
CREATE INDEX IF NOT EXISTS idx_ups_shipments_tracking ON ups_shipments(tracking_number);
CREATE INDEX IF NOT EXISTS idx_ups_shipments_status ON ups_shipments(status);
