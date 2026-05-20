-- Per-staff read-tracking for Healthie conversations.
--
-- Why: the dashboard talks to Healthie with a single org API key (Phil Schafer NP),
-- so Healthie's per-membership `viewed` flag reflects only THAT identity's read state,
-- not each logged-in staff member's. Unread badges were therefore wrong for everyone
-- but the key owner. We track read state locally, per (staff user, conversation).
--
-- unread(conversation) := conversation.updated_at > last_read_at  (computed in the API)

CREATE TABLE IF NOT EXISTS conversation_reads (
  user_id         UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  conversation_id TEXT        NOT NULL,             -- Healthie conversation id
  last_read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, conversation_id)
);

-- Fast lookup of a user's read rows for the conversations currently on screen.
CREATE INDEX IF NOT EXISTS idx_conversation_reads_user
  ON conversation_reads (user_id);
