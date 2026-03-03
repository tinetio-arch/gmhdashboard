-- Fix scribe_sessions status check constraint to include 'transcribing' status
-- Required for async AWS Transcribe Medical workflow

-- Drop old constraint
ALTER TABLE scribe_sessions DROP CONSTRAINT IF EXISTS scribe_sessions_status_check;

-- Add updated constraint with 'transcribing' and 'error' statuses
ALTER TABLE scribe_sessions ADD CONSTRAINT scribe_sessions_status_check
    CHECK (status IN ('recording', 'transcribing', 'transcribed', 'note_generated', 'submitted', 'signed', 'error'));

-- Also update transcript_source default from 'deepgram' to 'aws_transcribe_medical'
ALTER TABLE scribe_sessions ALTER COLUMN transcript_source SET DEFAULT 'aws_transcribe_medical';
