-- Web Push subscriptions for staff iPad/Mobile PWA assignment banners.
-- Created 2026-05-19 (Phase 3 of dispatch notify.py chain).
-- A staff user (users.user_id UUID) may have multiple subscriptions
-- (one per browser/device). On 410 Gone, lib/push.ts deletes the row.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  ipad_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  subscription_jsonb JSONB NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT
);

-- Endpoint is the unique-per-device identifier from the browser. Index on
-- the extracted JSONB text so we can ON CONFLICT against the same device.
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_subs_user_endpoint
  ON push_subscriptions(ipad_user_id, (subscription_jsonb->>'endpoint'));

CREATE INDEX IF NOT EXISTS idx_push_subs_user_recent
  ON push_subscriptions(ipad_user_id, last_used_at DESC);
