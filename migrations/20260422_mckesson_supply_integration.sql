-- McKesson MMS Supply Integration
-- Adds McKesson item mapping to supply_items and order tracking table
-- Does NOT modify existing columns — additive only

-- Add McKesson item ID mapping to supply_items
ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS mckesson_item_id TEXT;
ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS mckesson_unit_of_measure TEXT DEFAULT 'EA';

CREATE INDEX IF NOT EXISTS idx_supply_items_mckesson ON supply_items(mckesson_item_id) WHERE mckesson_item_id IS NOT NULL;

-- McKesson orders placed through the dashboard
CREATE TABLE IF NOT EXISTS mckesson_orders (
  id              SERIAL PRIMARY KEY,
  mckesson_order_id TEXT,                       -- returned by McKesson after submission
  account_id      TEXT NOT NULL,                -- McKesson account ID
  po_number       TEXT,                         -- our purchase order number
  status          TEXT NOT NULL DEFAULT 'submitted',  -- submitted | accepted | shipped | delivered | cancelled | error
  order_data      JSONB NOT NULL,               -- full request payload (items, quantities, shipTo)
  response_data   JSONB,                        -- full McKesson response
  tracking_data   JSONB,                        -- tracking info when available
  total_items     INTEGER NOT NULL DEFAULT 0,
  created_by      TEXT,                         -- who placed the order
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mckesson_orders_order_id ON mckesson_orders(mckesson_order_id);
CREATE INDEX IF NOT EXISTS idx_mckesson_orders_status ON mckesson_orders(status);
CREATE INDEX IF NOT EXISTS idx_mckesson_orders_created ON mckesson_orders(created_at);

-- Link table: which supply_items were in which McKesson order
CREATE TABLE IF NOT EXISTS mckesson_order_items (
  id                SERIAL PRIMARY KEY,
  mckesson_order_id INTEGER NOT NULL REFERENCES mckesson_orders(id) ON DELETE CASCADE,
  supply_item_id    INTEGER REFERENCES supply_items(id) ON DELETE SET NULL,
  mckesson_item_id  TEXT NOT NULL,
  quantity          INTEGER NOT NULL,
  unit_of_measure   TEXT NOT NULL DEFAULT 'EA',
  unit_price        NUMERIC(10,2),              -- populated from invoice/order details
  line_status       TEXT                         -- from McKesson order details response
);

CREATE INDEX IF NOT EXISTS idx_mckesson_order_items_order ON mckesson_order_items(mckesson_order_id);
