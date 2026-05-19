# GMH Dashboard — Dependency Map

> **Purpose**: Understand what connects to what so changes don't cause cascading failures.
> **Rule**: If you change X, verify Y and Z still work.

---

## Critical Integration Chains

### 1. Patient Creation Pipeline
```
Patient Form (app/patients/) 
  → lib/patientQueries.ts (INSERT INTO patients)
  → lib/patientHealthieSync.ts (createClient mutation → Healthie)
  → lib/patientGHLSync.ts (create contact → GHL via lib/ghl.ts)
  → healthie_clients table (stores healthie_client_id)
  → patient_ghl_mapping table (stores ghl_contact_id)
```
**If you change**: Patient creation form or patientQueries  
**Also verify**: Healthie sync, GHL sync, healthie_clients table, ghl_contact_id mapping

### 2. Healthie Sync → Postgres → Dashboard → GHL
```
Healthie API (webhooks: app/api/integrations/healthie/webhook/route.ts)
  → divergence log → agent_action_log (agent_name='healthie_webhook',
                                       action_type='patient_divergence')
  → COALESCE UPDATE patients (dob/phone/address/email — webhook still wins
                              today; flip to log-only is a future step)
  → scripts/process-healthie-webhooks.ts (queued event handler)
  → Postgres: patients, healthie_clients, payment_issues tables
  → Dashboard UI (app/patients/, app/patient-hub/)
  → lib/ghl.ts → GHL contact update (tags, custom fields)
  → Snowflake (via cron sync every 4hr: scripts/sync-all-to-snowflake.py)

Outbound sync (Postgres → Healthie):
  PATCH /api/patients/[id], PUT /api/ipad/patient/[id]/demographics
  → lib/healthieDemographics.ts:syncHealthiePatientDemographics()
       Gate: method_of_payment ~ /healthie/i AND
             (client_type ∈ {NowMensHealth.Care, NowPrimary.Care}
              OR existing healthie_clients link)
  → updateClient (demographics) + upsertClientLocation (address)
       updateClient failure is NON-FATAL — address still attempted.
  → persist outcome on patients.healthie_sync_status / _error / _last_synced_at
  → parallel ghl_sync_status / _error / _last_synced_at write
```
**If you change**: Webhook processing or patient table schema  
**Also verify**: Dashboard patient views, GHL sync, Snowflake sync, Telegram reports, the *_sync_status columns still get written on every PATCH/PUT (May 19, 2026 contract — both sync legs persist on success AND failure), the divergence log query still returns rows on a manual webhook test, blocked_email_collision rows are NOT retried until human resolves them

### 3. Payment Decline → Auto-Hold → Patient Notification
```
Healthie webhook (payment.failed)
  → scripts/process-healthie-webhooks.ts
  → Check for recent successful payment (skip if found)
  → Postgres: patients.status_key → 'hold_payment_research'
  → Postgres: payment_issues table INSERT
  → Telegram alert (via lib/telegram-client.ts)
  → Google Chat (ops-billing space webhook)
  → Healthie Chat message to patient (createConversation + createNote)
  ⟲ When patient pays: auto-reactivate → status = 'active'
```
**If you change**: Payment webhook processing  
**Also verify**: Patient status display, Telegram alerts, Healthie chat messages, reactivation flow

### 4. Lab Pipeline (Access Labs → S3 → Review → Healthie)
```
Access Labs API (cron every 30 min)
  → scripts/labs/fetch_results.py
  → Patient matching (Postgres → Healthie → Snowflake fallback)
  → scripts/labs/generate_lab_pdf.py → S3 (gmh-clinical-data-lake)
  → Postgres: lab_review_queue table
  → Dashboard: app/api/labs/ routes → /ops/labs UI
  → Provider approves → scripts/labs/healthie_lab_uploader.py → Healthie chart
  → Google Chat alert (severity ≥4)
```
**If you change**: Lab fetch scripts or review queue  
**Also verify**: S3 permissions, PDF generation, Healthie upload, alert routing, patient matching

