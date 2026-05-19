# Peptide Pipeline — Channel Architecture

> **When to read**: any change that touches `peptide_dispenses`, `peptide_order_tracking`, the iPad billing flows (ship-order / charge / company-order / pending-orders), the mobile peptide checkout (`/api/headless/checkout`), or the Healthie billing-item webhook (`/lib/healthie/peptideWebhook.ts`).
>
> **Last updated**: 2026-05-19 — `channel` column added to `peptide_dispenses`; 3 education surfaces gated on `channel='inhouse'`.

---

## The two channels

Every peptide order moves through exactly one of two fulfillment channels:

| Channel | Origin | Fulfillment | Patient gets… | Education |
|---------|--------|-------------|---------------|-----------|
| `inhouse` | iPad direct charge | Clinic pickup at next visit | Bottle handed over after staff-led education | **Required** — `education_complete=true` flips when staff signs off |
| `woo` | iPad ship-order / iPad company-order / Mobile app checkout / `/api/ipad/pending-orders` approval | WooCommerce order → ABXTAC → ShipStation → USPS | Tracking email + box on the doorstep | **NOT required** — ABXTAC handles consent/education at WC checkout, outside our DB |

**Phil's intent (2026-05-19)**: ship-to (`woo`) patients should NOT see clinic education prompts. The dashboard fix REMOVES friction (stale "Education: incomplete" labels) on ship-to surfaces — it does NOT add new gates.

## Schema

### `peptide_dispenses`
```sql
channel TEXT NOT NULL DEFAULT 'inhouse' CHECK (channel IN ('woo', 'inhouse'))
-- Index: idx_peptide_dispenses_channel
```
Mirrors `peptide_order_tracking.channel`. Backwards compat: every existing reader continues to see all rows (the column is NOT NULL with a safe default).

### Backfill (migration `20260519_peptide_dispenses_channel.sql`)
1. `notes ILIKE 'Shipped via ABX TAC%'` → `channel='woo'` (the marker iPad ship-order writes)
2. `JOIN payment_transactions ON stripe_payment_intent_id = stripe_charge_id WHERE woocommerce_order_id IS NOT NULL` → `channel='woo'` (catches older rows before the notes marker existed)

Result on apply (558 rows total): 536 `inhouse` + 22 `woo`.

## INSERT sites

| File | Channel | Set how |
|---|---|---|
| `app/api/ipad/billing/charge/route.ts` | `inhouse` | DEFAULT |
| `app/api/ipad/billing/ship-order/route.ts` | `woo` | Explicit |
| `app/api/ipad/billing/company-order/route.ts` | `woo` | Explicit |
| `app/api/ipad/pending-orders/route.ts` (on approve) | `woo` | Explicit |
| `app/api/headless/checkout/route.ts` (mobile app) | `woo` | Explicit |
| `app/api/jarvis/peptide-order/route.ts` | `inhouse` | DEFAULT |
| `lib/healthie/peptideWebhook.ts` (Healthie billing-item) | `inhouse` | Explicit |
| `lib/peptideQueries.ts::createPeptideDispense` | `inhouse` | DEFAULT |

Rule: when adding a new INSERT site, set `channel` explicitly if the path is non-trivially identifiable. Rely on the DEFAULT only when the path is unambiguously in-house.

## Gated education surfaces (channel='inhouse' only)

These render or write **nothing** for `woo` rows:

1. **iPad dispense detail modal** — `public/ipad/app.js:13287`. The "Education: complete/incomplete" line only renders when `r.education_complete != null && r.channel === 'inhouse'`.
2. **Consent send route** — `app/api/ipad/billing/send-consent/route.ts`. Accepts an optional `channel` field on the request body. If `channel='woo'`, returns `{ success: true, skipped: true, reason: 'ship_to_channel' }` without writing to `pending_peptide_consents`. iPad `sendPeptideConsent()` passes `channel:'woo'` from the ship-cart flow and shows an "ABXTAC handles it" toast.
3. **Healthie billing-item webhook** — `lib/healthie/peptideWebhook.ts`. Before auto-creating a `Pending` dispense, the handler checks `payment_transactions` for a matching `healthie_billing_item_id` with `woocommerce_order_id IS NOT NULL`. If found, it skips entirely (the ship-order route already wrote the dispense).

## Inventory SUM formula

`lib/peptideQueries.ts` and several `app/api/inventory/intelligence/*` routes compute on-hand stock as:

```sql
SUM(o.quantity) - SUM(d.quantity WHERE d.status='Paid' AND d.education_complete=true)
```

This filter **already** excludes `woo` rows by accident (ship-to rows are `status='Shipped'`, not `'Paid'`). Adding `AND d.channel='inhouse'` would be a no-op (verified 2026-05-19: 519 == 519). Left as-is to minimize churn. If you tighten it, coordinate with whoever owns `scripts/health-check.sh`'s peptide-zero-stock KPI.

## Pipeline view

`peptide_order_tracking` is the unified pipeline table (one row per `payment_transactions`). It already has `channel='woo'|'inhouse'`. The iPad pipeline panel (`app/api/ipad/peptide-pipeline/route.ts`) filters its `awaiting_education` bucket on `channel='inhouse'` (this has been correct since `peptide_order_tracking` launched).

The new `peptide_dispenses.channel` brings the same awareness down one level so anything joining or querying `peptide_dispenses` directly can stay channel-correct without a `payment_transactions` join.

## Acceptance examples

| Patient | Channels | Why |
|---|---|---|
| Heather Ramirez | `woo` (1) | Ship-to only |
| Jodi Ellsworth | `woo` (1) | Ship-to only |
| Ryan Foster | `woo` (3) + `inhouse` (5) | Dual-channel — uses both ship-to and clinic pickup |

Spot-check after schema changes:
```sql
SELECT channel, COUNT(*) FROM peptide_dispenses GROUP BY channel;
SELECT sale_id, status, education_complete, channel FROM peptide_dispenses
 WHERE notes ILIKE '%ABX TAC%' LIMIT 5;
SELECT COUNT(*) FROM peptide_dispenses WHERE channel='inhouse' AND notes ILIKE '%ABX TAC%';
-- ^ must be 0
```

## Related modules

- `15-integration-endpoints.md` — Healthie GraphQL, ABXTAC WooCommerce, ShipStation chain
- `20-headless-mobile-app.md` — mobile app cart and checkout flow
- `21-websites-brand-system.md` — ABX TAC site context
- `22-brand-group-architecture.md` — peptide-related screens in mobile app (`PeptideEducationScreen`, consent gate)
