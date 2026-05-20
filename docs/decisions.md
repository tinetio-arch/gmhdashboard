
## 2026-05-20 — Real woo-channel delivery signal shipped; delivered_at gated on operational hookup

**Context.** The May 19 cleanup NULLed 25 fabricated `delivered_at` rows on
`peptide_order_tracking` (root cause behind the Ryan Foster ghost order). The
pipeline cron had been deriving `delivered_at` from `wc.date_completed`, which is a
WooCommerce status flag, not a carrier delivery scan — so "delivered" was fiction.
The decision (PHIL-TODO-MASTER #10): no row may get a `delivered_at` again until a
**real carrier delivery source** writes it.

**What shipped** (commit `cd89646`, merged to master via `ee7ff55`):
- `app/api/webhooks/shipstation/route.ts` — HMAC-verified delivery webhook. Only
  acts on `event === 'delivered'`, dedups by `tracking_number`, flips
  `peptide_order_tracking` rows where `delivered_at IS NULL` to
  `delivered_at + stage='wc_delivered'`. Idempotent; never fabricates a delivery.
- `scripts/poll-usps-tracking.js` — USPS Web Tools TrackV2 fallback poller for
  orders the webhook missed. `--dry-run` supported. Same dedup/idempotency rules.
- `app/api/cron/peptide-pipeline-sync/route.ts` — cron-stomp fix: the 15-min UPSERT
  now `COALESCE(existing.delivered_at, EXCLUDED.delivered_at)` and keeps `stage`
  sticky at `wc_delivered`. Without this, every sync erased the carrier signal.

**Table correction.** The original ship-sync brief said "UPDATE `peptide_dispenses`
SET delivered_at". That table has no `delivered_at`/`tracking_number` columns and no
`woo` rows (in-house pickups only — SOT module 30). Correct target is
`peptide_order_tracking` (migration `20260428_peptide_order_tracking.sql`), which is
what both writers use. `wc_delivered` confirmed valid in the `stage` CHECK constraint.

**FOLLOW-UP — delivered_at will NOT be written until Phil completes these (manual):**
1. Set `SHIPSTATION_WEBHOOK_SECRET` in `.env.production` (shared with the signing relay).
2. Stand up the signing relay OR point a signing aggregator at the endpoint —
   ShipStation's native v1 webhook POSTs only a `resource_url` and does NOT HMAC-sign,
   so a direct hookup is logged-and-skipped (never fabricated), not a delivery. See
   options (a)/(b) in the webhook header.
3. Register the webhook with the chosen provider, pointing at
   `https://nowoptimal.com/ops/api/webhooks/shipstation`.
4. Set `USPS_API_USER` (USPS Web Tools USERID) and install the hourly poll cron
   (candidate command is in the script header). Safe to enable now that the COALESCE
   fix is live.

Until 1–3 (or 4) are done the system is correct-but-inert: no real delivery source is
connected, so `delivered_at` stays NULL — which is the desired state vs. re-fabricating.

## 2026-05-19 — PINS doc sync-gate text patched; Cowork user_preferences still needs manual edit

Commit `64b3c31` patched `docs/CLAUDE_MEMORY_PINS.md` to reflect the actual final state of the Healthie sync gate after commit `9797915` removed the allowlist. Phils Cowork user_preferences (his Mac-side user prefs in Claude desktop) still has the equivalent stale paragraph and must be updated manually by Phil — it cannot be edited from the EC2 box.

The user_preferences paragraph to update is the one mentioning "NowMensHealth.Care + NowPrimary.Care reach ensureHealthieClientId" — replace with the same Phase 6 final-state language now in PINS.
