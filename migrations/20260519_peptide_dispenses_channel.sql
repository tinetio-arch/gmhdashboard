-- Peptide Dispenses Channel Discriminator
--
-- Adds a `channel` column to peptide_dispenses so the dashboard / iPad
-- can tell ship-to dispenses (ABXTAC WooCommerce) apart from in-house
-- dispenses (iPad direct charge → clinic pickup).
--
-- Why this matters:
--   peptide_order_tracking already has channel='woo'|'inhouse', but
--   peptide_dispenses rows are channel-unaware. As a result, ship-to
--   dispenses (which never go through clinic education) show
--   "Education: incomplete" forever on the iPad. ABXTAC handles
--   education at WC checkout — our DB shouldn't gate on it for ship-to.
--
-- Phil's intent: ship-to patients do NOT need clinic education. The fix
-- REMOVES friction (education prompts on ship-to surfaces) — it does
-- NOT add new gates.
--
-- Backwards compat: column is NOT NULL with DEFAULT 'inhouse', so every
-- existing reader continues to see all rows. Backfill flips ship-to rows
-- to 'woo' based on the `notes` marker we already write in ship-order
-- (`Shipped via ABX TAC -- ...`) and on the WC-order linkage in
-- payment_transactions.

BEGIN;

ALTER TABLE peptide_dispenses
    ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'inhouse';

-- Add CHECK constraint separately so the IF NOT EXISTS guard doesn't fight us.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'peptide_dispenses_channel_check'
    ) THEN
        ALTER TABLE peptide_dispenses
            ADD CONSTRAINT peptide_dispenses_channel_check
            CHECK (channel IN ('woo', 'inhouse'));
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_peptide_dispenses_channel
    ON peptide_dispenses (channel);

-- Backfill #1: rows tagged "Shipped via ABX TAC" in notes (created by
-- app/api/ipad/billing/ship-order/route.ts).
UPDATE peptide_dispenses
   SET channel = 'woo'
 WHERE notes ILIKE 'Shipped via ABX TAC%'
   AND channel <> 'woo';

-- Backfill #2: rows whose Stripe PaymentIntent links to a payment_transactions
-- row that has a WooCommerce order id (means the charge was processed through
-- the ship-order route, even if the notes string was different).
UPDATE peptide_dispenses pd
   SET channel = 'woo'
  FROM payment_transactions pt
 WHERE pd.stripe_payment_intent_id IS NOT NULL
   AND pd.stripe_payment_intent_id = pt.stripe_charge_id
   AND pt.woocommerce_order_id IS NOT NULL
   AND pd.channel <> 'woo';

COMMENT ON COLUMN peptide_dispenses.channel IS
  'Fulfillment channel: ''woo'' = ABXTAC WooCommerce ship-to-patient (no clinic education), ''inhouse'' = iPad direct charge → clinic pickup (education required). Matches peptide_order_tracking.channel.';

COMMIT;

-- Sanity-check (run after applying): expect a healthy split between
-- 'inhouse' and 'woo' rows; the ship-to-only patient examples
-- (Ryan Foster, Heather Ramirez, Jodi Ellsworth) should be 'woo'.
--
--   SELECT channel, COUNT(*) FROM peptide_dispenses GROUP BY channel;
--   SELECT sale_id, status, education_complete, channel
--     FROM peptide_dispenses
--    WHERE notes ILIKE '%ABX TAC%'
--    LIMIT 5;
