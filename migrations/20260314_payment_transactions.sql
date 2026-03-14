-- Payment Transactions Tracking
-- Records all billing transactions made via iPad App
-- Supports dual-Stripe (Healthie vs Direct)

CREATE TABLE IF NOT EXISTS payment_transactions (
    transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(patient_id),
    amount DECIMAL(10,2) NOT NULL,
    description TEXT,
    stripe_account VARCHAR(20) NOT NULL CHECK (stripe_account IN ('healthie', 'direct')),

    -- Healthie billing
    healthie_billing_item_id VARCHAR(50),

    -- Direct Stripe billing
    stripe_charge_id VARCHAR(100),
    stripe_customer_id VARCHAR(100),

    -- Transaction status
    status VARCHAR(50), -- 'succeeded', 'pending', 'failed', 'paid', etc.
    error_message TEXT,

    -- Metadata
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_payment_transactions_patient ON payment_transactions(patient_id);
CREATE INDEX idx_payment_transactions_created ON payment_transactions(created_at DESC);
CREATE INDEX idx_payment_transactions_stripe_account ON payment_transactions(stripe_account);
CREATE INDEX idx_payment_transactions_healthie_billing ON payment_transactions(healthie_billing_item_id);
CREATE INDEX idx_payment_transactions_stripe_charge ON payment_transactions(stripe_charge_id);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON payment_transactions TO clinicadmin;

COMMENT ON TABLE payment_transactions IS 'iPad App billing transactions - supports Healthie Stripe and Direct Stripe';
COMMENT ON COLUMN payment_transactions.stripe_account IS 'Which Stripe account was used: healthie or direct';
COMMENT ON COLUMN payment_transactions.healthie_billing_item_id IS 'Healthie billing_item.id when charged via Healthie Stripe';
COMMENT ON COLUMN payment_transactions.stripe_charge_id IS 'Stripe charge ID when charged via direct Stripe';
