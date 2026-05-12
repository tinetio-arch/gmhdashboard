-- McKesson availability response includes unitOfMeasures[].lastPurchaseDate
-- formatted as YYYYMMDD (or "00000000" for never-purchased). Capturing this
-- gives us a real signal of "items we actually order" — used by the catalog
-- mapping algorithm to bias toward proven SKUs.

ALTER TABLE supply_items ADD COLUMN IF NOT EXISTS mckesson_last_purchase_date TEXT;

CREATE INDEX IF NOT EXISTS idx_supply_items_last_purchase
  ON supply_items(mckesson_last_purchase_date)
  WHERE mckesson_last_purchase_date IS NOT NULL
    AND mckesson_last_purchase_date <> '00000000';
