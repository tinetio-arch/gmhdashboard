-- Peptide Shop: prescription gating, Stripe customer mapping, product details, and charge tracking
-- Run: psql -f migrations/20260305_peptide_shop.sql

-- 1. Prescription gating: Provider approves patients for specific peptides
CREATE TABLE IF NOT EXISTS patient_approved_peptides (
  id SERIAL PRIMARY KEY,
  healthie_user_id TEXT NOT NULL,
  peptide_product_id INTEGER NOT NULL REFERENCES peptide_products(id),
  approved_by TEXT NOT NULL,
  approved_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  notes TEXT,
  active BOOLEAN DEFAULT true,
  UNIQUE(healthie_user_id, peptide_product_id)
);

-- 2. Map Healthie users to Stripe customers on peptide Stripe account
CREATE TABLE IF NOT EXISTS peptide_stripe_customers (
  id SERIAL PRIMARY KEY,
  healthie_user_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Add patient-facing columns to peptide_products
ALTER TABLE peptide_products
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS benefits TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS patient_visible BOOLEAN DEFAULT true;

-- 4. Add Stripe charge tracking to peptide_dispenses
ALTER TABLE peptide_dispenses
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS amount_charged NUMERIC(10,2);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_approved_peptides_user ON patient_approved_peptides(healthie_user_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_peptide_stripe_user ON peptide_stripe_customers(healthie_user_id);
CREATE INDEX IF NOT EXISTS idx_dispenses_stripe_pi ON peptide_dispenses(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
