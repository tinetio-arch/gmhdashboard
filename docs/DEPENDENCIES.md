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
Healthie API (webhooks)
  → scripts/process-healthie-webhooks.ts (webhook handler)
  → Postgres: patients, healthie_clients, payment_issues tables
  → Dashboard UI (app/patients/, app/patient-hub/)
  → lib/ghl.ts → GHL contact update (tags, custom fields)
  → Snowflake (via cron sync every 4hr: scripts/sync-all-to-snowflake.py)
```
**If you change**: Webhook processing or patient table schema  
**Also verify**: Dashboard patient views, GHL sync, Snowflake sync, Telegram reports

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

---

## Port Registry (Conflict = Cascading Failure)

| Port | Service | Notes |
|------|---------|-------|
| 3001 | upload-receiver | Scribe audio uploads |
| 3002 | jessica-mcp | MCP server (Python) |
| 3003 | ghl-webhooks | GHL integration |
| 3004 | nowmenshealth-website | Men's Health site |
| 3007 | nowoptimal-website | NOW Optimal hub |
| 3008 | nowprimary-website | Primary Care site |
| 3009 | abxtac-website | ABX TAC peptides |
| 3011 | gmh-dashboard | Main dashboard |

> **RULE**: If two services try the same port, BOTH crash in an infinite restart loop. Always check ports before adding services.

---

## Database Table Dependency Clusters

### Patient Core
`patients` ← `healthie_clients` ← `patient_ghl_mapping` ← `patient_qb_mapping`

### Billing
`payment_transactions` ← `payment_issues` ← `patient_billing_cart` ← `quickbooks_payments`

### Inventory (DEA)
`vials` ← `dea_transactions` ← `staged_doses` ← `controlled_substance_checks` ← `dispenses`

### Labs
`lab_review_queue` ← `lab_orders` ← `lab_processed_accessions` ← `critical_lab_alerts`

### Integrations
`ghl_sync_history` ← `ghl_messages` ← `healthie_webhook_events` ← `sync_logs`

---

## "If You Touch This, Everything Breaks" Files

| File | Impact | Why |
|------|--------|-----|
| `lib/db.ts` | **ALL database operations** | Single Postgres connection pool |
| `lib/basePath.ts` | **ALL routes and URLs** | Base path `/ops` — wrong path = 404s everywhere |
| `lib/auth.ts` | **ALL authenticated pages** | Session cookie `gmh_session_v2` — break = locked out |
| `lib/healthie.ts` | **ALL Healthie integrations** | GraphQL client — break = no patient data |
| `lib/ghl.ts` | **ALL GHL operations** | GHL API client + patient routing logic |
| `.env.local` | **EVERYTHING** | All credentials — wrong edit = total system failure |
| `ecosystem.config.js` | **ALL PM2 services** | Service definitions — break = no services start |
| `next.config.js` | **Build + routing** | trailingSlash, basePath — break = broken builds |

---

*Last updated: Auto-generated — verify against codebase before making changes.*
