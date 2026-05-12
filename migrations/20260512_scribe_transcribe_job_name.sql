-- Store the AWS Transcribe Medical job name on each scribe session so the
-- polling endpoint can read it directly instead of reconstructing it from
-- the S3 key. Reconstruction relied on a fragile regex against
-- audio_s3_key (/(\d+)\.\w+$); when the regex missed, the job name became
-- "scribe-<patient>-" with no timestamp, AWS returned an error, the catch
-- swallowed it, and iPad would spin on "Transcribing…" forever.
--
-- Column is nullable for backward compatibility — existing rows keep
-- working via the legacy regex fallback in the route handler.

ALTER TABLE scribe_sessions
  ADD COLUMN IF NOT EXISTS transcribe_job_name TEXT;