### 5. iPad/Mobile Billing → Stripe → Receipt → Healthie
```
iPad app (public/ipad/app.js) 
  → app/api/ipad/billing/charge/route.ts
  → Stripe API (charge with "NOWOptimal Service" descriptor)
  → Postgres: patient_billing_cart, payment_transactions
  → lib/pdf/simpleReceiptGenerator.ts → PDF receipt
  → lib/simpleReceiptUpload.ts → Healthie document upload
  ⚠️ public/mobile/app.js MUST be synced: bash scripts/sync-mobile.sh
```
**If you change**: iPad app.js or billing route  
**Also verify**: Mobile sync, Stripe descriptor, receipt PDF content, Healthie upload, cart table

### 6. Controlled Substance (DEA) Inventory
```
Morning check (app/inventory/MorningCheckForm.tsx)
  → app/api/inventory/controlled-check → controlled_substance_checks table
  → BLOCKS dispensing until morning check done
  → Dispense: app/api/dispenses/ → vials table + dea_transactions table
  → Staged doses: app/api/staged-doses/ → staged_doses table + vials
  → Telegram morning report (scripts/morning-telegram-report.ts)
```
**If you change**: Inventory APIs or vials table  
**Also verify**: Morning check enforcement, DEA transaction logging, staged dose math, Telegram report numbers

### 7. AI Scribe Pipeline
```
iPad records audio → upload-receiver (port 3001)
  → S3 upload → scripts/scribe/scribe_orchestrator.py
  → AWS Deepgram (transcription) → AWS Bedrock Claude (notes)
  → Telegram approval (scripts/scribe/telegram_approver.py)
  → Provider approves → Healthie document injection
  → scribe_sessions + scribe_notes tables
```
**If you change**: Upload receiver or scribe scripts  
**Also verify**: S3 permissions, Telegram approval flow, Healthie document creation

### 8. GHL AI Agents (Jessica/Max)
```
Patient calls/texts → GHL → Webhook (port 3003)
  → scripts/ghl-integration/webhook-server.js
  → jessica-mcp (port 3002, Python) queries:
      → Postgres (source of truth for patient IDs)
      → Healthie API (real-time clinical data)
      → Snowflake (analytics, 6hr lag OK)
      → GHL API (tags, custom fields)
      → Bedrock AI (reasoning)
  → Response back to GHL → Patient
```
**If you change**: GHL webhook server or MCP tools  
**Also verify**: Postgres patient lookup, Healthie API responses, port assignments, ngrok tunnel

### 9. Website Booking → Healthie
```
nowprimary.care or nowmenshealth.care
  → BookingWidget.tsx → /api/healthie/slots (availableSlotsForRange)
  → /api/healthie/book → createClient + createAppointment
  ⚠️ DO NOT pass location_id to availableSlotsForRange
  ⚠️ MUST use other_party_id + providers to prevent dual-provider bug
```
**If you change**: Booking APIs or Healthie client  
**Also verify**: Slot availability, appointment creation, dual-provider fix, form triggers

### 10. Snowflake Sync Pipeline
```
Postgres tables (patients, vials, dispenses, memberships, etc.)
  → Cron every 4hr: scripts/sync-all-to-snowflake.py
  → Snowflake: GMH_CLINIC database
  → Jarvis Telegram bot queries Snowflake
  → Mobile app (lambda-ask-ai) queries Snowflake PATIENT_360_VIEW
  → Healthie billing → Snowflake HEALTHIE_BILLING_ITEMS (every 6hr)
```
**If you change**: Postgres table schemas  
**Also verify**: Snowflake sync script column mappings, Jarvis queries, mobile app data

