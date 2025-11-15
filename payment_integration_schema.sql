-- Payment Integration Schema
-- Extends the clinic schema to support QuickBooks and Go-High-Level integrations
-- for tracking patient payments and automatically managing eligibility

-------------------------------------------------------------------------------
-- OAuth token storage (for QuickBooks API authentication)
-------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS quickbooks_oauth_tokens (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    realm_id            TEXT NOT NULL UNIQUE,
    access_token        TEXT NOT NULL,
    refresh_token       TEXT NOT NULL,
    expires_at          TIMESTAMP NOT NULL,
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qb_oauth_tokens_realm 
    ON quickbooks_oauth_tokens (realm_id);
CREATE INDEX IF NOT EXISTS idx_qb_oauth_tokens_expires 
    ON quickbooks_oauth_tokens (expires_at);

-- Trigger for updated_at
DO $$
BEGIN
    CREATE TRIGGER trg_qb_oauth_tokens_updated
        BEFORE UPDATE ON quickbooks_oauth_tokens
        FOR EACH ROW
        EXECUTE FUNCTION touch_payment_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-------------------------------------------------------------------------------
-- Payment tracking tables
-------------------------------------------------------------------------------

-- Track payment sync status and history
CREATE TABLE IF NOT EXISTS payment_sync_log (
    sync_id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sync_type            TEXT NOT NULL CHECK (sync_type IN ('quickbooks', 'ghl', 'manual')),
    sync_status          TEXT NOT NULL CHECK (sync_status IN ('pending', 'running', 'completed', 'failed')),
    records_processed    INTEGER DEFAULT 0,
    records_updated      INTEGER DEFAULT 0,
    records_failed       INTEGER DEFAULT 0,
    error_message        TEXT,
    started_at           TIMESTAMP DEFAULT NOW(),
    completed_at         TIMESTAMP,
    created_by           UUID REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_sync_log_type_status 
    ON payment_sync_log (sync_type, sync_status);
CREATE INDEX IF NOT EXISTS idx_payment_sync_log_started 
    ON payment_sync_log (started_at DESC);

-- Track individual payment records from QuickBooks
CREATE TABLE IF NOT EXISTS quickbooks_payments (
    qb_payment_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    qb_invoice_id          TEXT,
    qb_customer_id         TEXT,
    patient_id             UUID REFERENCES patients(patient_id) ON DELETE SET NULL,
    invoice_number         TEXT,
    invoice_date           DATE,
    due_date               DATE,
    amount_due             NUMERIC(12,2),
    amount_paid            NUMERIC(12,2),
    balance                NUMERIC(12,2),
    payment_status         TEXT CHECK (payment_status IN ('paid', 'partial', 'overdue', 'open')),
    days_overdue           INTEGER,
    last_payment_date      DATE,
    qb_sync_date           TIMESTAMP DEFAULT NOW(),
    created_at             TIMESTAMP DEFAULT NOW(),
    updated_at             TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qb_payments_patient 
    ON quickbooks_payments (patient_id);
CREATE INDEX IF NOT EXISTS idx_qb_payments_customer 
    ON quickbooks_payments (qb_customer_id);
CREATE INDEX IF NOT EXISTS idx_qb_payments_status 
    ON quickbooks_payments (payment_status);
CREATE INDEX IF NOT EXISTS idx_qb_payments_overdue 
    ON quickbooks_payments (days_overdue) WHERE days_overdue > 0;

-- Memberships table (if not exists in base schema)
CREATE TABLE IF NOT EXISTS memberships (
    membership_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id           UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    program_name          TEXT,
    status                TEXT,
    fee_amount            NUMERIC(12,2),
    balance_owed          NUMERIC(12,2),
    next_charge_date      DATE,
    last_charge_date      DATE,
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW(),
    UNIQUE (patient_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_patient 
    ON memberships (patient_id);
CREATE INDEX IF NOT EXISTS idx_memberships_next_charge 
    ON memberships (next_charge_date) WHERE next_charge_date IS NOT NULL;

-- Track patient-to-QuickBooks customer mapping
CREATE TABLE IF NOT EXISTS patient_qb_mapping (
    mapping_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id            UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    qb_customer_id        TEXT NOT NULL,
    qb_customer_email     TEXT,
    qb_customer_name      TEXT,
    match_method          TEXT CHECK (match_method IN ('email', 'name', 'phone', 'manual')),
    is_active             BOOLEAN DEFAULT TRUE,
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW(),
    UNIQUE (patient_id, qb_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_patient_qb_mapping_patient 
    ON patient_qb_mapping (patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_qb_mapping_qb_customer 
    ON patient_qb_mapping (qb_customer_id);

-- Track patient-to-Go-High-Level contact mapping
CREATE TABLE IF NOT EXISTS patient_ghl_mapping (
    mapping_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id             UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    ghl_contact_id         TEXT NOT NULL,
    ghl_location_id        TEXT,
    match_method           TEXT CHECK (match_method IN ('email', 'phone', 'name', 'manual')),
    is_active              BOOLEAN DEFAULT TRUE,
    created_at             TIMESTAMP DEFAULT NOW(),
    updated_at             TIMESTAMP DEFAULT NOW(),
    UNIQUE (patient_id, ghl_contact_id)
);

CREATE INDEX IF NOT EXISTS idx_patient_ghl_mapping_patient 
    ON patient_ghl_mapping (patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_ghl_mapping_ghl_contact 
    ON patient_ghl_mapping (ghl_contact_id);

-- Payment issue tracking - records when patients are marked ineligible due to payment
CREATE TABLE IF NOT EXISTS payment_issues (
    issue_id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id             UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    issue_type             TEXT NOT NULL CHECK (issue_type IN ('overdue_invoice', 'unpaid_balance', 'failed_payment', 'payment_declined')),
    issue_severity         TEXT NOT NULL CHECK (issue_severity IN ('warning', 'critical')),
    amount_owed            NUMERIC(12,2),
    days_overdue           INTEGER,
    qb_invoice_id          TEXT,
    previous_status_key    TEXT,
    status_changed_to      TEXT,
    auto_updated           BOOLEAN DEFAULT FALSE,
    resolved_at            TIMESTAMP,
    resolved_by            UUID REFERENCES users(user_id),
    resolution_notes       TEXT,
    created_at             TIMESTAMP DEFAULT NOW(),
    updated_at             TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_issues_patient 
    ON payment_issues (patient_id);
CREATE INDEX IF NOT EXISTS idx_payment_issues_resolved 
    ON payment_issues (resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payment_issues_severity 
    ON payment_issues (issue_severity) WHERE resolved_at IS NULL;

-- Configuration for payment rules
CREATE TABLE IF NOT EXISTS payment_rules (
    rule_id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_name              TEXT NOT NULL UNIQUE,
    rule_description       TEXT,
    min_days_overdue       INTEGER DEFAULT 30,
    min_amount_threshold    NUMERIC(12,2) DEFAULT 0.00,
    auto_update_status     BOOLEAN DEFAULT TRUE,
    target_status_key      TEXT REFERENCES patient_status_lookup(status_key),
    is_active              BOOLEAN DEFAULT TRUE,
    created_at             TIMESTAMP DEFAULT NOW(),
    updated_at             TIMESTAMP DEFAULT NOW()
);

-- Insert default payment rule
INSERT INTO payment_rules (rule_name, rule_description, min_days_overdue, min_amount_threshold, auto_update_status, target_status_key)
VALUES 
    ('Default Overdue Rule', 'Automatically mark patients as ineligible if they have invoices overdue by 30+ days', 30, 0.00, TRUE, 'hold_payment_research')
ON CONFLICT (rule_name) DO NOTHING;

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION touch_payment_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    CREATE TRIGGER trg_qb_payments_updated
        BEFORE UPDATE ON quickbooks_payments
        FOR EACH ROW
        EXECUTE FUNCTION touch_payment_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TRIGGER trg_patient_qb_mapping_updated
        BEFORE UPDATE ON patient_qb_mapping
        FOR EACH ROW
        EXECUTE FUNCTION touch_payment_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TRIGGER trg_patient_ghl_mapping_updated
        BEFORE UPDATE ON patient_ghl_mapping
        FOR EACH ROW
        EXECUTE FUNCTION touch_payment_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TRIGGER trg_payment_issues_updated
        BEFORE UPDATE ON payment_issues
        FOR EACH ROW
        EXECUTE FUNCTION touch_payment_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TRIGGER trg_payment_rules_updated
        BEFORE UPDATE ON payment_rules
        FOR EACH ROW
        EXECUTE FUNCTION touch_payment_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- View for payment status summary
CREATE OR REPLACE VIEW payment_status_summary_v AS
SELECT 
    p.patient_id,
    p.full_name AS patient_name,
    p.status_key,
    p.payment_method_key,
    COALESCE(SUM(qbp.balance), 0) AS total_balance_owed,
    MAX(qbp.days_overdue) AS max_days_overdue,
    COUNT(qbp.qb_payment_id) FILTER (WHERE qbp.payment_status = 'overdue') AS overdue_invoices_count,
    COUNT(pi.issue_id) FILTER (WHERE pi.resolved_at IS NULL) AS active_issues_count,
    MAX(pi.issue_severity) FILTER (WHERE pi.resolved_at IS NULL) AS highest_issue_severity,
    MAX(qbp.last_payment_date) AS last_payment_date
FROM patients p
LEFT JOIN patient_qb_mapping pqm ON pqm.patient_id = p.patient_id AND pqm.is_active = TRUE
LEFT JOIN quickbooks_payments qbp ON qbp.qb_customer_id = pqm.qb_customer_id AND qbp.balance > 0
LEFT JOIN payment_issues pi ON pi.patient_id = p.patient_id AND pi.resolved_at IS NULL
GROUP BY p.patient_id, p.full_name, p.status_key, p.payment_method_key;

