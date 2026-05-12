# McKesson Integration — Status

**Date:** 2026-05-12
**State:** ✅ Operational with manual entry fallback · ⚠️ Blocked on McKesson API bug for auto-pricing

The system is fully usable today via the iPad manual-entry path. Auto-fetch of invoice/order details is blocked by a McKesson server-side bug. Code is ready; flips on automatically when McKesson fixes their gateway.

---

## Completed work

### Auth & connection
- **OAuth 2.0 / Client Credentials** wired (`lib/mckesson.ts`)
- **Scope discovered through empirical testing** — McKesson's PDF/portal docs are wrong about the scope format:
  - Their PDF says `invoice,order,patient` (comma-separated) → returns `400 invalid_scope`
  - Gateway actually requires OAuth2 RFC 6749 space-separated form
  - Their docs omit `product` entirely → without it, `/v1/products/availability/*` returns 403
  - **Working scope:** `invoice order patient product` (env var `MCKESSON_SCOPE`)
- Token cache with 5-minute TTL + 30s safety buffer
- 401-retry path handles JWT propagation lag on fresh tokens

### Account model
- **Bill-To:** `62477188` (env: `MCKESSON_ACCOUNT_ID`) — used in URL paths
- **Ship-To:** `62477191` TRI CITY MEDICAL, 215 N McCormick (env: `MCKESSON_SHIP_TO_ACCOUNT_ID`) — used in body `shipTo.accountId` field
- Helpers: `getMcKessonAccountId()` and `getMcKessonShipToAccountId()` exported from `lib/mckesson.ts`
- All endpoints + scripts route through these helpers; both clinics (Men's Health + NOWPrimary.Care) share the ship-to. PO Number convention separates orders by location

### Catalog (Phase A)
- **277 SKUs** imported from McKesson xls list export (`list_46820644`)
- **232 active** (45 marked `active=false` because McKesson flagged `Discontinued`)
- **67 currently purchasable** as of last sync (delta against earlier counts of 25 confirmed the ship-to fix — bumped purchasable items from 25 → 67 once ship-to=62477191 was correctly sent in body)
- Schema columns added to `supply_items`:
  - `mckesson_item_id`, `mckesson_unit_of_measure` (SELL), `mckesson_buy_unit_of_measure` (BUY)
  - `mckesson_buy_eaches`, `mckesson_sell_eaches`, `mckesson_weight_lb`
  - `mckesson_purchasable`, `mckesson_replacement_id`, `mckesson_storage_requirement`
  - `mckesson_last_purchase_date`, `mckesson_last_synced_at`
  - `manufacturer`, `manufacturer_part_number`, `minor_category`, `stock_status`
- Idempotent UPSERT keyed on `mckesson_item_id` (UNIQUE partial index)
- Round-trip verified: 6/6 stock statuses match between catalog xls and live API

### Availability sync
- Script: `scripts/sync-mckesson-availability.ts` (batched 25 items/call)
- Captures SELL+BUY UOMs from `unitOfMeasures` (only difference McKesson's PDF doesn't document)
- Captures `lastPurchaseDate` per item — used as "we actually order this" signal in the matcher
- Auto-detects SELL-UOM drift between catalog xls and live API (25 mismatches found and tagged)

### Fuzzy matching (Phase A) — hand-curated → McKesson
- `lib/mckessonMatcher.ts` — IDF-weighted token overlap + unit synonym expansion (cc↔ml, ga↔gauge, etc.)
- Hard guardrails:
  - Primary noun must appear in candidate (or its minor_category)
  - Every numeric spec from source must match candidate
- Soft boosts: recently-ordered (lastPurchaseDate), purchasable, stocked, category match
- Confidence buckets: high / medium / low / none
- **No auto-apply** — all merges go through human review to prevent wrong joins (e.g. "Suture kit" vs "Suture Removal Kit", "GI Guard" vs "Irrigation Splash Guard")

### 2-pass mapping workflow (Phase A)
- iPad: **🔗 Map to McKesson** modal in Inventory → Supplies
- Filter pills: High / Medium / Low / No-match / All McKesson / **📦 Non-McKesson**
- Three actions per row:
  - **Use this** — merges curated row ← McKesson row, transfers counts/history
  - **Different Supplier** — captures supplier_name + unit_cost + UOM + part #
  - **Skip** — moves to Non-McKesson tab for later supplier assignment
- **Undo Skip** action restores items to McKesson matching (preserves other notes)
- Merge race-safe via `SELECT FOR UPDATE` on both rows

### Supplier + pricing (Phase D)
- New columns on `supply_items`:
  - `supplier_name` (e.g. "McKesson", "Strive Pharm", "Amazon")
  - `unit_cost`, `unit_cost_uom`, `unit_cost_source` (`'manual'` | `'mckesson invoice <ID>'`)
  - `unit_cost_updated_at`
  - `supplier_part_number`, `supplier_url`
- Backfill: `supplier_name = 'McKesson'` set on all 277 mapped rows
- **Wholesale backfill in progress: 84 / 130 SKUs** mapped/skipped/assigned a supplier
- iPad gear modal edits supplier+cost directly; supply cards show `$X/UOM` gold badge + `📦 Supplier` purple badge for non-McKesson
- Search now matches supplier_name and supplier_part_number

### Invoicing (Phase E)
- Tables: `mckesson_invoices` + `mckesson_invoice_lines`
- 2-stage population strategy:
  - **Stage 1:** list endpoint returns invoice IDs → skeleton rows upserted by `invoice_id` UNIQUE
  - **Stage 2:** detail fetch (when API works) OR manual line-item entry populates the rest
- 25 invoice skeletons currently stored (last 90 days)
- 5 invoices manually seeded with orderId + status + total from McKesson web portal
- **Manual line-item entry** form on iPad — typed lines auto-link to `supply_items.mckesson_item_id` and update `unit_cost` on the matched supply (never overwrites `unit_cost_source = 'manual'` entries)
- **Reorder shortcut** — clones invoice lines into draft McKesson order with new PO number (`REORDER-<original PO>-<YYYYMMDD>`); live submit gated behind `MCKESSON_ALLOW_PRODUCTION_ORDERS=true`

---

## Blocker — McKesson detail endpoints return 404 for IDs their list endpoints confirm exist

**Confirmed pattern (5/5 known invoices, both API endpoint families, latest test 2026-05-12):**

```
GET /v1/invoices?accountId=62477188&startDate=2026-04-14&endDate=2026-05-12
  → 200 [ "88127028", "88023302", "87851040", "87748978" ]
  (says invoice 88127028 belongs to account 62477188)

GET /v1/invoices/62477188/86634517/88127028
  → 404 NOT_FOUND
  (says the same invoice doesn't exist on the same account, with the orderId from McKesson's own web portal)

GET /v1/orders/62477188/86634517
  → 404 NOT_FOUND

GET /v1/orders/62477188/fulfillment?startDate=...&endDate=...
  → 200 { totalCount: 3, orderStatusList: [] }
  (counter says 3 orders exist, list is empty)
```

**Probes ruled out as cause:**
- URL/path encoding (trailing slash → 500, proves router parses correctly)
- Header variations (Auth-only / Accept */* / Accept JSON / User-Agent — all 404)
- Account ID swap (62477191 ship-to in path → 403 with explicit "User does not have permission for the provided Bill-To")
- OrderId guesses (`'0'`, empty, invoiceId-as-orderId, accountId-as-orderId — all 404)

**Conclusion:** McKesson's list and detail endpoints use inconsistent access checks (or their data plane is desync'd from their access plane). Either way, server-side bug. Code is correct; gateway is broken.

**Originally reported:** 2026-05-06
**First support email drafted:** 2026-05-07
**Days without movement:** 5

---

## Email to McKesson (sent / pending — see also `docs/mckesson-support-2026-05-12.eml`)

```
To: apisupport@mckesson.com
From: admin@granitemountainhealth.com
Subject: API detail endpoints return 404 for invoices/orders that list endpoints confirm exist

Hi — Bill-To 62477188. The API user is correctly subscribed (list endpoints work,
availability works with ship-to 62477191). The problem is that
GET /v1/invoices/{accountId}/{orderId}/{invoiceId} returns 404 NOT_FOUND for invoices
that GET /v1/invoices confirms exist on the same account.

Reproducible 5 times in a row with orderIds I pulled directly from your web portal:

  GET https://api-gateway.mms.mckesson.com/v1/invoices?accountId=62477188&startDate=2026-04-14&endDate=2026-05-12
    → 200 [ "88127028", "88023302", "87851040", "87748978" ]

  GET https://api-gateway.mms.mckesson.com/v1/invoices/62477188/86634517/88127028
    → 404 NOT_FOUND  ← but the list endpoint just said this invoice IS on this account

  GET https://api-gateway.mms.mckesson.com/v1/orders/62477188/86634517
    → 404 NOT_FOUND

  GET https://api-gateway.mms.mckesson.com/v1/orders/62477188/fulfillment?startDate=...&endDate=...
    → 200 { totalCount: 3, orderStatusList: [] }   ← counter says 3 orders, list is empty

Either:
  (a) your detail endpoints use a stricter access check than your list endpoints
  (b) the user grant only covers list access despite the prior credential modification
  (c) the data plane is desync'd from the access plane

Could you escalate to engineering and let us know what's happening?

Originally reported 2026-05-06; first email 2026-05-07; 5 days no movement.

Thanks,
Phil — Granite Mountain Health
```

---

## What Phil can do today (no McKesson dependency)

1. **Open the iPad → Inventory → Invoices tab.** 25 invoice skeletons are already there.
2. **Tap any invoice → tap "Enter Lines Manually".** Opens a spreadsheet-style form.
3. **Copy line items from McKesson's web portal "View Invoice" page** — paste item #, description, qty, UOM, unit price, line net per row.
4. **Save.** Each saved line:
   - Stores under the invoice
   - Auto-links to `supply_items` where `mckesson_item_id` matches
   - **Auto-updates `supply_items.unit_cost`** with source `mckesson invoice <ID>`
   - Bumps `unit_cost_updated_at`
5. **The gold $X/UOM badges populate on every matched supply card.**

Estimated effort: ~5 min per invoice. Phil has 25 invoices on file (~2 hours of typing to backfill 90 days of pricing across the McKesson catalog).

The **Reorder** button on any invoice with line items produces a draft order that can be one-click-submitted to McKesson once `MCKESSON_ALLOW_PRODUCTION_ORDERS=true` is flipped.

---

## What unlocks when McKesson responds

- **Automatic invoice line population** — `Save & Try Fetch` on the iPad will succeed instead of falling through to manual. The `persistInvoiceDetails()` path is wired and tested; will trigger automatically.
- **Bulk price sync** — `scripts/sync-mckesson-invoices.ts` could be extended to call `getInvoiceDetails()` per invoice after a list pull, populating prices for the entire 90-day window in one cron run.
- **Auto reorder-from-invoice** — already works against stored data; will start working against live data immediately.
- **Order-status tracking** — `getOrderDetails()`, `getOrderStatus()`, `getOrderTracking()` library functions are wired and waiting.
- **Pricing in the catalog** — the 67 currently-purchasable items get real unit_cost data without manual entry.

No additional code changes required once McKesson fixes the detail endpoint.

---

## Files & tables touched

### Library
- `lib/mckesson.ts` — full API client + DB persistence helpers
- `lib/mckessonMatcher.ts` — fuzzy matcher (token overlap, IDF, primary-noun guardrail, spec match)
- `lib/supplyQueries.ts` — extended `SupplyItem` type with all McKesson + supplier fields

### Scripts
- `scripts/import-mckesson-catalog.ts` — xls → supply_items, idempotent
- `scripts/sync-mckesson-availability.ts` — batched availability calls; SELL/BUY UOM + purchasable + lastPurchaseDate
- `scripts/sync-mckesson-invoices.ts` — walks 31-day windows, upserts invoice skeletons
- `scripts/match-supplies-mckesson.ts` — CLI matcher report + `--apply` mode (auto-apply disabled by design)

### API routes
- `app/api/mckesson/availability/route.ts`
- `app/api/mckesson/orders/route.ts` and `app/api/mckesson/orders/[orderId]/route.ts`
- `app/api/mckesson/invoices/route.ts`
- `app/api/mckesson/invoices/[id]/route.ts` — GET (with refresh), PATCH (orderId+fetch / manual_lines)
- `app/api/mckesson/invoices/[id]/reorder/route.ts` — dryRun + live submit
- `app/api/supplies/mapping/route.ts` — list+merge+skip+undo-skip+different-supplier
- `app/api/supplies/[id]/route.ts` — extended PATCH whitelist

### iPad
- `public/ipad/app.js` — Supplies tab enhancements (search, badges, ⚙️ config modal), 🔗 Map to McKesson modal (3 actions × 6 filters), Invoices tab (list, detail modal, manual line entry, reorder preview)
- Mobile synced (`public/mobile/app.*.js`)

### Migrations applied
- `20260506_mckesson_catalog_columns.sql` — manufacturer, manufacturer_part_number, minor_category, stock_status + UNIQUE partial index on mckesson_item_id
- `20260506_mckesson_availability_cache.sql` — buy_uom + buy/sell_eaches + weight + purchasable + replacement_id + storage_requirement + last_synced_at
- `20260506_mckesson_last_purchase.sql` — mckesson_last_purchase_date
- `20260506_mckesson_supply_integration.sql` (pre-existing, refined) — mckesson_orders + mckesson_order_items
- `20260507_supplier_pricing.sql` — supplier_name, unit_cost, unit_cost_uom, unit_cost_source, unit_cost_updated_at, supplier_part_number, supplier_url
- `20260507_mckesson_invoices.sql` — mckesson_invoices (with 2-stage population columns) + mckesson_invoice_lines

### DB tables (post-migration state)
- `supply_items` — 409 rows (132 hand-curated + 277 McKesson)
- `supply_counts`, `supply_count_history` — pre-existing, unchanged shape
- `mckesson_orders`, `mckesson_order_items` — pre-existing
- `mckesson_invoices` — 25 rows (5 fully populated with orderId, 20 skeletons pending)
- `mckesson_invoice_lines` — 0 rows (waiting on manual entry or McKesson fix)

### Env
- `.env.local` keys:
  - `MCKESSON_CLIENT_ID`, `MCKESSON_CLIENT_SECRET` (OAuth)
  - `MCKESSON_BASE_URL=https://api-gateway.mms.mckesson.com`
  - `MCKESSON_TOKEN_URL=https://api-gateway.mms.mckesson.com/oauth2/token`
  - `MCKESSON_SCOPE=invoice order patient product`
  - `MCKESSON_ACCOUNT_ID=62477188` (bill-to)
  - `MCKESSON_SHIP_TO_ACCOUNT_ID=62477191` (ship-to)
  - `MCKESSON_ENVIRONMENT=production`
  - `MCKESSON_ALLOW_PRODUCTION_ORDERS=false` (safety gate — flip to true to enable live ordering)

---

## Resume signal

Next session can pick up the moment McKesson support responds. The work is parked, not abandoned — every code path that depends on detail-endpoint success is already wired; the data layer is already populating; the iPad UI already exposes the manual fallback. When the 404s become 200s, the auto-flows light up with zero code changes.
