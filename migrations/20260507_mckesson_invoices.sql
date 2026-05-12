-- McKesson invoices + line items.
--
-- Two-stage population:
--   Stage 1 — `getInvoiceIds` returns invoice IDs only. We upsert "skeleton"
--             rows with invoice_id (+ account, ship-to, date window we discovered
--             them in) and order_id NULL.
--   Stage 2 — Once order_id is known (manually entered, or eventually from
--             McKesson's order list once they fix it), `getInvoiceDetails`
--             populates the rest + line items.
--
-- This lets us track what invoices exist even when McKesson isn't surfacing
-- the per-invoice details yet.

CREATE TABLE IF NOT EXISTS mckesson_invoices (
  id                      SERIAL PRIMARY KEY,
  invoice_id              TEXT NOT NULL UNIQUE,           -- McKesson's invoiceId, e.g. "88127028"
  account_id              TEXT NOT NULL,                  -- bill-to
  ship_to_id              TEXT,                           -- ship-to (when scoped)
  order_id                TEXT,                           -- needed for getInvoiceDetails; populated in stage 2
  -- Stage-2 details (NULL until detail fetch succeeds)
  invoice_date            DATE,
  invoice_due_date        DATE,
  order_date              DATE,
  status                  TEXT,
  purchase_order_number   TEXT,
  sub_total               NUMERIC(12, 2),
  tax_total               NUMERIC(12, 2),
  net_total               NUMERIC(12, 2),
  discount_total          NUMERIC(12, 2),
  account_data            JSONB,                          -- account address
  ship_to_data            JSONB,                          -- ship-to address
  raw_response            JSONB,                          -- full McKesson response for debugging/audit
  details_fetched_at      TIMESTAMPTZ,                    -- NULL = only ID known
  -- Provenance
  first_seen_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  date_window_start       DATE,                           -- the 31-day window this invoice was discovered in
  date_window_end         DATE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mck_invoices_invoice_id   ON mckesson_invoices(invoice_id);
CREATE INDEX IF NOT EXISTS idx_mck_invoices_order_id     ON mckesson_invoices(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mck_invoices_invoice_date ON mckesson_invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_mck_invoices_status       ON mckesson_invoices(status);
CREATE INDEX IF NOT EXISTS idx_mck_invoices_details_pending
  ON mckesson_invoices(id) WHERE details_fetched_at IS NULL;

CREATE TABLE IF NOT EXISTS mckesson_invoice_lines (
  id                      SERIAL PRIMARY KEY,
  invoice_id              INTEGER NOT NULL REFERENCES mckesson_invoices(id) ON DELETE CASCADE,
  line_number             INTEGER,
  product_id              TEXT,                           -- McKesson item id (matches supply_items.mckesson_item_id)
  product_description     TEXT,
  manufacturer            TEXT,
  unit_of_measure         TEXT,
  quantity_ordered        NUMERIC(10, 2),
  quantity_shipped        NUMERIC(10, 2),
  price                   NUMERIC(10, 2),                 -- unit price
  freight                 NUMERIC(10, 2),
  tax_total               NUMERIC(10, 2),
  sub_total               NUMERIC(10, 2),
  net_total               NUMERIC(10, 2),
  discount_total          NUMERIC(10, 2),
  line_status             TEXT,
  line_invoice_date       DATE,
  matched_supply_item_id  INTEGER REFERENCES supply_items(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mck_invoice_lines_invoice  ON mckesson_invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_mck_invoice_lines_product  ON mckesson_invoice_lines(product_id);
CREATE INDEX IF NOT EXISTS idx_mck_invoice_lines_supply   ON mckesson_invoice_lines(matched_supply_item_id) WHERE matched_supply_item_id IS NOT NULL;
