-- Peptide Order Tracking — unified pipeline view across both fulfillment channels.
--
-- Channel 'woo'    = ABXTac dropship (Mobile checkout + iPad ship-order → WC order → ShipStation → USPS)
-- Channel 'inhouse'= clinic dispense (iPad direct charge → peptide_dispenses → patient pickup)
--
-- One row per payment_transactions row. Populated by /api/cron/peptide-pipeline-sync every 15 min.
-- Read by /api/ipad/ceo/peptide-pipeline (no live WC calls on dashboard load).

CREATE TABLE IF NOT EXISTS peptide_order_tracking (
    tracking_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES payment_transactions(transaction_id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(patient_id),

    channel TEXT NOT NULL CHECK (channel IN ('woo', 'inhouse')),

    -- Pipeline stage. Same set of values both channels — UI maps to per-channel labels.
    --   charged          = Stripe ✅, nothing downstream yet
    --   wc_pending       = WC order created, status=processing
    --   wc_shipped       = WC order has tracking number / status=completed
    --   wc_delivered     = carrier reports delivered (future)
    --   inhouse_pending  = charged, awaiting education/pickup
    --   dispensed        = peptide_dispenses row written, inventory deducted
    --   picked_up        = received_date set on dispense
    --   stuck            = exceeded SLA threshold without progress
    --   refunded         = Stripe refund recorded
    stage TEXT NOT NULL CHECK (stage IN (
      'charged','wc_pending','wc_shipped','wc_delivered',
      'inhouse_pending','dispensed','picked_up',
      'stuck','refunded'
    )),

    -- WC pipeline data (channel='woo' only)
    wc_order_id INTEGER,
    wc_order_number TEXT,
    wc_status TEXT,
    tracking_number TEXT,
    tracking_carrier TEXT,
    tracking_url TEXT,
    shipped_at TIMESTAMP,
    delivered_at TIMESTAMP,

    -- In-house pipeline data (channel='inhouse' only)
    dispense_ids UUID[],
    education_complete BOOLEAN,
    received_date DATE,

    -- Stuck-detection metadata
    stuck_reason TEXT,        -- e.g. 'no_wc_order_24h', 'wc_processing_48h', 'no_tracking_72h', 'no_dispense_3d'
    age_hours INTEGER,        -- hours since payment_transactions.created_at

    last_synced_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    UNIQUE (payment_id)
);

CREATE INDEX IF NOT EXISTS idx_peptide_tracking_channel_stage
    ON peptide_order_tracking (channel, stage);
CREATE INDEX IF NOT EXISTS idx_peptide_tracking_synced
    ON peptide_order_tracking (last_synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_peptide_tracking_patient
    ON peptide_order_tracking (patient_id);
CREATE INDEX IF NOT EXISTS idx_peptide_tracking_stuck
    ON peptide_order_tracking (stage) WHERE stage = 'stuck';

-- updated_at trigger
CREATE OR REPLACE FUNCTION peptide_tracking_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_peptide_tracking_updated_at ON peptide_order_tracking;
CREATE TRIGGER trg_peptide_tracking_updated_at
  BEFORE UPDATE ON peptide_order_tracking
  FOR EACH ROW EXECUTE FUNCTION peptide_tracking_touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON peptide_order_tracking TO clinicadmin;

COMMENT ON TABLE peptide_order_tracking IS 'Unified pipeline tracking for peptide orders across WC dropship + in-house channels. Synced by /api/cron/peptide-pipeline-sync.';
