-- 20260416: Add wholesale cost column to ypb_available_products for admin at-cost tier.
-- Admin tier = wholesale_cost + HANDLING_FEE (currently $10). Flat markup over actual
-- supplier cost, NOT a discount from retail. Previously admin was 50% off retail which
-- could be ABOVE cost (Retatrutide: 50%=$187 vs cost=$80 → 134% markup) or BELOW cost
-- (CJC 1295: 50%=$85 vs cost=$170 → losing $85/unit).

ALTER TABLE ypb_available_products
  ADD COLUMN IF NOT EXISTS wholesale_cost NUMERIC(10, 2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS wholesale_cost_updated_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS wholesale_cost_source TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_ypb_products_wholesale ON ypb_available_products (sku) WHERE wholesale_cost IS NOT NULL;
