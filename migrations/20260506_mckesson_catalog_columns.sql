-- McKesson catalog seeding — extend supply_items with fields we get from
-- McKesson List exports (item description + catalog metadata).
--
-- Columns are nullable so existing hand-curated supply_items rows (132 of
-- them, no McKesson mapping) keep working.
--
-- A UNIQUE partial index on mckesson_item_id lets the import script use
-- INSERT ... ON CONFLICT (mckesson_item_id) for idempotent upserts, while
-- still permitting many rows with NULL mckesson_item_id.

ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS manufacturer TEXT;
ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS manufacturer_part_number TEXT;
ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS minor_category TEXT;
ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS stock_status TEXT;

-- Replace the non-unique partial index with a unique one.
DROP INDEX IF EXISTS idx_supply_items_mckesson;
CREATE UNIQUE INDEX IF NOT EXISTS idx_supply_items_mckesson_unique
  ON supply_items(mckesson_item_id)
  WHERE mckesson_item_id IS NOT NULL;

-- Browse-by-status indexes for the iPad UI.
CREATE INDEX IF NOT EXISTS idx_supply_items_stock_status
  ON supply_items(stock_status)
  WHERE stock_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supply_items_minor_category
  ON supply_items(minor_category)
  WHERE minor_category IS NOT NULL;
