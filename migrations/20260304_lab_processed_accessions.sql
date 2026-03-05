-- Lab Processed Accessions - Audit trail for resilience
-- Tracks every accession ever returned by the Access Labs API
-- Prevents lost results from batch flagging issues

CREATE TABLE IF NOT EXISTS lab_processed_accessions (
    accession TEXT PRIMARY KEY,
    patient_name TEXT,
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    batch_date TEXT,
    batch_time TEXT
);

-- Backfill from existing review queue
INSERT INTO lab_processed_accessions (accession, patient_name, first_seen_at)
SELECT accession, patient_name, created_at
FROM lab_review_queue
WHERE accession IS NOT NULL
ON CONFLICT (accession) DO NOTHING;
