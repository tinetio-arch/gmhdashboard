-- Resolution actions for peptide_order_tracking — staff and admin can mark
-- stuck/in-progress rows as handled, picked up, reshipped, or refunded.
-- Refund is admin-only at the API layer (lib/abxtac-refund.ts handles WC cancel + Stripe refund).

ALTER TABLE peptide_order_tracking
    ADD COLUMN IF NOT EXISTS resolution TEXT
        CHECK (resolution IN ('handled_internally', 'reshipped', 'refunded', 'picked_up_marked')),
    ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
    ADD COLUMN IF NOT EXISTS resolved_by TEXT,
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS reship_wc_order_id INTEGER;

-- Default-active view: rows with no resolution still show in the queue.
CREATE INDEX IF NOT EXISTS idx_peptide_tracking_unresolved
    ON peptide_order_tracking (channel, stage)
    WHERE resolution IS NULL;