### 11. BioSCOPE Third-Party API (NEW Apr 29, 2026)
```
BioSCOPE
  → POST/GET /api/bioscope/* with x-bioscope-secret + patient_id
  → lib/bioscope-auth.ts (verifyBioscopeSecret + isPatientAuthorized + auditBioscopeCall)
  → bioscope_authorized_patients (allowlist — active row WHERE revoked_at IS NULL)
  → lib/bioscope-healthie.ts (dedicated client using BIOSCOPE_HEALTHIE_API_KEY)
  → Healthie API
  → agent_action_log (audit row, agent_name='bioscope')
Admin UI: /ops/admin/bioscope → app/api/admin/bioscope/route.ts (GET/POST/DELETE)
```
**If you change**: Bioscope routes or allowlist logic  
**Also verify**: `bioscope_authorized_patients` allowlist behaviour, `BIOSCOPE_API_SECRET` + `BIOSCOPE_HEALTHIE_API_KEY` env vars set, audit row written for every call (success and rejection), admin UI shows active vs. revoked correctly
**Module**: `docs/sot-modules/29-bioscope-integration.md`

### 12. Dispatch Session Coordinator (NEW Apr–May 2026)
```
tmux Claude session
  → claude-coord checkin --task "..."
  → ~/.claude/coord/registry.json (live session table)
  → ~/.claude/coord/sessions/<tmux>.md (per-session activity log)
  → auto-creates feature branch: claude/<tmux>/<slug>
  ⤴ MCP exposure: dispatch-mcp (PM2 service, port 3010 localhost) — same state files
  ⤴ Cron: */5 * * * * claude-coord reap (auto-cleans dead tmux sessions)
  ⤴ tmux hook: session-closed → reaps immediately
```
**If you change**: `claude-coord` script, `~/.claude/coord/` state schema, or dispatch-mcp tool definitions  
**Also verify**: registry.json roundtrip (checkin → list → checkout), the cron reaper still runs, `cs` launcher preflight, dispatch-mcp HTTP/SSE on 127.0.0.1:3010

### 13. Pre-Deploy Gatekeeper + Agents Dashboard (NEW May 2026)
```
Code change in gmhdashboard
  → bash scripts/pre-deploy-check.sh  (MANDATORY)
      ├─ typecheck, build, dangerous-grep, env var sanity, branch hygiene
      └─ writes docs/DEPLOY_CHECK.md report
  → exit 0 = safe; non-zero = BLOCKED (DO NOT deploy)
  → pm2 restart gmh-dashboard && pm2 save
  → bash scripts/health-check.sh (post-deploy sanity, writes docs/KPI_CHECK.md)

Agent telemetry surface:
  /ops/ops-center (page) ─┐
  /ops/agents (existing)  ├──→ app/api/code/agent-health/route.ts
                          ├──→ app/api/code/sessions/route.ts
                          ├──→ app/api/code/kill-session/route.ts
                          ├──→ app/api/code/launch-task/route.ts
                          └──→ app/api/code/health-check/route.ts

Agent scripts (cron-driven):
  scripts/agents/morning-intelligence.sh  (daily 6:47am MST)
  scripts/agents/system-monitor.sh        (hourly :13)
  scripts/agents/auto-remediation.sh      (daily 7am MST)
  scripts/agents/data-integrity.sh        (on-demand)
  scripts/agents/debug-all-systems.sh     (debug protocol, 26 tests)
```
**If you change**: pre-deploy-check.sh, health-check.sh, or any `scripts/agents/*.sh`  
**Also verify**: `claude-coord checkout` still re-runs debug as gate, `docs/DEPLOY_CHECK.md` and `docs/KPI_CHECK.md` write paths still valid, agents dashboard pages still render, cron lines for the agent scripts in `crontab -l` still exist
**Note**: Duplicate `/ops/agents` page was removed (commit `d87a91b`) — API infrastructure retained for existing `/agents` dashboard. Do not re-create the page.

