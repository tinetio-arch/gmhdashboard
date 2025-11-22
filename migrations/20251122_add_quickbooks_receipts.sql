-- QuickBooks sales receipts + payment transactions tables

CREATE TABLE IF NOT EXISTS quickbooks_sales_receipts (
  qb_sales_receipt_id TEXT PRIMARY KEY,
  qb_customer_id TEXT NOT NULL,
  patient_id UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  receipt_number TEXT,
  receipt_date DATE,
  amount NUMERIC,
  status TEXT,
  payment_method TEXT,
  note TEXT,
  recurring_txn_id TEXT,
  qb_sync_date TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qbo_sales_receipts_patient ON quickbooks_sales_receipts (patient_id);
CREATE INDEX IF NOT EXISTS idx_qbo_sales_receipts_customer ON quickbooks_sales_receipts (qb_customer_id);
CREATE INDEX IF NOT EXISTS idx_qbo_sales_receipts_date ON quickbooks_sales_receipts (receipt_date);

CREATE TABLE IF NOT EXISTS quickbooks_payment_transactions (
  qb_payment_id TEXT PRIMARY KEY,
  qb_customer_id TEXT NOT NULL,
  patient_id UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  payment_number TEXT,
  payment_date DATE,
  amount NUMERIC,
  deposit_account TEXT,
  payment_method TEXT,
  qb_sync_date TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qbo_payment_transactions_patient ON quickbooks_payment_transactions (patient_id);
CREATE INDEX IF NOT EXISTS idx_qbo_payment_transactions_customer ON quickbooks_payment_transactions (qb_customer_id);
CREATE INDEX IF NOT EXISTS idx_qbo_payment_transactions_date ON quickbooks_payment_transactions (payment_date);

ALTER TABLE payment_issues
  ADD COLUMN IF NOT EXISTS qb_sales_receipt_id TEXT;

CREATE INDEX IF NOT EXISTS idx_payment_issues_sales_receipt
  ON payment_issues (qb_sales_receipt_id)
  WHERE qb_sales_receipt_id IS NOT NULL;

