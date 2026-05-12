-- FIX(2026-04-22): Link payment transactions to WooCommerce orders
-- so refunds can cancel the WC order and prevent ShipStation from shipping.
-- Previously, WC order ID was returned to the iPad but never stored.

ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS woocommerce_order_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_payment_transactions_woo_order ON payment_transactions (woocommerce_order_id) WHERE woocommerce_order_id IS NOT NULL;
