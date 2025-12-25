## GMH Dashboard — Copilot instructions (concise)

This file gives focused, actionable context to an AI coding agent so it can be productive immediately in this repository.

- Project type: Next.js 14 app-router TypeScript app (see `next.config.js`, `tsconfig.json`). Server and client components live under `app/` with React 18.
- Entry points & layout: `app/layout.tsx` is a server layout that calls `getCurrentUser()` from `lib/auth.ts`. Many pages use `requireUser()` or `userHasRole()` to gate access.
- Data access pattern: App read/write uses Postgres via `lib/db.ts` -> `query(text, params)`; reuse `getPool()` and env vars from `env.example`. Snowflake is the central analytics hub—new data ingest/export flows should target Snowflake (not ClinicSync) for warehouse storage, while the dashboard still uses Postgres for operational writes.
- Auth & sessions: Session cookie name is `gmh_session` (see `lib/auth.ts`). Session tokens are HMAC'd using `SESSION_SECRET`. Don't hardcode secrets in the repo — use environment variables.
- Base path: The app commonly runs on a base path (`NEXT_PUBLIC_BASE_PATH`, example `/ops`). Respect `withBasePath` / `NEXT_PUBLIC_BASE_PATH` when generating links and cookie paths.
- Domains & hosting: Web servers currently run at `nowoptimal.com`, `nowprimary.care`, and `nowmenshealth.care`; respect base path settings and avoid hardcoding domains.
- Integrations to be aware of:
  - Healthie API is the authoritative clinical source; use existing Healthie helpers and env keys (`env.example`).
  - Healthie SDK (React) is available for chat/forms/booking: install `@healthie/sdk` plus `@apollo/client`, `@rails/actioncable`, `graphql-ruby-client`; wrap components in `HealthieProvider userId`, and load required CSS `@healthie/sdk/dist/styles/index.css`.
    - Install (npm): `npm i @healthie/sdk @apollo/client @rails/actioncable graphql-ruby-client`.
  - Healthie SDK SSR note: ActionCable (WebSockets) must be client-only—wrap Apollo + SDK in a `ClientOnly` hydration guard (see example in instructions) or `next/dynamic` with `ssr:false`; lazy-load ApolloForHealthie to avoid server WebSocket errors.
  - Healthie SDK configuration: Apollo split link with `HttpLink` to `https://api.gethealthie.com/graphql` and `ActionCableLink` to `wss://ws.gethealthie.com/subscriptions?token=<user_auth_token>`; headers require `authorization: Basic <user_auth_token>` and `authorizationsource: API`.
  - Healthie SDK components: `ConversationList` (optional `onConversationClick`, `activeId`), `Chat` (optional `conversationId`), `Form id` (supports callbacks `onSubmit`, `onQueryStateChange`, `onMutationStateChange`, `submitButtonText`), `Booking queryString`. Use `brandedUrl`/`brandedBackendUrl` on `HealthieProvider` for branded domains and document/folder links.
  - Healthie GraphQL: follow official GraphQL spec (https://spec.graphql.org/September2025/) when defining queries/mutations; keep operations typed and colocated, and prefer persisted/parameterized queries where applicable.
  - Healthie API reference: see https://docs.gethealthie.com/reference/2024-06-01 for endpoint/field details; align GraphQL operations with this schema.
    - Webhooks processing rule of thumb: webhooks are thin IDs — always fetch the full record before acting or alerting. For `requested_payment.*`, fetch the requested payment by `resource_id` and include patient/client IDs and names, amount/currency, status, sent/paid timestamps, and requester info in alerts (ops-billing Chat). Where possible, store enriched data in Snowflake for reporting.
  - Healthie webhooks (nowmenshealth.care): POST receiver at `/api/healthie/webhook` with `HEALTHIE_WEBHOOK_SECRET` signature check. Payload is thin:
    ```json
    { "resource_id": "...", "resource_id_type": "Appointment|FormAnswerGroup|Entry|Note", "event_type": "..." }
    ```
    - On updates, `changed_fields` lists modified fields; create/delete only send IDs. Fetch full data via GraphQL after receipt.
    - Signature headers: `Content-Digest` (SHA-256 hash), `Signature-Input`, `Signature` (HMAC-SHA256). Verify by constructing `"<method> <path> <query> <contentDigest> application/json <contentLength>"` and comparing to `Signature` using the shared secret.
    - Retries: exponential backoff up to 3 days, then disabled; email alerts after ~24h and on disable. Better URL validation is enforced.
    - IPs (can whitelist, subject to change): Staging `18.206.70.225, 44.195.8.253`; Prod `52.4.158.130, 3.216.152.234, 54.243.233.84, 50.19.211.21`.
    - Available events (abridged): applied_tag.*, appointment.* (created/updated/deleted), availability.*, billing_item.created/updated, care_plan.*, cms1500.*, comment.*, conversation_membership.* (created/updated/deleted/viewed), document.*, dosespot_notification.created, entry.*, form_answer_group.* (created/deleted/locked/signed), goal.*, insurance_authorization.*, location.*, message.*, metric_entry.*, organization_info.*, other_id_number.*, patient.created/updated, policy.*, received_fax.created, requested_form_completion.*, requested_payment.created/updated, task.*, charting_note_addendum.*, completed_onboarding_item.*, lab_order.*, lab_result.*, medication.*, organization_membership.*, request_form_creation.*. Ask Healthie for others if missing.
  - Snowflake is the warehouse hub for all inbound data; prefer piping new datasets to Snowflake (not ClinicSync) and consuming warehouse outputs for analytics/BI.
  - Metabase consumes Snowflake for BI; keep schemas/exports compatible with Metabase models when adding warehouse data.
  - QuickBooks (OAuth) — env keys in `env.example`, QuickBooks logic under `lib/*` and UI cards like `app/components/QuickBooksCard`.
  - GoHighLevel (GHL) for patient comms and Heidi widget; see `env.example` and `components/HeidiWidget.tsx` for usage.
  - Telegram bot is used for ops notifications; maintain or extend bot hooks rather than introducing new ad-hoc channels.
  - Messaging/alerts:
    - Google Chat (ops-billing): webhook env `GOOGLE_CHAT_WEBHOOK_OPS_BILLING`; alerts are sent from `scripts/process-healthie-webhooks.ts` when processing staged Healthie webhooks (`npm run healthie:process-webhooks`). Handlers fetch the full record (billing_item, requested_payment) before posting, and cards include patient/client IDs, names, amount/currency, status, timestamps, and requester when available. Keep using this channel for webhook-driven alerts.
    - Telegram daily snapshot: `scripts/telegram-healthie-report.ts` queries Snowflake rollup (invoices, payments, billing items, packages) and posts Markdown to Telegram. Env keys: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` plus Snowflake creds. GitHub Action `.github/workflows/healthie-telegram-report.yml` runs daily at 13:15 UTC via `npm run healthie:telegram-report`; extend this instead of creating new bots.
- Background & sync scripts: Node scripts run via `tsx` (see `package.json`, e.g., `healthie:sync-patients`). ClinicSync scripts are legacy—do not add new ClinicSync flows; prefer Snowflake-based ingest/export. Use `npm run <script>` to execute locally.
- Build & run:
  - Local dev: `npm install` then `npm run dev` (Next dev). Use `.env.local` copied from `env.example`.
  - Production: `npm run build` then `npm start`. The repo supports standalone export for copying `.next/standalone` to a minimal Node runtime.
  - PM2 deployment example: see `pm2.config.js` (contains example production env values — do NOT commit secrets from PM2 into repo).
- Patterns & conventions to follow when changing code:
  - Use `lib/query` helper for SQL access. Avoid opening new DB connection pools — reuse `getPool()`.
  - Prefer server components for data-heavy pages (this repo uses async server components and `force-dynamic` for pages that must fetch live data: see `app/page.tsx`).
  - Role checks: use `userHasRole(user, 'write'|'admin')` and `requireUser(minRole)` for API and page protection.
  - Error handling: many data fetches in the dashboard use `.catch(() => fallback)` to avoid blocking rendering — follow that approach for non-critical integration calls.
  - Patient ID mapping (dashboard ↔ Healthie ↔ GoHighLevel):
    - Source of truth: Postgres `patients.patient_id`. Healthie mapping lives in `healthie_clients` (active row per patient) and is exposed via `patient_data_entry_v`. GHL mapping is stored on `patients.ghl_contact_id`.
    - Snowflake patient dim (`GMH_CLINIC.PATIENT_DATA.PATIENTS`) also carries `HEALTHIE_CLIENT_ID`; refresh the dashboard mapping daily from Snowflake if you need bulk reconciliation, but prefer live links from Postgres for writes.
    - Use `lib/patients.ts` (`patientsService`) to resolve and link external IDs: it fetches `healthie_client_id` (active) and `ghl_contact_id`, and `linkExternalIds` will upsert Healthie client links and set GHL contact IDs.
    - On-demand patient fetch (e.g., from Telegram): query Snowflake for the patient by name/email/phone, then call `patientsService.linkExternalIds` to store the Healthie/GHL IDs in Postgres so the dashboard and webhook processors align.
    - Daily reconciliation: `npm run healthie:reconcile-ids` (script `scripts/reconcile-patient-ids.ts`) pulls `patient_id` + `healthie_client_id` from Snowflake (`PATIENT_DATA.PATIENTS`) and upserts into Postgres `healthie_clients` (match_method `snowflake_sync`). Use Snowflake creds from env and existing Postgres env.
- Files to consult for examples (quick links):
  - `app/layout.tsx` — session-driven layout & navigation
  - `app/page.tsx` — composite dashboard aggregating many `lib/*` data sources
  - `lib/auth.ts` — session, cookie, role, and auth helper functions
  - `lib/db.ts` — connection pooling and `query()` API
  - `env.example` — required environment variables and integration keys
  - `pm2.config.js` — example production environment and startup config
  - `package.json` — useful npm scripts and dependency list

- Make minimal, focused changes: this repo is production-facing and integrates with live payment and clinical systems. Avoid modifying integration credentials or database-related SQL without tests or a staging verification plan.

Examples to reference in PRs or patches:
- When adding a data query, use `import { query } from '@/lib/db'` and return typed rows instead of in-file PG client creation.
- To gate a new page route, call `await requireUser('read')` at top-level of the server component (see `app/page.tsx`) and use `userHasRole()` in the layout to show admin-only nav links.

Small checklist for PRs an AI should follow:
1. Run `npm run lint` and `npm run build` locally (or `npm run dev` for iterative work).
2. Ensure no secrets are added to code; update `env.example` only with key names (not real values).
3. Use existing helpers in `lib/` (auth, db, metrics, inventory) instead of creating ad hoc utilities.
4. Add a one-paragraph rationale at the top of the PR that references the exact files changed.

First tasks for new contributors (suggested):
- Bring up local dev: copy `env.example` to `.env.local`, fill required keys, run `npm install` and `npm run dev`.
- Review `app/page.tsx` and `lib/auth.ts` to understand gating, roles, and session handling.
- Trace a data fetch: pick a card in `app/page.tsx`, follow its `lib/*` query back to the SQL in Postgres, and note any `.catch(() => fallback)` patterns.
- Inspect Snowflake flow expectations: warehouse is the hub; prefer adding ingest/export to Snowflake and consuming from there for analytics/Metabase.

Snowflake patterns (keep Metabase-friendly):
- Ingest/export: land raw data into a Snowflake staging schema, then model into curated tables/views consumed by Metabase; avoid direct Postgres-to-Metabase paths.
- Naming: use consistent, lowercase, underscore names for schemas/tables/views; avoid spaces to keep Metabase clean.
- Contracts: when adding new warehouse outputs, document column names/types and ensure stable views for dashboards; avoid breaking existing Metabase models.

- Account `KXWWLYZ-DZ83651`, user `tinetio123`, role `ACCOUNTADMIN`; warehouses available: `COMPUTE_WH`, `GMH_WAREHOUSE` (use one of these). Primary database `GMH_CLINIC` with schemas `FINANCIAL_DATA` and `PATIENT_DATA`.
  - How we currently fetch Healthie financial data:
    - Billing items (recurring charges) are pulled via GraphQL `billingItems(page_size, offset)` in `lib/healthie/financials.ts` and loaded to Snowflake by `scripts/ingest-healthie-financials.ts` (MERGE into `HEALTHIE_BILLING_ITEMS`). This is the only live ingest today.
    - Requested payments are fetched ad hoc during webhook processing (`scripts/process-healthie-webhooks.ts`) via GraphQL `requestedPayment(id)` to enrich Google Chat alerts (patient/client IDs + names, amount/currency, status, sent/paid, requester). Not yet persisted to Snowflake.
    - Invoices exist in Snowflake (`HEALTHIE_INVOICES` ~69 rows) from prior ingest/source; payments, payment methods, and package purchases tables are currently empty because Healthie GraphQL does not expose them directly. To fill them, use Healthie REST (or new GraphQL if exposed) and land in `FINANCIAL_DATA.HEALTHIE_PAYMENTS`, `HEALTHIE_PAYMENT_METHODS`, `HEALTHIE_PACKAGE_PURCHASES`.
    - Unified rollup/Telegram snapshot relies on those tables; until payments/methods/packages ingest, expect zeros there and use invoices + billing items for balances.
- Relevant tables:
  - `GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_INVOICES` (has `PATIENT_ID`, `STATUS`, `AMOUNT`, `PAID_AMOUNT`, `REMAINING_BALANCE`, dates).
  - `GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_PAYMENTS` (no `PATIENT_ID`; join to invoices via `INVOICE_ID`).
  - `GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_PAYMENT_METHODS` (currently zero rows as of 2025-12-25).
  - `GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_BILLING_ITEMS` (recurring charges; `PATIENT_ID`, `AMOUNT_PAID`, `STATE`, `PAYMENT_DATE`).
  - `GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_PACKAGE_PURCHASES` (packages/prepaid; `PATIENT_ID`, `OFFERING_PRICE`, `AMOUNT_PAID`, `AMOUNT_REMAINING`, `ACTIVE_STATUS`, `CREATED_AT`).
  - Patient dim for names/contact: `GMH_CLINIC.PATIENT_DATA.PATIENTS` (includes `PATIENT_ID`, `PATIENT_NAME`, `EMAIL`, `HEALTHIE_CLIENT_ID`).
  - Healthie GraphQL reality check (2025-12-25): `payments`, `payment_methods`, and `package_purchases` fields are not exposed in the API schema. The available billing data comes from `billingItems(page_size, offset)` (list return type, max page_size 100). Ingest script `scripts/ingest-healthie-financials.ts` was updated to pull `billingItems` (id, sender/recipient, amount_paid, state, created_at) and MERGE into `HEALTHIE_BILLING_ITEMS`. Payments/methods/package purchases require alternative endpoints (REST) or new GraphQL exposure before ingestion can be added.

- Payment coverage guidance (capture all Healthie payment types):
  - Direct/one-off payments: `HEALTHIE_PAYMENTS` joined to invoices (`INVOICE_ID`) to get `PATIENT_ID`; use `AMOUNT_DOLLARS`, `STATUS`, `CREATED_AT`.
  - Recurring charges: `HEALTHIE_BILLING_ITEMS` — sum `AMOUNT_PAID`, track `STATE` and `PAYMENT_DATE` per patient.
  - Package payments: `HEALTHIE_PACKAGE_PURCHASES` — track `AMOUNT_PAID`, `AMOUNT_REMAINING`, `ACTIVE_STATUS`, `CREATED_AT` per patient.
  - Payment methods: `HEALTHIE_PAYMENT_METHODS` for default card presence; currently empty, expect data later.
  - For a complete picture, union invoice balances + direct payments + billing item payments + package payments/remaining; group by `PATIENT_ID` using the patient dim for names/email.
- Quick SQL to summarize Healthie payment status (handles payments via invoices; returns patients with any payment method record once data lands):
  ```sql
  with payment_methods_agg as (
    select patient_id,
           card_brand || ' ' || card_last4 as default_card,
           synced_at as last_method_synced,
           count(*) over (partition by patient_id) as method_count,
           sum(iff(is_default,1,0)) over (partition by patient_id) as default_count,
           row_number() over (partition by patient_id order by is_default desc, synced_at desc) as rn
    from GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_PAYMENT_METHODS
    qualify rn = 1
  ), invoice_agg as (
    select patient_id,
           count(*) as invoice_count,
           max(invoice_date) as last_invoice_date,
           sum(coalesce(amount,0)) as total_invoiced,
           sum(coalesce(paid_amount,0)) as total_paid,
           sum(coalesce(remaining_balance,0)) as total_remaining
    from GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_INVOICES
    group by patient_id
  ), invoice_last as (
    select patient_id, status as last_invoice_status
    from GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_INVOICES
    qualify row_number() over (partition by patient_id order by invoice_date desc, updated_at desc) = 1
  ), payment_agg as (
    select i.patient_id,
           count(*) as payment_count,
           max(p.created_at) as last_payment_date,
           sum(coalesce(p.amount_dollars,0)) as total_payments
    from GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_PAYMENTS p
    join GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_INVOICES i on p.invoice_id = i.invoice_id
    group by i.patient_id
  ), payment_last as (
    select i.patient_id, p.status as last_payment_status
    from GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_PAYMENTS p
    join GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_INVOICES i on p.invoice_id = i.invoice_id
    qualify row_number() over (partition by i.patient_id order by p.created_at desc) = 1
  )
  select pat.patient_id, pat.patient_name, pat.email,
         pma.default_card, (pma.default_count > 0) as has_default_method, pma.method_count,
         ia.invoice_count, ia.last_invoice_date, il.last_invoice_status,
         ia.total_invoiced, ia.total_paid, ia.total_remaining,
         pa.payment_count, pa.last_payment_date, pl.last_payment_status, pa.total_payments,
         case when ia.invoice_count is null then 'No invoices' when ia.total_remaining <= 0 then 'Paid in full' else 'Open balance' end as payment_state
  from GMH_CLINIC.PATIENT_DATA.PATIENTS pat
  left join payment_methods_agg pma on pat.patient_id = pma.patient_id
  left join invoice_agg ia on pat.patient_id = ia.patient_id
  left join invoice_last il on pat.patient_id = il.patient_id
  left join payment_agg pa on pat.patient_id = pa.patient_id
  left join payment_last pl on pat.patient_id = pl.patient_id
  where pma.default_count > 0
  order by ia.total_remaining desc nulls last, ia.last_invoice_date desc nulls last
  limit 50;
  ```
- Current data note (2025-12-25): `HEALTHIE_PAYMENT_METHODS` and `HEALTHIE_PAYMENTS` are empty; `HEALTHIE_INVOICES` has ~69 rows (~45 patients). Expect the query above to return rows once payment methods and payments land; remove the `where pma.default_count > 0` filter if you need all invoiced patients.
- Python connector works via `python3` (Snowflake connector installed user-site). Minimal smoke test:
  ```python
  import snowflake.connector
  conn = snowflake.connector.connect(
      account='KXWWLYZ-DZ83651', user='tinetio123', password='<env var>',
      warehouse='GMH_WAREHOUSE', database='GMH_CLINIC', schema='FINANCIAL_DATA')
  cur = conn.cursor(); cur.execute('select current_account(), current_user(), current_role()'); print(cur.fetchall())
  ```

- Metabase-ready live view (all Healthie payment channels; safe to materialize as a view):
  ```sql
  create or replace view GMH_CLINIC.FINANCIAL_DATA.VW_HEALTHIE_PAYMENTS_ROLLUP as
  with payment_methods as (
    select patient_id,
           card_brand || ' ' || card_last4 as default_card,
           synced_at as last_method_synced,
           count(*) over (partition by patient_id) as method_count,
           sum(iff(is_default,1,0)) over (partition by patient_id) as default_count,
           row_number() over (partition by patient_id order by is_default desc, synced_at desc) as rn
    from GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_PAYMENT_METHODS
    qualify rn = 1
  ), invoices as (
    select patient_id, invoice_id, amount, paid_amount, remaining_balance, status, invoice_date
    from GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_INVOICES
  ), payments as (
    select i.patient_id, sum(p.amount_dollars) as direct_payments, max(p.created_at) as last_direct_payment
    from GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_PAYMENTS p
    join invoices i on p.invoice_id = i.invoice_id
    group by i.patient_id
  ), billing as (
    select patient_id, sum(coalesce(amount_paid,0)) as billing_item_paid, max(payment_date) as last_billing_payment
    from GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_BILLING_ITEMS
    group by patient_id
  ), packages as (
    select patient_id,
           sum(coalesce(amount_paid,0)) as package_paid,
           sum(coalesce(amount_remaining,0)) as package_remaining,
           max(created_at) as last_package_purchase
    from GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_PACKAGE_PURCHASES
    group by patient_id
  )
  select pat.patient_id, pat.patient_name, pat.email, pat.payment_method,
         pm.default_card, (pm.default_count > 0) as has_default_method, pm.method_count, pm.last_method_synced,
         sum(coalesce(inv.amount,0)) as total_invoiced,
         sum(coalesce(inv.paid_amount,0)) as total_paid_on_invoices,
         sum(coalesce(inv.remaining_balance,0)) as total_invoice_balance,
         pay.direct_payments,
         bill.billing_item_paid,
         pkg.package_paid,
         pkg.package_remaining,
         coalesce(pay.direct_payments,0) + coalesce(bill.billing_item_paid,0) + coalesce(pkg.package_paid,0) as total_all_payments,
         greatest(coalesce(pay.last_direct_payment, to_timestamp_ltz(0)), coalesce(bill.last_billing_payment, to_timestamp_ltz(0)), coalesce(pkg.last_package_purchase, to_timestamp_ltz(0))) as last_payment_activity
  from GMH_CLINIC.PATIENT_DATA.PATIENTS pat
  left join payment_methods pm on pat.patient_id = pm.patient_id
  left join invoices inv on pat.patient_id = inv.patient_id
  left join payments pay on pat.patient_id = pay.patient_id
  left join billing bill on pat.patient_id = bill.patient_id
  left join packages pkg on pat.patient_id = pkg.patient_id
  group by pat.patient_id, pat.patient_name, pat.email, pat.payment_method,
           pm.default_card, pm.default_count, pm.method_count, pm.last_method_synced,
           pay.direct_payments, bill.billing_item_paid, pkg.package_paid, pkg.package_remaining,
           pay.last_direct_payment, bill.last_billing_payment, pkg.last_package_purchase;
  ```

- Quick query: unpaid patients labeled “Healthie” (uses invoices; payments table currently empty):
  ```sql
  with inv as (
    select patient_id,
           sum(coalesce(remaining_balance,0)) as total_remaining,
           max(invoice_date) as last_invoice_date,
           count(*) as invoice_count
    from GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_INVOICES
    group by patient_id
  )
  select pat.patient_id, pat.patient_name, pat.email, pat.payment_method,
         inv.invoice_count, inv.total_remaining, inv.last_invoice_date
  from GMH_CLINIC.PATIENT_DATA.PATIENTS pat
  left join inv on pat.patient_id = inv.patient_id
  where pat.payment_method ilike '%healthie%'
    and coalesce(inv.total_remaining,0) > 0
  order by inv.total_remaining desc nulls last
  limit 50;
  ```

- Quick query: last 7 days Healthie revenue (billing items — recurring charges):
  ```sql
  select
    sum(coalesce(amount_paid,0)) as total_revenue,
    min(payment_date) as first_payment_dt,
    max(payment_date) as last_payment_dt,
    count(*) as row_count
  from GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_BILLING_ITEMS
  where payment_date >= dateadd(day, -7, current_date())
    and payment_date < current_date();
  ```

- Snowflake deep dive (GMH_CLINIC snapshots, 2025-12-25):
  - Schemas: `FINANCIAL_DATA`, `PATIENT_DATA`, `INTEGRATION_LOGS` (logs), `PUBLIC` (empty).
  - FINANCIAL_DATA row counts: `HEALTHIE_INVOICES` 69, `HEALTHIE_BILLING_ITEMS` 20, `HEALTHIE_PAYMENT_METHODS` 0, `HEALTHIE_PAYMENTS` 0, `HEALTHIE_PACKAGE_PURCHASES` 0, `MEMBERSHIPS` 102, `PAYMENT_ISSUES` 132, `QB_PAYMENTS` 84, `QB_TRANSACTIONS` 14, `REVENUE_BY_MONTH` (empty/None), `INVOICES` 0, `QUICKBOOKS_PAYMENTS` 0.
  - PATIENT_DATA row counts: `PATIENTS` 305, `LABS` 305, `DEA_TRANSACTIONS` 189, `DISPENSES` 192, `VIALS` 126, `HEALTHIE_OFFERINGS` 5, `PATIENT_OFFERINGS` 0, `PRESCRIPTIONS` 2, `PATIENT_360_VIEW` (view placeholder), `PATIENT_COMPREHENSIVE` (view placeholder).
  - INTEGRATION_LOGS: `SYNC_LOGS` 1.
  - Key Healthie finance columns:
    - Invoices: `INVOICE_ID`, `PATIENT_ID`, `AMOUNT`, `PAID_AMOUNT`, `REMAINING_BALANCE`, `STATUS`, `INVOICE_DATE`, `UPDATED_AT`.
    - Payments: `PAYMENT_ID`, `INVOICE_ID`, `AMOUNT_DOLLARS`, `STATUS`, `CREATED_AT` (table empty today).
    - Payment methods: `PATIENT_ID`, `CARD_BRAND`, `CARD_LAST4`, `IS_DEFAULT`, `SYNCED_AT` (empty today).
    - Billing items: `PATIENT_ID`, `AMOUNT_PAID`, `STATE`, `PAYMENT_DATE` (20 rows present).
    - Packages: `PATIENT_ID`, `OFFERING_NAME`, `OFFERING_PRICE`, `AMOUNT_PAID`, `AMOUNT_REMAINING`, `ACTIVE_STATUS`, `CREATED_AT` (empty today).
  - Other finance: `MEMBERSHIPS` (102), `PAYMENT_ISSUES` (132), QuickBooks payments/transactions present (`QB_PAYMENTS` 84, `QB_TRANSACTIONS` 14).
  - Patient dimension and clinical: `PATIENTS` (demographics, payment_method, cross-system IDs), `LABS` (last/next lab dates), `DEA_TRANSACTIONS` (controlled substance reporting), `DISPENSES`/`VIALS`, `PRESCRIPTIONS`, `HEALTHIE_OFFERINGS` (5 rows), `PATIENT_OFFERINGS` (empty pending ingest).
  - Current gap: Healthie direct payments, payment methods, and package purchases are not yet ingested (0 rows). Any cash outside billing items won’t appear until ingestion is fixed. Use the rollup view + Telegram script; once data lands, it auto-surfaces.

- Unified payment rollup sketch (all Healthie channels):
  ```sql
  with invoices as (
    select patient_id, invoice_id, amount, paid_amount, remaining_balance, status, invoice_date
    from GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_INVOICES
  ), payments as (
    select i.patient_id, sum(p.amount_dollars) as direct_payments, max(p.created_at) as last_direct_payment
    from GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_PAYMENTS p
    join invoices i on p.invoice_id = i.invoice_id
    group by i.patient_id
  ), billing as (
    select patient_id, sum(coalesce(amount_paid,0)) as billing_item_paid, max(payment_date) as last_billing_payment
    from GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_BILLING_ITEMS
    group by patient_id
  ), packages as (
    select patient_id,
           sum(coalesce(amount_paid,0)) as package_paid,
           sum(coalesce(amount_remaining,0)) as package_remaining,
           max(created_at) as last_package_purchase
    from GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_PACKAGE_PURCHASES
    group by patient_id
  )
  select pat.patient_id, pat.patient_name,
         sum(coalesce(inv.amount,0)) as total_invoiced,
         sum(coalesce(inv.paid_amount,0)) as total_paid_on_invoices,
         sum(coalesce(inv.remaining_balance,0)) as total_invoice_balance,
         pay.direct_payments,
         bill.billing_item_paid,
         pkg.package_paid,
         pkg.package_remaining,
         coalesce(pay.direct_payments,0) + coalesce(bill.billing_item_paid,0) + coalesce(pkg.package_paid,0) as total_all_payments
  from GMH_CLINIC.PATIENT_DATA.PATIENTS pat
  left join invoices inv on pat.patient_id = inv.patient_id
  left join payments pay on pat.patient_id = pay.patient_id
  left join billing bill on pat.patient_id = bill.patient_id
  left join packages pkg on pat.patient_id = pkg.patient_id
  group by pat.patient_id, pat.patient_name, pay.direct_payments, bill.billing_item_paid, pkg.package_paid, pkg.package_remaining
  order by total_invoice_balance desc nulls last;
  ```

Healthie SDK: practical Next.js snippet (client-only WebSockets)
- Create `app/components/healthie/ClientOnly.tsx`:
  - `useHydrated` hook to detect client hydration; render children only when hydrated.
- Create `app/components/healthie/ApolloForHealthie.tsx` (lazy-load this file where used):
  - Build `HttpLink` + `ActionCableLink` split; headers `authorization: Basic <user_auth_token>`, `authorizationsource: API`.
  - Export a component that wraps children with `ApolloProvider client={client}`.
- Usage pattern inside a client component (e.g., `app/(client)/healthie-chat/page.tsx`):
  - Mark `"use client"` at top.
  - Import `ClientOnly` and lazy `ApolloForHealthie` (via `React.lazy` or `next/dynamic` with `ssr:false`).
  - Wrap Healthie UI:
    - `<ClientOnly fallback={<div>Loading chat…</div>}>{() => (<ApolloForHealthie><HealthieProvider userId={healthieUserId} brandedUrl={brandedUrl} brandedBackendUrl={brandedBackendUrl}><ConversationList onConversationClick={...} activeId={...} /> <Chat conversationId={...} /> <Form id={formId} onSubmit={...} /></HealthieProvider></ApolloForHealthie>)}</ClientOnly>`
- Import styles once globally: add `import '@healthie/sdk/dist/styles/index.css'` in a client entry (or a dedicated client wrapper) to avoid SSR issues.

Healthie SDK: ready-to-paste skeletons
- `app/components/healthie/useHydrated.ts`:
  ```ts
  import { useEffect, useState } from 'react';

  let isHydrating = true;

  export function useHydrated() {
    const [isHydrated, setIsHydrated] = useState(() => !isHydrating);
    useEffect(() => {
      isHydrating = false;
      setIsHydrated(true);
    }, []);
    return isHydrated;
  }
  ```
- `app/components/healthie/ClientOnly.tsx`:
  ```tsx
  'use client';
  import { ReactNode } from 'react';
  import { useHydrated } from './useHydrated';

  export function ClientOnly({ children, fallback = null }: { children: () => ReactNode; fallback?: ReactNode }) {
    return useHydrated() ? <>{children()}</> : <>{fallback}</>;
  }
  ```
- `app/components/healthie/ApolloForHealthie.tsx` (client-only usage):
  ```tsx
  'use client';
  import { ApolloClient, ApolloProvider, HttpLink, InMemoryCache, split } from '@apollo/client';
  import { getMainDefinition } from '@apollo/client/utilities';
  import * as ActionCable from '@rails/actioncable';
  import ActionCableLink from 'graphql-ruby-client/subscriptions/ActionCableLink';

  const httpLink = new HttpLink({
    uri: 'https://api.gethealthie.com/graphql',
    headers: {
      authorization: `Basic ${process.env.NEXT_PUBLIC_HEALTHIE_TOKEN ?? ''}`,
      authorizationsource: 'API'
    }
  });

  const cable = ActionCable.createConsumer(
    `wss://ws.gethealthie.com/subscriptions?token=${process.env.NEXT_PUBLIC_HEALTHIE_TOKEN ?? ''}`
  );
  const wsLink = new ActionCableLink({ cable });

  const link = split(
    ({ query }) => {
      const def = getMainDefinition(query);
      return def.kind === 'OperationDefinition' && def.operation === 'subscription';
    },
    wsLink,
    httpLink
  );

  const client = new ApolloClient({
    link,
    cache: new InMemoryCache()
  });

  export function ApolloForHealthie({ children }: { children: React.ReactNode }) {
    return <ApolloProvider client={client}>{children}</ApolloProvider>;
  }
  ```
- Example page usage (client component):
  ```tsx
  'use client';
  import dynamic from 'next/dynamic';
  import { HealthieProvider, ConversationList, Chat, Form } from '@healthie/sdk';
  import { ClientOnly } from '@/app/components/healthie/ClientOnly';
  import '@healthie/sdk/dist/styles/index.css';

  const ApolloForHealthie = dynamic(() => import('@/app/components/healthie/ApolloForHealthie'), { ssr: false });

  export default function HealthieChatPage() {
    const healthieUserId = 'REPLACE_USER_ID';
    const brandedUrl = process.env.NEXT_PUBLIC_HEALTHIE_BRANDED_URL;
    const brandedBackendUrl = process.env.NEXT_PUBLIC_HEALTHIE_BRANDED_BACKEND_URL;

    return (
      <ClientOnly fallback={<div>Loading chat…</div>}>
        {() => (
          <ApolloForHealthie>
            <HealthieProvider userId={healthieUserId} brandedUrl={brandedUrl} brandedBackendUrl={brandedBackendUrl}>
              <ConversationList />
              <Chat />
              <Form id="REPLACE_FORM_ID" />
            </HealthieProvider>
          </ApolloForHealthie>
        )}
      </ClientOnly>
    );
  }
  ```

If anything below is unclear or you want the file to include additional examples (e.g., common SQL snippets or a short list of important `lib/*` functions), tell me which areas to expand and I'll update this file.

---

## Telegram AI Bot — Data Query & Write System

The bot (`scripts/telegram-ai-bot-v2.ts`) is a conversational AI interface to GMH data via Telegram. It uses AWS Bedrock (Claude 3 Haiku) to convert natural language to SQL, queries Snowflake, and can write to Healthie.

### Architecture
- **PM2 process**: `telegram-ai-bot-v2` (process 6), restart with `pm2 restart telegram-ai-bot-v2`
- **AWS Bedrock**: Model `us.anthropic.claude-3-haiku-20240307-v1:0` for SQL generation
- **Snowflake**: Read queries against `GMH_CLINIC` database
- **Healthie GraphQL**: Read + Write via mutations for patient updates
- **Schema context**: Auto-discovered from `lib/discoveredSchema.ts`, generated by `scripts/discover-schema.ts`

### Key Features (2025-12-25)
1. **Self-healing SQL**: If a query fails, AI generates a corrected query based on the error
2. **Smart data fusion**: Combines Snowflake data + live Healthie API for enriched answers
3. **Conversation context**: Follow-up questions use previous query context ("who are they?")
4. **SQL extraction**: Extracts SQL even if AI adds explanatory text before it
5. **Write mutations**: Can update patient demographics in Healthie via natural language

### Lessons Learned & Fixes

#### SQL Generation Issues
- **Problem**: AI sometimes adds "Here is the SQL query:" before the actual SQL
- **Fix**: Added regex extraction `/^(SELECT|WITH|SHOW|DESCRIBE|EXPLAIN)\b[\s\S]*/im` in `generateSQL()` to extract just the SQL
- **Location**: Lines 481-485 in telegram-ai-bot-v2.ts

#### Provider Patient Count Queries
- **Problem**: AI tries to COUNT(*) from PATIENTS table instead of using precomputed PROVIDERS.PATIENT_COUNT
- **Fix**: Added explicit example in schema context showing to SELECT PATIENT_COUNT FROM PROVIDERS directly
- **Example query**: `SELECT PROVIDER_NAME, PATIENT_COUNT FROM GMH_CLINIC.PATIENT_DATA.PROVIDERS WHERE PROVIDER_NAME ILIKE '%whitten%'`
- **Current data**: Aaron Whitten: 243 patients, Phil Schafer NP: 27 patients

#### Testosterone Inventory Queries
- **Problem**: AI confused "Carrie Boyd" as a patient name instead of a testosterone medication type
- **Fix**: Added CRITICAL INSTRUCTIONS in prompt explaining two testosterone types:
  - "Carrie Boyd - Testosterone Miglyol 812 Oil Injection 200mg/ml" — 419.4 ML (46 vials)
  - "TopRX (Testosterone Cypionate Cottonseed Oil 200mg/ml)" — 330 ML (80 vials)
- **Projection query**: Uses CTE with daily usage rate (32.32 ML/day) to calculate runout date

#### Invoice Data Sync
- **Problem**: Healthie invoices in Snowflake had IDs but missing amount/balance/dates
- **Fix**: Created `scripts/sync-healthie-invoices.ts` that fetches `requestedPayments` with full details
- **Run**: `HEALTHIE_API_KEY=... SNOWFLAKE_PASSWORD=... npx tsx scripts/sync-healthie-invoices.ts`
- **Schedule**: Run daily or on-demand to keep invoice data fresh

#### Billing Item States
- **HEALTHIE_BILLING_ITEMS.STATE values**: `succeeded` (paid), `scheduled` (future), `failed` (declined)
- **Current counts (2025-12-25)**: 54 succeeded ($8,360), 27 scheduled, 1 failed ($140)

### Sync Scripts Inventory
\`\`\`bash
# Provider sync (Healthie → Snowflake)
npx tsx scripts/sync-healthie-providers.ts

# Invoice sync (Healthie → Snowflake)  
npx tsx scripts/sync-healthie-invoices.ts

# Schema discovery (refresh bot context)
npx tsx scripts/discover-schema.ts

# Billing items ingest
npx tsx scripts/ingest-healthie-financials.ts
\`\`\`

### PM2 Environment Variables (Bot)
Key env vars for telegram-ai-bot-v2 (set in PM2 ecosystem or shell):
- \`TELEGRAM_BOT_TOKEN\` — Telegram bot API token
- \`TELEGRAM_AUTHORIZED_CHAT_IDS\` — Comma-separated chat IDs allowed to use bot
- \`HEALTHIE_API_KEY\` — For API reads/writes
- \`SNOWFLAKE_PASSWORD\` — For warehouse queries
- \`AWS_REGION=us-east-1\` — Bedrock region

### Healthie Write Mutations (Patient Updates)
The bot supports natural language commands to update patient data in Healthie:
- "Update address for John Smith to 123 Main St, City, ST 12345"
- "Change phone number for patient X to 555-123-4567"
- "Set email for James Lentz to newemail@example.com"

**GraphQL Mutation used** (\`updateClient\`):
\`\`\`graphql
mutation UpdateClient(\$id: ID!, \$input: ClientInput!) {
  updateClient(id: \$id, input: \$input) {
    user {
      id
      first_name
      last_name
      email
      phone_number
      location { line1 line2 city state zip country }
    }
    messages { field message }
  }
}
\`\`\`

**ClientInput fields available**:
- \`first_name\`, \`last_name\`, \`legal_name\`
- \`email\`, \`phone_number\`
- \`dob\` (format: "YYYY-MM-DD")
- \`gender\`, \`sex\`
- \`line1\`, \`line2\`, \`city\`, \`state\`, \`zip\`, \`country\` (for address)
- \`timezone\`
- \`dietitian_id\` (reassign provider)

**Safety**: Bot confirms updates before executing and logs all mutations to console.

### Debugging the Bot
\`\`\`bash
# View recent logs
pm2 logs telegram-ai-bot-v2 --lines 50 --nostream

# Check SQL generation
pm2 logs telegram-ai-bot-v2 --lines 100 --nostream | grep "Generated SQL"

# Restart after code changes
pm2 restart telegram-ai-bot-v2

# Check process status
pm2 show telegram-ai-bot-v2
\`\`\`

### Common Issues & Solutions
| Issue | Cause | Solution |
|-------|-------|----------|
| "I generated a text response" | AI didn't produce SQL | Check if question is answerable from schema; add examples to discoveredSchema.ts |
| "invalid identifier" | Column doesn't exist | Self-healing should fix; verify column in INFORMATION_SCHEMA |
| Stale invoice data | Sync hasn't run | Run \`sync-healthie-invoices.ts\` |
| Provider count = 0 | AI not using PROVIDERS table | ✅ FIXED: Added specializedHint in generateSQL() that detects provider/whitten/schafer keywords and injects exact query |
| Bot not responding | PM2 crash or auth issue | Check \`pm2 logs\`, verify TELEGRAM_BOT_TOKEN |
| "Carrie Boyd" not recognized | AI treats as patient name | ✅ FIXED: Added specializedHint that detects "carrie boyd" and explains it's a medication type with exact queries |
| Update commands not working | parseUpdateCommand required "for [Name]" | ✅ FIXED: Added patterns for "[Name]'s [field]" and "[Name] [field] to [value]" |
| Gender updates failing | No gender pattern in parser | ✅ FIXED: Added gender pattern with male/female/m/f/man/woman/non-binary support |
| Smart quotes breaking patterns | Telegram sends curly apostrophes (') not straight (') | ✅ FIXED: Added \`cleanedText.replace(/['']/g, "'")\` to normalize quotes |
| Patient address not showing | Healthie API only called for financial queries | ✅ FIXED: Now ALWAYS fetches Healthie data when patient name detected |

### Update Command Patterns (Fixed 2025-12-25)
The bot now supports multiple natural language patterns for Healthie updates:

1. **"for [Name]" pattern**: \`Update email for John Smith to john@example.com\`
2. **Possessive pattern**: \`Update John Smith's email to john@example.com\`
3. **Name-first pattern**: \`Update John Smith email to john@example.com\`
4. **With "please" prefix**: \`Please update John Smith's gender to male\`
5. **With "can you" prefix**: \`Can you change John Smith's phone to 555-1234\`

**Supported fields**: email, phone, address (with city/state/zip parsing), first_name, last_name, dob, gender

**Smart Quote Handling**: Telegram sends curly/smart apostrophes (\`'\` U+2019) instead of straight quotes (\`'\`). The parser normalizes these before pattern matching with: \`cleanedText.replace(/['']/g, "'")\`

### Specialized Query Hints (Fixed 2025-12-25)
The \`generateSQL()\` function now detects keywords in questions and injects exact queries at the START of the prompt:

- **Provider patient counts**: Detects "whitten", "schafer", "provider", "doctor" + "patient"/"how many" → Injects exact PROVIDERS.PATIENT_COUNT query
- **Carrie Boyd testosterone**: Detects "carrie boyd" or "carrie" + "testosterone" → Injects inventory and projection queries
- **TopRX testosterone**: Detects "toprx" or "top rx" → Injects TopRX-specific queries

This ensures Claude Haiku uses the correct tables even if the schema context is long.

### Smart Data Fusion (Fixed 2025-12-25)
When a patient name is detected in a query, the bot now ALWAYS fetches from Healthie API in addition to Snowflake:

- **findHealthieUser query** now includes: id, email, first_name, last_name, phone_number, gender, dob, active_tags, and **locations** (address data)
- **Address formatting**: Locations are formatted as "line1, line2, city, state, zip, country"
- **Combined context**: Both Snowflake and Healthie data are merged and sent to the AI for comprehensive answers

This ensures patient addresses, demographics, and real-time billing data are always available even though Snowflake doesn't store addresses.