### 14. Patient Classification Engine (NEW Apr 28, 2026)
```
Healthie patient data + GHL signals + intake completions
  → migrations/20260428_client_type_classification.sql (schema)
  → scripts/generate-classification-audit.js  (read-only dry-run, all 491 patients)
  → docs/sot-modules/26-classification-audit.md  (audit snapshot — regenerate any time)
  → scripts/apply-classification-batch.js  (idempotent apply when ready)
  → Nightly cron 3am MST: scripts/refresh-intake-signals.js
     → patient_signals_cache table (badge data for dashboard)
     → /api/dashboard/status-activity (iPad widget)
```
**If you change**: classification logic, signals schema, or audit generator  
**Also verify**: audit output committed under `docs/sot-modules/26-classification-audit.md`, signals cache populates without errors, iPad badge display
**Modules**: 25 (spec), 26 (audit), 27 (patient flow map)

### 15. Patient Status Chokepoint — Hardening Plan v3
```
ANY code path that writes patients.status_key
  → MUST call lib/status-transitions.ts:transitionStatus()
      ├─ Pre-flight rule check (no webhook → inactive; no inactive-out except admin/script)
      ├─ SET LOCAL session GUCs (source, actor, reason)
      └─ Single UPDATE
  → DB trigger trg_patient_status_audit (BEFORE UPDATE OF status_key)
      ├─ Re-applies rules from session GUCs (bypass-proof backstop)
      ├─ Writes patient_status_audit row
      └─ Sets status_key_updated_at

  ESLint guard: eslint.config.mjs `no-restricted-syntax` blocks raw
  `UPDATE patients SET ... status_key` outside lib/status-transitions.ts (severity: error)
```
**If you change**: any code that touches `patients.status_key`  
**Also verify**: route uses `transitionStatus()`, ESLint passes (`npm run lint`), audit-gap query returns 0 net new gaps, acceptance tests still 17/17 (`scripts/test-status-chokepoint.ts`)
**Module**: `docs/sot-modules/28-hardening-plan-v3.md`

---

## Port Registry (Conflict = Cascading Failure)

| Port | Service | Notes |
|------|---------|-------|
| 3001 | upload-receiver | Scribe audio uploads |
| 3002 | jessica-mcp | MCP server (Python) |
| 3003 | ghl-webhooks | `ghl-webhooks` is the bound listener on 0.0.0.0. |
| 3003 | nowmentalhealth-website (per ecosystem registry) | Verify with `pm2 describe` if conflicts appear |
| 3004 | nowprimary-website / nowmenshealth-website | Confirm via `pm2 describe` — historical drift in this assignment |
| 3007 | nowmenshealth-website (per app dir) | |
| 3008 | nowoptimal-website | |
| 3009 | abxtac-website | ABX TAC peptides |
| 3010 | dispatch-mcp | MCP server for `claude-coord` multi-session dispatch (HTTP/SSE on `127.0.0.1`; stdio fallback). Moved off 3003 in May 2026. |
| 3011 | gmh-dashboard | Main dashboard |

> **RULE**: If two services try the same port, BOTH crash in an infinite restart loop. Always check `pm2 describe <service> \| grep -E 'PORT\|port'` before adding services. The 3003 / 3004 lines above show real-world ambiguity in our registry — verify against `ecosystem.config.js` AND running PM2 state, not the doc.

---

## Database Table Dependency Clusters

### Patient Core
`patients` ← `healthie_clients` ← `patient_ghl_mapping` ← `patient_qb_mapping`
+ NEW: `patient_signals_cache` (badge cache populated nightly by `scripts/refresh-intake-signals.js`)

### Classification & Status (Hardening v3, Apr 2026)
`patients` (status_key) → trigger `trg_patient_status_audit` → `patient_status_audit`
`patient_status_activity_log` (iPad status-activity widget)
`client_type_lookup`, `payment_method_lookup`, `patient_status_lookup` (FK targets)
`client_type_audit`, `client_type_overrides` (classification audit trail)

### Billing
`payment_transactions` ← `payment_issues` ← `patient_billing_cart` ← `quickbooks_payments`
`healthie_invoices`, `quickbooks_payment_transactions`, `quickbooks_sales_receipts`

### Inventory (DEA)
`vials` ← `dea_transactions` ← `staged_doses` ← `controlled_substance_checks` ← `dispenses`
`weekly_inventory_audits` (added Apr 2026)

