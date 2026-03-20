-- Add encounter_date to scribe_sessions for backdating notes
-- Defaults to created_at::date for existing sessions
ALTER TABLE scribe_sessions ADD COLUMN IF NOT EXISTS encounter_date DATE;

-- Backfill existing sessions with their created_at date
UPDATE scribe_sessions SET encounter_date = created_at::date WHERE encounter_date IS NULL;

-- Set default for future sessions
ALTER TABLE scribe_sessions ALTER COLUMN encounter_date SET DEFAULT CURRENT_DATE;
