-- Supplier + pricing tracking on supply_items.
--
-- Most items will end up with supplier_name = 'McKesson' (auto-set when an
-- item is mapped) but some are sourced elsewhere (compound pharmacy, Amazon,
-- direct from manufacturer). The mapping modal now lets staff record those
-- alongside the cost so PO planning and budgeting can see what each item
-- actually costs.
--
-- McKesson prices are not exposed on the availability endpoint — they live on
-- invoice line items. Once McKesson fixes their order-list permission gap,
-- we'll auto-populate unit_cost from invoice details. Until then, manual entry.

ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS supplier_name TEXT;            -- "McKesson" | "Strive Pharm" | "Amazon" | etc.
ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(10, 2);      -- price per unit (in unit_cost_uom)
ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS unit_cost_uom TEXT;            -- the UOM the cost applies to (e.g. 'BX', 'PK', 'EA')
ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS unit_cost_source TEXT;         -- 'manual' | 'mckesson invoice 88127028' | etc.
ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS unit_cost_updated_at TIMESTAMPTZ;
ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS supplier_part_number TEXT;     -- supplier's SKU/order number for re-ordering
ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS supplier_url TEXT;             -- optional product page

CREATE INDEX IF NOT EXISTS idx_supply_items_supplier
  ON supply_items(supplier_name)
  WHERE supplier_name IS NOT NULL;
