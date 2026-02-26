-- Supply PAR System
-- Separate from DEA controlled substance inventory (app/inventory)
-- Tracks general clinic supplies: syringes, meds, kits, cleaning, etc.

-- Master catalog of supply items
CREATE TABLE IF NOT EXISTS supply_items (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL,
  unit          TEXT NOT NULL DEFAULT 'each',
  par_level     INTEGER,
  reorder_qty   INTEGER,
  notes         TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Current on-hand quantity (one row per item+location)
CREATE TABLE IF NOT EXISTS supply_counts (
  id            SERIAL PRIMARY KEY,
  item_id       INTEGER NOT NULL REFERENCES supply_items(id) ON DELETE CASCADE,
  qty_on_hand   INTEGER NOT NULL DEFAULT 0,
  location      TEXT NOT NULL DEFAULT 'main',
  counted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  counted_by    TEXT,
  UNIQUE(item_id, location)
);

-- Audit trail of every count/adjustment
-- change_type: 'count' | 'receive' | 'use' | 'adjustment'
-- 'use' entries can be associated with a Healthie patient visit
CREATE TABLE IF NOT EXISTS supply_count_history (
  id                    SERIAL PRIMARY KEY,
  item_id               INTEGER NOT NULL REFERENCES supply_items(id) ON DELETE CASCADE,
  location              TEXT NOT NULL DEFAULT 'main',
  qty_before            INTEGER,
  qty_after             INTEGER NOT NULL,
  change_type           TEXT NOT NULL DEFAULT 'count',
  notes                 TEXT,
  healthie_patient_id   TEXT,          -- Healthie user ID (for 'use' entries)
  healthie_patient_name TEXT,          -- Cached patient name for display
  recorded_by           TEXT,
  recorded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supply_items_category ON supply_items(category);
CREATE INDEX IF NOT EXISTS idx_supply_items_active ON supply_items(active);
CREATE INDEX IF NOT EXISTS idx_supply_counts_item ON supply_counts(item_id);
CREATE INDEX IF NOT EXISTS idx_supply_history_item ON supply_count_history(item_id);
CREATE INDEX IF NOT EXISTS idx_supply_history_recorded ON supply_count_history(recorded_at);
