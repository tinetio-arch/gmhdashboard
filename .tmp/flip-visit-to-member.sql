-- Flip 3 patients from patient_type='visit' to 'member'
-- Reason: they have active recurring monthly Healthie packages (verified 2026-04-24 audit)
--   Richard O'Connor  (12745494) — NowMensHealth.Care TRT Membership $180/mo
--   Stephanie O'Deay  (14167760) — NowOptimal Primary Care Premier $50/mo
--   Karla Shafer      (14989559) — NowOptimal Primary Care Premier $50/mo
--
-- Safety: wrapped in transaction, includes `visit` guard so re-running is a no-op.
-- Review the SELECT output below, then COMMIT (or ROLLBACK to abort).

BEGIN;

-- Preview what will change
SELECT healthie_client_id, full_name, email, patient_type AS before_type, client_type
FROM patients
WHERE healthie_client_id IN ('12745494', '14167760', '14989559')
  AND patient_type = 'visit';

-- Perform the flip
UPDATE patients
SET patient_type = 'member',
    updated_at = NOW()
WHERE healthie_client_id IN ('12745494', '14167760', '14989559')
  AND patient_type = 'visit';

-- Verify the result
SELECT healthie_client_id, full_name, email, patient_type AS after_type, client_type
FROM patients
WHERE healthie_client_id IN ('12745494', '14167760', '14989559');

-- If the above looks correct, run:  COMMIT;
-- If anything is off,             run:  ROLLBACK;
