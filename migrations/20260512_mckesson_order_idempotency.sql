-- McKesson order idempotency
--
-- Lets the iPad (and any future caller) safely retry a "place order" POST
-- without double-submitting to McKesson. The route on the server looks up
-- mckesson_orders by idempotency_key BEFORE calling submitOrder(); if it
-- finds an existing row, it replays the response instead of placing a new
-- order.
--
-- Partial unique index — only enforces uniqueness for non-NULL keys, so
-- legacy rows (no idempotency_key) keep working.
--
-- Author: Cowork (dispatch build) · 2026-05-12 · additive, safe to roll back

ALTER TABLE mckesson_orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mckesson_orders_idempotency_key
  ON mckesson_orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN mckesson_orders.idempotency_key IS
  'Caller-supplied UUID for idempotent submit. Required for live orders from /api/ipad/mckesson/orders; dryRun and pre-iPad rows are NULL.';