### Labs
`lab_review_queue` ← `lab_orders` ← `lab_processed_accessions` ← `critical_lab_alerts`
+ BioBox: `lab_orders` (BioBox columns added in `migrations/20260416_biobox_lab_orders.sql`)

### Integrations
`ghl_sync_history` ← `ghl_messages` ← `healthie_webhook_events` ← `sync_logs`

### Third-party APIs (NEW)
`bioscope_authorized_patients` ← `agent_action_log` (audit row per call, `agent_name='bioscope'`)
`abxtac_customer_access` (BioBox consult eligibility — `provider_verified=true AND tier_expires_at > NOW()`)

### Peptide fulfillment (May 2026)
Two channels share `peptide_dispenses.channel='woo'|'inhouse'` (mirrors `peptide_order_tracking.channel`):

- **inhouse**: `patient_billing_cart` → `app/api/ipad/billing/charge` → `peptide_dispenses` (channel=`inhouse`, status=`Paid`, `education_complete` flipped at clinic pickup). Education required.
- **woo (ship-to)**: `patient_billing_cart` → `app/api/ipad/billing/ship-order` (or mobile `app/api/headless/checkout`, or `pending-orders` approval, or `company-order`) → ABXTAC WooCommerce REST → ShipStation → USPS. Also writes `peptide_dispenses` (channel=`woo`, status=`Shipped`) + `payment_transactions.woocommerce_order_id`. ABXTAC handles consent/education at WC checkout — GMH dashboard does NOT prompt for education on these rows.

Healthie billing-item webhook (`lib/healthie/peptideWebhook.ts`) skips auto-creating a `Pending` dispense when `payment_transactions.healthie_billing_item_id` already has a `woocommerce_order_id` (the ship-order route owns the row).

See `docs/sot-modules/30-peptide-pipeline.md` for the full INSERT site map and gated education surfaces.

### Mobile / Push (NEW)
`patient_push_tokens` ← `push_send_log` (Apr 19 push notification system)
`app_access_controls` (mobile app access gating)
`kiosk_form_sessions` (iPad onboarding forms)

---

## "If You Touch This, Everything Breaks" Files

| File | Impact | Why |
|------|--------|-----|
| `lib/db.ts` | **ALL database operations** | Single Postgres connection pool |
| `lib/basePath.ts` | **ALL routes and URLs** | Base path `/ops` — wrong path = 404s everywhere |
| `lib/auth.ts` | **ALL authenticated pages** | Session cookie `gmh_session_v2` — break = locked out |
| `lib/healthie.ts` | **ALL Healthie integrations** | GraphQL client — break = no patient data |
| `lib/ghl.ts` | **ALL GHL operations** | GHL API client + patient routing logic |
| `lib/status-transitions.ts` | **ALL patient.status_key writes** | Chokepoint helper — every status mutation must route here. Bypass = ESLint error + DB trigger backstop |
| `lib/bioscope-auth.ts` | **ALL BioSCOPE API access** | Allowlist check + audit logger. Break = third-party integration locked out or unaudited |
| `~/.claude/bin/claude-coord` | **ALL session coordination** | Multi-session dispatch CLI. Break = session collisions return |
| `~/dispatch-mcp/server.py` | **Cowork MCP integration** | Surfaces claude-coord to MCP clients. Break = remote tooling stops working |
| `scripts/pre-deploy-check.sh` | **ALL deploys** | Mandatory gatekeeper. Bypassing = unsafe deploys |
| `scripts/agents/debug-all-systems.sh` | **`done` quick-command + `claude-coord debug`** | 26-test debug suite. Break = false confidence on checkout |
| `.env.local` | **EVERYTHING** | All credentials — wrong edit = total system failure |
| `ecosystem.config.js` | **ALL PM2 services** | Service definitions — break = no services start |
| `next.config.js` | **Build + routing** | trailingSlash, basePath — break = broken builds |

---

*Last updated: Auto-generated — verify against codebase before making changes.*
