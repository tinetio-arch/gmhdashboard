-- Migration: Create lab_review_queue table
-- Date: 2026-02-26
-- Purpose: Move lab review queue data from JSON file to PostgreSQL

CREATE TABLE IF NOT EXISTS lab_review_queue (
    id                    UUID PRIMARY KEY,
    source                TEXT,                          -- 'access_labs_api' or 'email'
    accession             TEXT,
    patient_name          TEXT NOT NULL,
    dob                   TEXT,
    gender                TEXT,
    collection_date       TEXT,
    healthie_id           TEXT,
    patient_id            TEXT,
    match_confidence      NUMERIC,
    matched_name          TEXT,
    top_matches           JSONB,                         -- Array of [name, score, id] tuples
    tests_found           JSONB,                         -- String array
    status                TEXT NOT NULL DEFAULT 'pending_review',
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    uploaded_at           TIMESTAMPTZ,
    approved_at           TIMESTAMPTZ,
    healthie_document_id  TEXT,
    healthie_lab_order_id TEXT,
    rejection_reason      TEXT,
    pdf_path              TEXT,
    s3_key                TEXT,
    upload_status         TEXT,                           -- 'uploaded_hidden', 'visible', 'pending'
    severity              INTEGER,
    critical_tests        JSONB,                         -- Array of {name, value, units}
    approved_by           TEXT,
    email_id              TEXT,                           -- Legacy field from older email-sourced records
    batch_date            TEXT,                           -- From access_labs_api source
    batch_time            TEXT,                           -- From access_labs_api source
    raw_result            JSONB,                         -- Full raw lab result data
    patient_active        BOOLEAN                        -- Whether patient is active in Healthie
);

-- Index for the primary query pattern: filter by status, order by created_at
CREATE INDEX IF NOT EXISTS idx_lab_review_queue_status ON lab_review_queue (status);
CREATE INDEX IF NOT EXISTS idx_lab_review_queue_created_at ON lab_review_queue (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_review_queue_status_created ON lab_review_queue (status, created_at DESC);
