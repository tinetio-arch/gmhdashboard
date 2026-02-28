-- Migration: Add supplementary_docs JSONB column to scribe_notes
-- Required for Work Note, School Note, Discharge Instructions, Care Plan
-- Matches Telegram bot's documents{} structure

ALTER TABLE scribe_notes ADD COLUMN IF NOT EXISTS supplementary_docs JSONB DEFAULT '{}';

-- Add index for querying notes that have supplementary docs
CREATE INDEX IF NOT EXISTS idx_scribe_notes_supplementary
    ON scribe_notes ((supplementary_docs IS NOT NULL AND supplementary_docs != '{}'::jsonb));

-- Also ensure full_note_text column exists (some deployments may be missing it)
ALTER TABLE scribe_notes ADD COLUMN IF NOT EXISTS full_note_text TEXT;
