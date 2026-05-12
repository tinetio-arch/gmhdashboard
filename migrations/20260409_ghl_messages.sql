-- GHL Messages: stores SMS/call messages received via GHL Workflow webhooks
-- HIPAA-compliant GHL accounts block API message retrieval, so we capture
-- messages in real-time via webhooks and store them locally.

CREATE TABLE IF NOT EXISTS ghl_messages (
  id SERIAL PRIMARY KEY,
  -- GHL identifiers
  message_id TEXT,                    -- GHL message ID (if provided)
  conversation_id TEXT,               -- GHL conversation ID
  contact_id TEXT NOT NULL,           -- GHL contact ID
  location_id TEXT NOT NULL,          -- GHL location/sub-account ID
  -- Sub-account routing
  account_key TEXT NOT NULL CHECK (account_key IN ('mensHealth', 'primaryCare', 'abxtac')),
  -- Message content
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type TEXT NOT NULL DEFAULT 'SMS' CHECK (message_type IN ('SMS', 'Email', 'Call', 'Voicemail', 'FB', 'IG', 'WhatsApp', 'GMB', 'Live_Chat', 'Other')),
  body TEXT,                          -- Message body text
  -- Contact info (denormalized for display without extra API calls)
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  -- Metadata
  received_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ghl_timestamp TIMESTAMP,           -- Original timestamp from GHL
  raw_payload JSONB,                  -- Full webhook payload for debugging
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index for fetching recent messages per account
CREATE INDEX IF NOT EXISTS idx_ghl_messages_account_received
  ON ghl_messages (account_key, received_at DESC);

-- Index for fetching messages per contact
CREATE INDEX IF NOT EXISTS idx_ghl_messages_contact
  ON ghl_messages (contact_id, received_at DESC);

-- Index for deduplication by GHL message ID
CREATE UNIQUE INDEX IF NOT EXISTS idx_ghl_messages_message_id
  ON ghl_messages (message_id) WHERE message_id IS NOT NULL;

-- Index for conversation threading
CREATE INDEX IF NOT EXISTS idx_ghl_messages_conversation
  ON ghl_messages (conversation_id, received_at DESC);
