-- Cache the McKesson availability response per item so we don't have to call
-- the API at order time. Refreshed by scripts/sync-mckesson-availability.ts
-- (intended for nightly cron after this seed pass).
--
-- The xls export gives us SELL UOM (display unit). The BUY UOM is what
-- /v1/orders requires — without these cached values, submitOrder returns
-- purchasable=false on items where SELL ≠ BUY.

ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS mckesson_buy_unit_of_measure TEXT;
ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS mckesson_buy_eaches INTEGER;          -- e.g. 1 CS = 2400 EA
ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS mckesson_sell_eaches INTEGER;         -- e.g. 1 BX = 100 EA
ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS mckesson_weight_lb NUMERIC(10, 3);    -- per BUY unit
ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS mckesson_purchasable BOOLEAN;          -- last known
ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS mckesson_replacement_id TEXT;          -- if discontinued, what replaces it
ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS mckesson_storage_requirement TEXT;
ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS mckesson_last_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_supply_items_purchasable
  ON supply_items(mckesson_purchasable)
  WHERE mckesson_purchasable = true;
