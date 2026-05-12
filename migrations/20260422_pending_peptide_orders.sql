-- Pending Peptide Orders — GLP Hold & Approve Flow
-- Patient-app orders containing weight-management (GLP) products
-- are held for staff approval before charging.

CREATE TABLE IF NOT EXISTS pending_peptide_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(patient_id),
  healthie_client_id TEXT,
  patient_name TEXT,
  patient_email TEXT,
  items JSONB NOT NULL,                -- [{sku, name, quantity, unit_price, retail_price, therapeutic_category_slug}]
  subtotal NUMERIC(10,2) NOT NULL,
  shipping_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  total NUMERIC(10,2) NOT NULL,
  discount_tier TEXT,
  discount_pct NUMERIC(5,4) DEFAULT 0,
  shipping_address JSONB,              -- {address_line1, city, state, postal_code}
  stripe_customer_id TEXT,
  stripe_payment_method_id TEXT,       -- saved for charging on approval
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | denied
  denial_reason TEXT,
  approved_by TEXT,                    -- staff email who approved/denied
  stripe_payment_intent_id TEXT,       -- filled on approval
  woo_order_id INTEGER,               -- filled on approval
  receipt_number TEXT,                 -- filled on approval
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_peptide_orders_status ON pending_peptide_orders(status);
CREATE INDEX IF NOT EXISTS idx_pending_peptide_orders_patient ON pending_peptide_orders(patient_id);
