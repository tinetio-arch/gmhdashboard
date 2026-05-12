-- Add charged_to column to payment_transactions to distinguish company-paid
-- (provider-billed peptide orders shipped to patient) from patient-paid charges.
-- Used by:
--   - app/api/ipad/billing/company-order/route.ts (writes charged_to='company')
--   - app/api/receipts/route.ts (returns charged_to so CEO dashboard can render badge)
--   - app/api/ipad/billing/refund/route.ts (uses to route refund to correct Stripe context)

ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS charged_to TEXT NOT NULL DEFAULT 'patient'
  CHECK (charged_to IN ('patient', 'company'));

CREATE INDEX IF NOT EXISTS idx_payment_transactions_charged_to
  ON payment_transactions (charged_to, created_at DESC);
