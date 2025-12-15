-- Healthie Migration Schema
-- Tracks migration of QuickBooks patients to Healthie EMR

-- Maps patients to Healthie client IDs
CREATE TABLE IF NOT EXISTS healthie_clients (
    id SERIAL PRIMARY KEY,
    patient_id VARCHAR(255) NOT NULL,
    healthie_client_id VARCHAR(255) NOT NULL UNIQUE,
    match_method VARCHAR(50) DEFAULT 'migration',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE,
    UNIQUE(patient_id, healthie_client_id)
);

CREATE INDEX IF NOT EXISTS idx_healthie_clients_patient ON healthie_clients(patient_id);
CREATE INDEX IF NOT EXISTS idx_healthie_clients_healthie_id ON healthie_clients(healthie_client_id);
CREATE INDEX IF NOT EXISTS idx_healthie_clients_active ON healthie_clients(is_active);

-- Tracks created packages in Healthie
CREATE TABLE IF NOT EXISTS healthie_packages (
    id SERIAL PRIMARY KEY,
    healthie_package_id VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    billing_frequency VARCHAR(50) NOT NULL,
    number_of_sessions INTEGER,
    qb_recurring_template_id VARCHAR(255),
    qb_recurring_template_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_healthie_packages_healthie_id ON healthie_packages(healthie_package_id);
CREATE INDEX IF NOT EXISTS idx_healthie_packages_qb_template ON healthie_packages(qb_recurring_template_id);
CREATE INDEX IF NOT EXISTS idx_healthie_packages_active ON healthie_packages(is_active);

-- Tracks active subscriptions
CREATE TABLE IF NOT EXISTS healthie_subscriptions (
    id SERIAL PRIMARY KEY,
    healthie_subscription_id VARCHAR(255) NOT NULL UNIQUE,
    patient_id VARCHAR(255) NOT NULL,
    healthie_client_id VARCHAR(255) NOT NULL,
    healthie_package_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'active',
    start_date DATE,
    next_charge_date DATE,
    amount DECIMAL(10, 2),
    qb_recurring_transaction_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE,
    FOREIGN KEY (healthie_client_id) REFERENCES healthie_clients(healthie_client_id) ON DELETE CASCADE,
    FOREIGN KEY (healthie_package_id) REFERENCES healthie_packages(healthie_package_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_healthie_subscriptions_patient ON healthie_subscriptions(patient_id);
CREATE INDEX IF NOT EXISTS idx_healthie_subscriptions_client ON healthie_subscriptions(healthie_client_id);
CREATE INDEX IF NOT EXISTS idx_healthie_subscriptions_package ON healthie_subscriptions(healthie_package_id);
CREATE INDEX IF NOT EXISTS idx_healthie_subscriptions_qb_recurring ON healthie_subscriptions(qb_recurring_transaction_id);
CREATE INDEX IF NOT EXISTS idx_healthie_subscriptions_active ON healthie_subscriptions(is_active);
CREATE INDEX IF NOT EXISTS idx_healthie_subscriptions_status ON healthie_subscriptions(status);

-- Audit trail of migration operations
CREATE TABLE IF NOT EXISTS healthie_migration_log (
    id SERIAL PRIMARY KEY,
    migration_type VARCHAR(50) NOT NULL,
    patient_id VARCHAR(255),
    operation VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL,
    healthie_id VARCHAR(255),
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_healthie_migration_log_type ON healthie_migration_log(migration_type);
CREATE INDEX IF NOT EXISTS idx_healthie_migration_log_patient ON healthie_migration_log(patient_id);
CREATE INDEX IF NOT EXISTS idx_healthie_migration_log_status ON healthie_migration_log(status);
CREATE INDEX IF NOT EXISTS idx_healthie_migration_log_created ON healthie_migration_log(created_at DESC);

-- Maps QuickBooks recurring transactions to Healthie packages
CREATE TABLE IF NOT EXISTS healthie_package_mapping (
    id SERIAL PRIMARY KEY,
    qb_recurring_transaction_id VARCHAR(255) NOT NULL,
    qb_customer_id VARCHAR(255) NOT NULL,
    healthie_package_id VARCHAR(255) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    frequency VARCHAR(50) NOT NULL,
    next_charge_date DATE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (healthie_package_id) REFERENCES healthie_packages(healthie_package_id) ON DELETE CASCADE,
    UNIQUE(qb_recurring_transaction_id, healthie_package_id)
);

CREATE INDEX IF NOT EXISTS idx_healthie_package_mapping_qb_recurring ON healthie_package_mapping(qb_recurring_transaction_id);
CREATE INDEX IF NOT EXISTS idx_healthie_package_mapping_qb_customer ON healthie_package_mapping(qb_customer_id);
CREATE INDEX IF NOT EXISTS idx_healthie_package_mapping_package ON healthie_package_mapping(healthie_package_id);
CREATE INDEX IF NOT EXISTS idx_healthie_package_mapping_active ON healthie_package_mapping(is_active);

-- Update triggers for updated_at
CREATE OR REPLACE FUNCTION touch_healthie_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_healthie_clients_updated ON healthie_clients;
CREATE TRIGGER trg_healthie_clients_updated
    BEFORE UPDATE ON healthie_clients
    FOR EACH ROW
    EXECUTE FUNCTION touch_healthie_updated_at();

DROP TRIGGER IF EXISTS trg_healthie_packages_updated ON healthie_packages;
CREATE TRIGGER trg_healthie_packages_updated
    BEFORE UPDATE ON healthie_packages
    FOR EACH ROW
    EXECUTE FUNCTION touch_healthie_updated_at();

DROP TRIGGER IF EXISTS trg_healthie_subscriptions_updated ON healthie_subscriptions;
CREATE TRIGGER trg_healthie_subscriptions_updated
    BEFORE UPDATE ON healthie_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION touch_healthie_updated_at();

DROP TRIGGER IF EXISTS trg_healthie_package_mapping_updated ON healthie_package_mapping;
CREATE TRIGGER trg_healthie_package_mapping_updated
    BEFORE UPDATE ON healthie_package_mapping
    FOR EACH ROW
    EXECUTE FUNCTION touch_healthie_updated_at();

-- Tracks invoices sent to patients
CREATE TABLE IF NOT EXISTS healthie_invoices (
    id SERIAL PRIMARY KEY,
    healthie_invoice_id VARCHAR(255) NOT NULL UNIQUE,
    patient_id VARCHAR(255) NOT NULL,
    healthie_client_id VARCHAR(255) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(50) DEFAULT 'sent',
    due_date DATE,
    invoice_number VARCHAR(255),
    sent_at TIMESTAMP DEFAULT NOW(),
    paid_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE,
    FOREIGN KEY (healthie_client_id) REFERENCES healthie_clients(healthie_client_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_healthie_invoices_patient ON healthie_invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_healthie_invoices_client ON healthie_invoices(healthie_client_id);
CREATE INDEX IF NOT EXISTS idx_healthie_invoices_status ON healthie_invoices(status);
CREATE INDEX IF NOT EXISTS idx_healthie_invoices_healthie_id ON healthie_invoices(healthie_invoice_id);

DROP TRIGGER IF EXISTS trg_healthie_invoices_updated ON healthie_invoices;
CREATE TRIGGER trg_healthie_invoices_updated
    BEFORE UPDATE ON healthie_invoices
    FOR EACH ROW
    EXECUTE FUNCTION touch_healthie_updated_at();

-- View for migration status
CREATE OR REPLACE VIEW healthie_migration_status_v AS
SELECT
    p.patient_id,
    p.full_name AS patient_name,
    p.email,
    p.phone_primary,
    hc.healthie_client_id,
    hc.match_method,
    hc.created_at AS client_created_at,
    COUNT(DISTINCT hs.id) AS subscription_count,
    COUNT(DISTINCT CASE WHEN hs.status = 'active' THEN hs.id END) AS active_subscription_count,
    MAX(hs.next_charge_date) AS next_charge_date,
    SUM(CASE WHEN hs.status = 'active' THEN hs.amount ELSE 0 END) AS total_monthly_amount,
    COUNT(DISTINCT hi.id) AS invoice_count,
    COUNT(DISTINCT CASE WHEN hi.status = 'paid' THEN hi.id END) AS paid_invoice_count,
    MAX(CASE WHEN hi.status = 'paid' THEN hi.paid_at END) AS last_payment_date
FROM patients p
LEFT JOIN healthie_clients hc ON p.patient_id = hc.patient_id AND hc.is_active = TRUE
LEFT JOIN healthie_subscriptions hs ON hc.healthie_client_id = hs.healthie_client_id AND hs.is_active = TRUE
LEFT JOIN healthie_invoices hi ON hc.healthie_client_id = hi.healthie_client_id
GROUP BY p.patient_id, p.full_name, p.email, p.phone_primary, hc.healthie_client_id, hc.match_method, hc.created_at;

