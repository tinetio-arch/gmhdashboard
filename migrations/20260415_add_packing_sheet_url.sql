-- Add packing sheet upload URL to peptide orders
ALTER TABLE peptide_orders ADD COLUMN IF NOT EXISTS packing_sheet_url TEXT;
