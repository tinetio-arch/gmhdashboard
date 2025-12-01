-- Migration: Ensure payment_issues and payment_sync_log tables exist
-- This migration backfills the core payment integration tables that the
-- application code expects for QuickBooks, ClinicSync, and automated
-- financial monitoring workflows.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-------------------------------------------------------------------------------
-- payment_issues: unified view of delinquent or failed payments across systems
-------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payment_issues (
  issue_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  issue_type TEXT NOT NULL CHECK (
    issue_type IN (
      'overdue_invoice',
      'outstanding_balance',
      'payment_declined',
      'failed_payment',
      'membership_delinquent',
      'contract_expired',
      'payment_failed',
      'insufficient_funds',
      'unpaid_balance',
      'unknown'
    )
  ),
  issue_severity TEXT NOT NULL CHECK (
    issue_severity IN ('info', 'warning', 'critical')
  ),
  amount_owed NUMERIC(12, 2) NOT NULL DEFAULT 0,
  days_overdue INTEGER,
  qb_invoice_id TEXT,
  qb_sales_receipt_id TEXT,
  previous_status_key TEXT,
  status_changed_to TEXT,
  auto_updated BOOLEAN NOT NULL DEFAULT FALSE,
  resolution_notes TEXT,
  resolved_at TIMESTAMP,
  resolved_by UUID REFERENCES users(user_id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Surface the most recent unresolved issues efficiently.
CREATE INDEX IF NOT EXISTS idx_payment_issues_patient_unresolved
  ON payment_issues(patient_id, created_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payment_issues_type_unresolved
  ON payment_issues(issue_type)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payment_issues_qb_invoice
  ON payment_issues(qb_invoice_id)
  WHERE qb_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_issues_qb_sales_receipt
  ON payment_issues(qb_sales_receipt_id)
  WHERE qb_sales_receipt_id IS NOT NULL;

-- Prevent duplicate unresolved issues for the same source record.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_issues_open_source
  ON payment_issues (
    patient_id,
    issue_type,
    COALESCE(qb_invoice_id, ''),
    COALESCE(qb_sales_receipt_id, '')
  )
  WHERE resolved_at IS NULL;

CREATE OR REPLACE FUNCTION payment_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_issues_updated ON payment_issues;
CREATE TRIGGER trg_payment_issues_updated
  BEFORE UPDATE ON payment_issues
  FOR EACH ROW
  EXECUTE FUNCTION payment_touch_updated_at();

-------------------------------------------------------------------------------
-- payment_sync_log: operational log for background sync jobs
-------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payment_sync_log (
  sync_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sync_type TEXT NOT NULL,
  sync_status TEXT NOT NULL CHECK (sync_status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  records_processed INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  records_failed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_by UUID REFERENCES users(user_id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_sync_log_type_started
  ON payment_sync_log(sync_type, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_sync_log_status
  ON payment_sync_log(sync_status)
  WHERE sync_status = 'running';

CREATE OR REPLACE FUNCTION payment_sync_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_sync_log_updated ON payment_sync_log;
CREATE TRIGGER trg_payment_sync_log_updated
  BEFORE UPDATE ON payment_sync_log
  FOR EACH ROW
  EXECUTE FUNCTION payment_sync_touch_updated_at();


