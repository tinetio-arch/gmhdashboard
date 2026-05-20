-- Capture WHICH staff member sent an outbound GHL message (and when is already
-- covered by ghl_timestamp/received_at).
--
-- Why: outbound (staff) replies for ABXTAC / nowmenshealth.care / nowprimary.care
-- currently store no sender identity (webhook payload carried none). These columns
-- hold the sending user once the GHL Workflow is configured to send merge fields
-- ({{user.name}} / {{user.email}}) on outbound-message triggers. Nullable so existing
-- rows and inbound messages are unaffected.

ALTER TABLE ghl_messages ADD COLUMN IF NOT EXISTS sent_by_name  TEXT;
ALTER TABLE ghl_messages ADD COLUMN IF NOT EXISTS sent_by_email TEXT;
