-- ────────────────────────────────────────────────────────────────────
-- BioBox At-Home Lab Kit Support
-- Additive migration: extends lab_orders to support Access Labs BioBox kits
-- ────────────────────────────────────────────────────────────────────
-- Supplier: Access Medical Labs (COMTRON) — https://access.labsvc.net
-- BioBox kits ship directly to patients (not collected at clinic).
-- All BioBox orders use clinic 22937, ordering provider Dr. Whitten NMD (NPI 1366037806).
-- Test codes are alpha-prefixed: B001, B002, B003, B004, B005, B006, B007,
--                                 B009, B010, B011, B013, B014, B015, B017.
--
-- This migration is PURELY ADDITIVE — no column drops, no renames, no data backfill.
-- Existing in-clinic lab orders continue to work unchanged (order_type defaults to 'in_clinic').
-- ────────────────────────────────────────────────────────────────────

-- 1. Distinguish BioBox from in-clinic draws
ALTER TABLE lab_orders
    ADD COLUMN IF NOT EXISTS order_type VARCHAR(20) NOT NULL DEFAULT 'in_clinic';
    -- Values: 'in_clinic' | 'biobox'

-- 2. Which BioBox kit SKU was ordered (B###)
ALTER TABLE lab_orders
    ADD COLUMN IF NOT EXISTS biobox_kit_sku VARCHAR(10);
    -- e.g., 'B004' (Thyroid Quick Check), 'B013' (Weight Loss & Management)

-- 3. Ship-to address second line (apt/unit)
ALTER TABLE lab_orders
    ADD COLUMN IF NOT EXISTS patient_address_2 VARCHAR(100);

-- 4. Kit shipping tracking (populated by Access Labs or manual entry)
ALTER TABLE lab_orders
    ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(100);

ALTER TABLE lab_orders
    ADD COLUMN IF NOT EXISTS shipping_carrier VARCHAR(50);
    -- e.g., 'USPS', 'UPS', 'FedEx'

ALTER TABLE lab_orders
    ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMP;

ALTER TABLE lab_orders
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP;

-- 5. Link back to WooCommerce order (for BioBox purchases via abxtac.com)
ALTER TABLE lab_orders
    ADD COLUMN IF NOT EXISTS woo_order_id INTEGER;

-- 6. Track Thrive-tier "1 included BioBox panel/year" redemptions
ALTER TABLE lab_orders
    ADD COLUMN IF NOT EXISTS included_panel_redemption BOOLEAN NOT NULL DEFAULT FALSE;
    -- TRUE when this order consumed the Thrive member's annual included panel

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lab_orders_order_type ON lab_orders(order_type);
CREATE INDEX IF NOT EXISTS idx_lab_orders_woo_order_id ON lab_orders(woo_order_id);
CREATE INDEX IF NOT EXISTS idx_lab_orders_biobox_kit_sku ON lab_orders(biobox_kit_sku);

-- ────────────────────────────────────────────────────────────────────
-- Verification queries (for post-migration sanity check):
--
--   -- existing in-clinic orders should all show order_type='in_clinic':
--   SELECT order_type, COUNT(*) FROM lab_orders GROUP BY order_type;
--
--   -- confirm new columns exist:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='lab_orders'
--       AND column_name IN ('order_type','biobox_kit_sku','tracking_number','woo_order_id');
-- ────────────────────────────────────────────────────────────────────
