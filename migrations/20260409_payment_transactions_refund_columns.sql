-- Add refund tracking columns to payment_transactions
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS stripe_refund_id VARCHAR(100);
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP;
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS original_transaction_id UUID;
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS refund_reason TEXT;

-- Add SKU + WooCommerce fields to patient_billing_cart
ALTER TABLE patient_billing_cart ADD COLUMN IF NOT EXISTS sku TEXT DEFAULT NULL;
ALTER TABLE patient_billing_cart ADD COLUMN IF NOT EXISTS woo_product_id INTEGER DEFAULT NULL;
ALTER TABLE patient_billing_cart ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT NULL;
