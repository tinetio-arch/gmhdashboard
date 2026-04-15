
**Root Cause**: `sync-healthie-failed-payments.ts` was matching old failed billing items that had already been resolved, without checking for more recent successful payments.

**Fix**: Implemented deduplication in `sync-healthie-failed-payments.ts` — before setting a hold, the system now checks if the patient has a more recent successful payment. If so, the hold is skipped.

---

### February 16, 2026: Unified Python Snowflake Sync

**Replaced 4 broken Node.js sync scripts with a single Python script**: `scripts/sync-all-to-snowflake.py`

| Old (broken) | New (working) |
|---|---|
| `sync-healthie-ops.js` | `sync-all-to-snowflake.py` |
| `sync-healthie-billing-items.ts` | (included in unified sync) |
| `sync-healthie-invoices.ts` | (included in unified sync) |
| `scripts/scribe/healthie_snowflake_sync.py` | (included in unified sync) |

**Also added**:
- `cron-alert.sh` — wrapper for all cron jobs that sends Telegram alert on failure
- `website-monitor.sh` — checks all websites every 5 min
- `kill-stale-terminals.sh` — cleans up hung terminal sessions
- `snowflake-freshness-check.py` — alerts if any Snowflake table is older than expected
- `cache-healthie-revenue.py` — Python replacement of the TS revenue cache script

---

### February 15, 2026: Fax System — Active Patients Only

**Problem**: Archived patients were appearing in fax patient search results.

**Fix**: Modified patient search in fax system to filter out archived Healthie patients, ensuring only active patients appear when attributing faxes.

---

### February 13, 2026: Scribe Session Persistence Fix

**Problem**: Scribe sessions were not being marked as ‘SUBMITTED’ after being sent to Healthie.

**Root Cause**: Two bugs in the `confirm_final_send` handler in `telegram-ai-bot-v2.ts`:
1. Invalid `filler_id` field in `createFormAnswerGroupInput` mutation
2. Premature `continue` statement on error, skipping the status update

**Fix**: Removed invalid field and fixed control flow so sessions are properly finalized.

---

### February 10-11, 2026: Scribe Patient Matching Safety

**Problem**: AI Scribe was auto-selecting incorrectly matched patients (e.g., Lauren Vanegas for Vaughn Larsen) because the `requires_manual_verification` flag was being ignored.

**Fix**:
1. `buildSessionKeyboard` no longer shows "Confirm & Send" if `requires_manual_verification` is true and patient hasn’t been manually assigned
2. `confirm_final_send` handler blocks upload to unverified patients

---

### February 2, 2026: Lab Approvals with Patient Verification

**Problem**: Low-confidence patient matches could result in lab results being assigned to the wrong patient.

**Fix**: Added a patient verification modal for low-confidence matches. Upon lab approval, system confirms patient details (name and DOB) and provides a manual selection option when confidence is below threshold.

**Comprehensive audit and 15-fix hardening of the controlled substance inventory, dispensing, and DEA compliance system.**

### February 18, 2026: Dispense Amount Bug Fixes (Split-Vial & Staged Doses)

**Three fixes for inflated dispense amounts and incorrect totals in the Transactions page.**

| # | Fix | File(s) |
|---|-----|---------|
| 1 | Split-vial handler now caps `doseCurrent` to actual vial remaining when vial has less than one dose+waste cycle | `app/inventory/TransactionForm.tsx` |
| 2 | Staged dose `use` API computes `totalDispensed = dose_ml × syringe_count` instead of using `total_ml` (which included waste) | `app/api/staged-doses/use/route.ts` |
| 3 | TransactionsTable "Total Volume" column now shows `total_amount` instead of duplicating `total_dispensed_ml` | `app/transactions/TransactionsTable.tsx` |


#### What Changed (Code — deployed)

| # | Fix | File(s) |
|---|-----|---------|
| 1 | `deleteDispense()` now caps restored volume at `size_ml` to prevent overfill | `lib/inventoryQueries.ts` |
| 2 | `createDispense()` uses `FOR UPDATE` on vial row to prevent race conditions | `lib/inventoryQueries.ts` |
| 3 | Stale staged doses (past `staged_for_date`) show amber ⚠️ STALE warning | `app/inventory/StagedDosesManager.tsx` |
| 4 | DEA export CSV route created — was previously 404 | `app/api/export/dea/route.ts` (NEW) |
| 5 | Zombie vials cleanup migration (Active but 0 remaining → Empty) | `migrations/20250211_cleanup_zombie_vials.sql` |
| 6 | `deleteDispense()` now records audit trail via `recordDispenseEvent()` | `lib/inventoryQueries.ts` |
| 7 | DB pool increased from 10→20 with idle/connection timeouts | `lib/db.ts` |
| 8 | DEA view optimization (deferred — view unchanged) | — |
| 9 | Patient name fallback requires unique match, no more `LIMIT 1` | `lib/inventoryQueries.ts` |
| 10 | Removed debug payment method display | `app/inventory/TransactionForm.tsx` |
| 11 | Expired vial warning on dispense form | `app/inventory/TransactionForm.tsx` |
| 12 | Provider signature queue limited to 200 rows | `lib/inventoryQueries.ts` |
| 13 | Morning check link uses `withBasePath()` | `app/inventory/TransactionForm.tsx` |
| 14 | `total_amount` column precision fix (12,2 → 12,3) | `migrations/20250211_fix_total_amount_precision.sql` |
| 15 | `WASTE_PER_SYRINGE` centralized in `lib/testosterone.ts` | `lib/testosterone.ts` |

#### Pending DB Migrations (run when connections free up)
```sql
-- 1. Fix total_amount precision (requires view drop/recreate)
-- See: migrations/20250211_fix_total_amount_precision.sql

-- 2. Clean up zombie vials
-- See: migrations/20250211_cleanup_zombie_vials.sql
```

---

### March 31, 2026 - iPad Appointment Type Dropdown Grouping

**Change**: Updated `/api/ipad/schedule` endpoint to group appointment types by clinic/brand in the dropdown.

**Details**: The appointment type dropdown on the iPad now groups appointments by clinic:
- **NowMensHealth.Care**: Male hormone, TRT, men's health appointments
- **NowPrimary.Care**: Primary care, sick visits, physicals, female hormone
- **NowLongevity.Care**: Pelleting, weight loss, IV therapy, peptides
- **NowMentalHealth.Care**: Mental health, therapy, psychiatric, ketamine
- **ABXTAC**: ABX TAC peptide consultations
- **General**: Any unmatched appointment types

**Files Modified**:
- `/home/ec2-user/gmhdashboard/app/api/ipad/schedule/route.ts` - Added `getClinicGroup()` function and `grouped_appointment_types` response field

**API Response**: Now includes both flat array (backwards compatible) and grouped structure:
```json
{
  "appointment_types": [...],  // Flat array with clinic_group field
  "grouped_appointment_types": [
    {
      "group_name": "NowMensHealth.Care",
      "appointment_types": [...]
    },
    ...
  ]
}
```

---

### Testosterone Inventory & Controlled Substance System

**The inventory system tracks testosterone vials, dispenses, staged (prefilled) doses, DEA compliance records, and controlled substance checks.**

#### Database Tables

| Table | Purpose |
|-------|---------|
| `vials` | Testosterone inventory vials with lot numbers, expiration dates, remaining volume |
| `dispenses` | Individual dispense records (dose, waste, syringe count, signature status) |
| `dea_transactions` | DEA compliance records (drug name, schedule, quantity, patient info preserved) |
| `staged_doses` | Prefilled syringes staged for upcoming patient visits |
| `controlled_substance_checks` | Morning/EOD inventory counts and discrepancy tracking |
| `dispense_history` | Audit trail for create/sign/reopen/delete events |

#### SQL Views

| View | Purpose |
|------|---------|
| `dea_dispense_log_v` | Joins dispenses + dea_transactions + patients + vials for DEA reporting |
| `provider_signature_queue_v` | Unsigned dispenses awaiting provider signature |

#### Key Files

| File | Purpose |
|------|---------|
| `lib/inventoryQueries.ts` | All DB queries: `createDispense()`, `deleteDispense()`, `signDispense()`, `reopenDispense()`, `fetchInventory()`, `fetchTransactions()` |
| `lib/deaQueries.ts` | `fetchRecentDeaLog()` with optional date range filtering |
| `lib/testosterone.ts` | Shared constants: vendor names, DEA codes, `WASTE_PER_SYRINGE` |
| `lib/exporters.ts` | `exportDeaLogToS3()` for S3 export |
| `app/api/export/dea/route.ts` | GET endpoint for CSV download of DEA log |
| `app/inventory/TransactionForm.tsx` | Dispense form with patient search, split-vial logic, QBO payment gating |
| `app/inventory/StagedDosesManager.tsx` | Prefilled dose management with stale warnings |
| `app/dea/page.tsx` | DEA log page with date filtering and CSV export |
| `app/provider/signatures/page.tsx` | Provider signature queue |

#### Business Rules

- **Waste**: Fixed 0.1 mL per syringe (`WASTE_PER_SYRINGE` in `lib/testosterone.ts`)
- **Vendors**: Carrie Boyd (30 mL pre-filled syringes, Miglyol oil) and TopRx (10 mL vials, cottonseed oil)
- **Morning Check**: Required before dispensing; enforced in TransactionForm UI
- **Signature Flow**: Dispenses start as `awaiting_signature` → provider signs → `signed`; can be reopened
- **Split-Vial**: When a dose exceeds remaining vial volume, TransactionForm splits across two vials
- **DEA Records**: Preserved even after patient deletion (patient info denormalized into `dea_transactions`)
- **QBO Payment**: Patients with Quickbooks payment method require override approval before dispensing

### January 27, 2026: Fax Processing System (COMPLETE)

**Incoming fax automation with GMH Dashboard approval workflow**

#### Architecture
1. **AWS SES** receives emails at `fax@nowprimary.care`
2. **S3 bucket** `gmh-incoming-faxes-east1` stores raw emails
3. **fax-processor** PM2 service extracts PDFs, summarizes with Gemini AI
4. **Google Chat** receives smart-routed alerts (Clinical, Billing, etc.)
5. **GMH Dashboard** `/faxes` page for review and Healthie upload

#### Database Table
```sql
fax_queue - Incoming faxes with AI analysis and approval workflow
  - ai_summary, ai_fax_type, ai_patient_name, ai_urgency
  - healthie_patient_id, status, approved_at, healthie_document_id
```

#### Files
| File | Purpose |
|:-----|:--------|
| `scripts/email-triage/fax_s3_processor.py` | Monitors S3, extracts PDF, summarizes, posts to Chat |
| `app/faxes/page.tsx` | Fax review page (server component) |
| `app/faxes/FaxesDashboardClient.tsx` | Approval UI with patient search |
| `app/api/faxes/queue/route.ts` | API for approve/reject + Healthie upload |
| `app/api/faxes/pdf/[id]/route.ts` | Presigned PDF URLs |
| `app/api/faxes/patients/route.ts` | Search-as-you-type patient lookup from Snowflake |

#### Navigation
**Top-level link**: `Faxes` (after Labs)

#### DNS Required for nowprimary.care
| Type | Host | Value |
|------|------|-------|
| MX | fax | 10 inbound-smtp.us-east-1.amazonaws.com |
| TXT | fax | v=spf1 include:amazonses.com ~all |

> [!IMPORTANT]
> **S3 Bucket Regions for Fax System:**
> - `gmh-incoming-faxes-east1` (raw emails) → **us-east-1**
> - `gmh-clinical-data-lake` (processed PDFs) → **us-east-2**
> 
> The fax queue API (`app/api/faxes/queue/route.ts`) must use **us-east-2** for the S3 client when downloading PDFs for Healthie upload. Using the wrong region causes "Failed to download PDF" errors.

---

### February 2, 2026: Fax Upload to Healthie Fix

**Problem**: When approving faxes and uploading to patient charts, users received "Failed to download PDF" error.

**Root Cause**: The S3 client in `app/api/faxes/queue/route.ts` was configured for `us-east-1`, but the PDF bucket (`gmh-clinical-data-lake`) is in `us-east-2`.

**Fix Applied**:
```typescript
// BEFORE (broken):
const s3Client = new S3Client({ region: 'us-east-1' });

// AFTER (fixed):
const s3Client = new S3Client({ region: 'us-east-2' }); // Clinical bucket is in us-east-2
```

---

### March 4, 2026: Fax PDF Viewing Fix — Double-Encoding Bug

**Problem**: Clicking "View PDF" for faxes with special characters in filenames (e.g., `(855)_916-1953`) produced S3 `NoSuchKey` error. Parentheses were double-encoded: `(` → `%28` → `%2528`.

**Root Cause**: `NextResponse.redirect(presignedUrl)` in `app/api/faxes/pdf/[id]/route.ts` double-encoded special characters in the presigned URL path.

**Fix Applied** (3 files):
1. **`app/api/faxes/pdf/[id]/route.ts`**: Changed from `NextResponse.redirect(presignedUrl)` to `NextResponse.json({ url: presignedUrl })` — returns JSON instead of redirect
2. **`app/faxes/FaxesDashboardClient.tsx`**: Changed `<a href>` to `<button onClick>` that fetches the JSON URL and opens it via `window.open()`
3. **`scripts/email-triage/fax_s3_processor.py`**: Added `urllib.parse.unquote()` when extracting S3 key from presigned URL before storing in DB (preventive fix for future faxes)

### January 27, 2026: Peptide Inventory System (COMPLETE)

**Peptide inventory tracking with Healthie integration**

#### Database Schema
| Table | Purpose | Records |
|:------|:--------|:-------:|
| `peptide_products` | 28 peptides with Healthie IDs | 28 |
| `peptide_orders` | Incoming shipments (PO numbers) | 105 |
| `peptide_dispenses` | Patient dispensing log | 367 |

#### Healthie Product IDs (29082-29109)
All 28 peptides are linked to Healthie products. Key examples:
- BPC-157 (10mg): `29084`
- Retatrutide (12 mg): `29095`
- Retatrutide (24 mg): `29096`

#### Inventory Math (Matches Excel)
```
Current Stock = Total Ordered - Total Dispensed
Dispensed counts only WHERE: status='Paid' AND education_complete=true
Re-Order Alert = IF(Stock <= reorder_point, 'Reorder', 'OK')
```

#### Dispense Workflow
1. **Patient purchases peptide via Healthie** → Webhook creates "Pending" dispense
2. **Inventory NOT deducted** (Pending dispenses don't count)
3. **Patient picks up** → Staff marks Paid + Education Complete
4. **Inventory deducted** → Stock decremented

#### Files
| File | Purpose |
|:-----|:--------|
| `lib/peptideQueries.ts` | Query functions with Excel formula logic |
| `app/peptides/page.tsx` | Main inventory page |
| `app/peptides/DispenseForm.tsx` | Dispense peptide to patient |
| `app/peptides/DispenseHistory.tsx` | Patient dispense log (inline editing) |
| `app/peptides/InStockList.tsx` | In-stock reference |
| `app/api/peptides/dispenses/route.ts` | Dispense CRUD API |

#### Navigation
**Top-level link**: `Peptides` (between Patients and Dispensing)

**Peptide Types**: AOD 9604, BPC-157, CJC 1295, Gonadorelin, HCG, PT 141, Retatrutide, Semax, Semorelin, TB500, Tesamorelin, various blends

---

### January 26, 2026: Jane EMR Products Imported to Healthie

**Product Import Complete**

Successfully imported **242 products** from Jane EMR CSV to Healthie.

| Metric | Value |
|:-------|:------|
| Products Imported | 242 |
| Healthie Product IDs | 29079-29320 |
| Failures | 0 |
| Rate Limit Issues | None |

**Script**: `scripts/import-products-to-healthie.ts`
- Uses 500ms delay between API calls
- Batch pause every 10 products
- All products set to `unlimited_quantity: true`
- Tax descriptions preserved for taxable items

**Product Categories**: Peptides, Tri-Mix, Skincare (Alastin, ZO, Anteage), Injectables (Botox, Juvederm, Restylane), Supplements, Medical services


---

### January 28, 2026 (PM): Snowflake Authentication Fix & Monitoring Overhaul

**Problem**: Fax patient search and other Snowflake-dependent features were silently failing due to MFA enforcement on `tinetio123` account.

**Root Cause**: On Jan 13, `JARVIS_SERVICE_ACCOUNT` was created with key-pair auth, but the fax patient search API (`/api/faxes/patients`) was never updated - it still used the old password-based auth.

**Why Monitoring Didn't Catch It**: CEO dashboard system health only checked cache file age, NOT actual Snowflake connectivity.

**Fixes Applied**:

| Fix | File | Change |
|-----|------|--------|
| Shared Snowflake client | `lib/snowflakeClient.ts` [NEW] | Key-pair auth using `JARVIS_SERVICE_ACCOUNT` |
| Fax patient search | `app/api/faxes/patients/route.ts` | Now uses shared client instead of password auth |
| Pharmacy patient search | `app/api/pharmacy/patients/route.ts` [NEW] | Uses Healthie GraphQL directly (fallback) |
| System health | `app/api/analytics/system-health/route.ts` | Added real Snowflake connectivity test |

**Snowflake Service Account Configuration**:
```
Account: KXWWLYZ-DZ83651
User: JARVIS_SERVICE_ACCOUNT
Auth: Key-pair (JWT)
Private Key: /home/ec2-user/.snowflake/rsa_key_new.p8
Role: JARVIS_BOT_ROLE
```

**Environment Variables** (add to `.env.local`):
```bash
SNOWFLAKE_SERVICE_USER=JARVIS_SERVICE_ACCOUNT
SNOWFLAKE_PRIVATE_KEY_PATH=/home/ec2-user/.snowflake/rsa_key_new.p8
```

> [!IMPORTANT]
> **For ALL new Snowflake integrations**: Use `lib/snowflakeClient.ts` with `executeSnowflakeQuery()`. DO NOT use password-based auth with `tinetio123` - it will fail due to MFA.

---

### January 28, 2026: Healthie Webhook 308 Redirect Fix + Scheduled Payment Handling

**Root Cause Found for Silent Payment Failure Handling**

**Problem 1: Webhooks Not Received**: All webhook requests returning HTTP 308 (Permanent Redirect). Next.js `trailingSlash: true` redirects `/webhook` → `/webhook/`, losing POST body.

**Fix Applied** (January 2026 - rewrite):
```nginx
location = /ops/api/healthie/webhook {
    rewrite ^(.*)$ $1/ last;
}
```

⚠️ **CRITICAL UPDATE - February 1, 2026**: The rewrite approach was still causing 502 errors. When Healthie sends webhooks, the rewrite results in Next.js returning 308, which Healthie follows but loses the POST body. 

**CORRECT Fix** (direct proxy_pass with trailing slash in URI):
```nginx
location = /ops/api/healthie/webhook {
    proxy_pass http://127.0.0.1:3011/ops/api/healthie/webhook/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Content-Type $content_type;
    proxy_set_header Content-Length $content_length;
}
```

**Problem 2: Scheduled Payment Events Ignored**: Kory Johnson's failure was a SCHEDULED PAYMENT (recurring subscription), which uses `scheduled_payment.*` events. Handler only processed `requested_payment.*` and `billing_item.*`.

**Fix Applied** (process-healthie-webhooks.ts):
- Added handler for `scheduled_payment.*`, `subscription`, and `recurring` events
- Matches patients by `healthie_client_id` OR `full_name`
- Triggers: Telegram alert, Google Spaces alert, SMS, status update to Hold

**Problem 3: .join() Error** (fixed Feb 1, 2026): `changed_fields` from Healthie is sometimes a string, not an array. Fixed with `Array.isArray()` check.

**Problem 4: No Failsafe for Dashboard Downtime** (fixed Feb 1, 2026): When dashboard is down, webhooks aren't received, and payment failures go undetected.

**Fix Applied** (Startup Payment Sync):
- `scripts/heartbeat-writer.ts` - Writes heartbeat every 5 min via cron
- `scripts/startup-payment-sync.ts` - Checks last heartbeat on startup
- `scripts/start-dashboard.sh` - PM2 wrapper that runs sync before starting
- If dashboard was down >1 hour, automatically runs payment sync + Telegram alert
- **Syncs last 7 days of data** to catch any missed failures during downtime

**What Gets Synced** (on extended downtime):
1. **requestedPayments** - One-time invoices with failed status
2. **billingItems(status: "failed")** - ALL recurring/subscription payment failures

| Component | File | Function |
|-----------|------|----------|
| Heartbeat Writer | `scripts/heartbeat-writer.ts` | Records uptime to `.heartbeat` |
| Startup Sync | `scripts/startup-payment-sync.ts` | Runs sync on extended downtime |
| PM2 Wrapper | `scripts/start-dashboard.sh` | Calls startup sync before `npm start` |

**Query for Failed Recurring Payments**:
```graphql
# IMPORTANT: billingItems uses "sender" for PATIENT (who pays), "recipient" for PROVIDER (who receives)
# This is REVERSED from requestedPayments where "recipient" = PATIENT
billingItems(status: "failed") {
  id state failure_reason stripe_error amount_paid
  is_recurring sender { id full_name email } created_at
}
```

**Cron Job**: `*/5 * * * * cd /home/ec2-user/gmhdashboard && npx tsx scripts/heartbeat-writer.ts`


**CEO Dashboard Enhancement**:
- Added `checkWebhookHealth()` to system-health API
- Alerts when no webhooks received in 24h+
- Displays webhook status card with pending/processed counts


---

### January 26, 2026: Healthie Webhook Fix, Lab Status Refresh & Payment Processing

**Healthie Webhook Integration - FIXED**

**Problems Found**:
1. Base64 padding in content-digest was being stripped (trailing `=`)
2. Signature verification used internal path (`/api/healthie/webhook/`) but Healthie signs with external path (`/ops/api/healthie/webhook/`)
3. `HEALTHIE_WEBHOOK_SECRET` wasn't in `.env.local`

**Fixes Applied**:
| Fix | File | Change |
|-----|------|--------|
| Base64 padding | `app/api/healthie/webhook/route.ts` | Changed `split('=')[1]` to `slice(1).join('=')` |
| Path prefix | `app/api/healthie/webhook/route.ts` | Added `/ops` base path to signature verification |
| Env var | `.env.local` | Added `HEALTHIE_WEBHOOK_SECRET` |

**Webhook URL**: `https://nowoptimal.com/ops/api/healthie/webhook/`
**Secret**: (see `.env.local` — `HEALTHIE_WEBHOOK_SECRET`)

---

**Lab Status Refresh System - NEW**

**Problem**: Lab status was stored as static text (e.g., "Due in 30 days") that was never recalculated, causing 46 patients to show stale data.

**Solution**: Created `scripts/refresh-lab-status.ts` that:
- Recalculates all `lab_status` values based on `next_lab_date` vs current date
- Sets "Overdue by X days", "Due in X days", or "Current (due in X days)"
- Runs daily via cron at 10pm MST (5am UTC)

**Script**: `npx tsx scripts/refresh-lab-status.ts`

---

**Unpaid Payments Processing - NEW**

**Script Created**: `scripts/process-unpaid-payments.ts`
- Queries Healthie for all payments with `status_filter: "not_yet_paid"`
- Matches with dashboard patients via `healthie_clients` table
- Updates matching patients to "Hold - Payment Research" status
- Adds timestamped note for audit trail

**Initial Run**: Updated 15 patients with outstanding Healthie payments.

---

**Patient ID Mapping Architecture** (corrected Feb 1, 2026):

| Table | Purpose | Status |
|-------|---------|--------|
| `healthie_clients` | **CANONICAL** - Links patient_id ↔ healthie_client_id | 326 linked (99%) |
| `patients.healthie_client_id` | **LEGACY** - Not actively used, migrated to healthie_clients | 16 records |

**Duplicate Prevention** (updated Feb 2, 2026):
- Patient creation API checks Healthie + GMH before creating
- **Searches by**: Email → Phone → Name (in order, all three checked)
- Returns HTTP 409 with `duplicateWarnings` if potential match found
- Use `forceCreate: true` to bypass (will auto-link to existing Healthie patient)
- **Email field added to Add Patient form** for better Healthie matching
- Implemented in: `app/api/patients/route.ts`, `lib/patientHealthieSync.ts`

> [!CAUTION]
> **Previous Bug (Feb 2, 2026)**: Name-based search was only used as "last resort" when email/phone failed.
> **Fix**: Now searches by name alongside email/phone, not just as fallback. Also searches by name 
> inside `findHealthiePatient()` before creating new Healthie patients.

---

**Cron Jobs (Updated Feb 19, 2026)**:

> [!NOTE]
> All jobs are wrapped in `cron-alert.sh` which sends a Telegram alert on failure.

```cron
# Heartbeat writer - Every 5 minutes
*/5 * * * * /home/ec2-user/scripts/cron-alert.sh "Heartbeat" "cd /home/ec2-user/gmhdashboard && npx tsx scripts/heartbeat-writer.ts"

# Morning Telegram Report - 7am MST (2pm UTC)
0 14 * * * /home/ec2-user/scripts/cron-alert.sh "Morning Report" "cd /home/ec2-user/gmhdashboard && npx tsx scripts/morning-telegram-report.ts"

# Infrastructure Monitoring - 9am MST (4pm UTC)
0 16 * * * /home/ec2-user/scripts/cron-alert.sh "Infrastructure Monitor" "/usr/bin/python3 /home/ec2-user/scripts/unified_monitor.py"

# === UNIFIED SNOWFLAKE SYNC (Python - replaces 4 broken Node.js scripts) ===
# Syncs: patients, invoices, payment_issues, dispenses, vials, memberships, qb_payments, prescriptions
# Runs every 4 hours - takes ~36 seconds
0 */4 * * * /home/ec2-user/scripts/cron-alert.sh "Snowflake Sync" "python3 -u /home/ec2-user/scripts/sync-all-to-snowflake.py"

# QuickBooks Sync - Every 3 hours
0 */3 * * * /home/ec2-user/scripts/cron-alert.sh "QuickBooks Sync" "/home/ec2-user/quickbooks-sync.sh"

# Healthie Revenue Cache - Every 6 hours at :40
40 */6 * * * /home/ec2-user/scripts/cron-alert.sh "Healthie Revenue Cache" "python3 /home/ec2-user/scripts/cache-healthie-revenue.py"

# Healthie Failed Payments Sync - Every 6 hours
0 */6 * * * /home/ec2-user/scripts/cron-alert.sh "Healthie Failed Payments" "cd /home/ec2-user/gmhdashboard && npx tsx scripts/sync-healthie-failed-payments.ts"

# Process Healthie Webhooks (payment failures) - Every 5 minutes
*/5 * * * * /home/ec2-user/scripts/cron-alert.sh "Process Healthie Webhooks" "cd /home/ec2-user/gmhdashboard && npx tsx scripts/process-healthie-webhooks.ts"

# Access Labs Auto-upload - Every 30 minutes
*/30 * * * * /home/ec2-user/scripts/cron-alert.sh "Lab Results Fetch" "cd /home/ec2-user/scripts/labs && python3 fetch_results.py --auto-upload"

# Refresh Lab Status - Daily at 10pm MST (5am UTC)
0 5 * * * /home/ec2-user/scripts/cron-alert.sh "Lab Status Refresh" "cd /home/ec2-user/gmhdashboard && npx tsx scripts/refresh-lab-status.ts"

# Peptide Purchases Sync - Every 6 hours at :50
50 */6 * * * /home/ec2-user/scripts/cron-alert.sh "Peptide Sync" "cd /home/ec2-user/gmhdashboard && npx tsx scripts/sync-peptide-purchases.ts"

# Website Monitor - Every 5 minutes
*/5 * * * * /home/ec2-user/scripts/website-monitor.sh >> /home/ec2-user/logs/website-monitor.log 2>&1

# Kill stale interactive terminal sessions - Every hour
0 * * * * /home/ec2-user/scripts/kill-stale-terminals.sh

# Snowflake Data Freshness Check - Every 2 hours at :10 (ALERTS when stale)
10 */2 * * * /home/ec2-user/scripts/cron-alert.sh "Snowflake Freshness" "python3 /home/ec2-user/scripts/snowflake-freshness-check.py"
```

---

### January 14, 2026 (Evening): Telegram Alert System Restoration

**Problem**: Infrastructure monitoring alerts (Costs, Uptime, Server Load) were not being sent to Telegram. The system was experiencing "silent failures" for 17+ days.

**Root Causes Identified**:
1. **No cron job** for `unified_monitor.py` (last run: Dec 28, 2025!)
2. **Snowflake MFA requirement** blocking password-based auth in monitoring scripts
3. **AWS billing API error** (GroupBy `Type: 'SERVICE'` should be `Type: 'DIMENSION'`)
4. **Duplicate errored PM2 processes** (IDs 25, 26 in errored state)

**Fixes Applied**:
| Fix | File | Change |
|-----|------|--------|
| Cron job added | `crontab` | `0 16 * * *` (9AM MST) runs `unified_monitor.py` |
| Snowflake auth | `scripts/telegram_monitor.py` | Switched to `JARVIS_SERVICE_ACCOUNT` with key-pair auth |
| AWS billing | `scripts/aws_monitor.py` | Changed `GroupBy Type` from `SERVICE` to `DIMENSION` |
| PM2 cleanup | PM2 | Deleted errored processes 25, 26; reset restart counts |

**Verification**: Ran `unified_monitor.py` manually - all checks passed, 3 Telegram alerts sent successfully.

---

### January 14, 2026 (PM): QuickBooks Dispense Restriction & Override System

**Purpose**: Block dispensing to QuickBooks patients (who need to migrate to Healthie billing) while allowing emergency overrides with billing notification.

**New Features**:
1. **Dispense Restriction**:
   - Patients with "QuickBooks" payment method show red warning on Transactions page
   - Dispense is blocked until migrated to Healthie EMR or override is used

2. **Last Payment Display**:
   - Shows most recent QBO sales receipt date and amount
   - Data from `quickbooks_sales_receipts` table (recurring payments)

3. **Override System**:
   - Staff can click "Request Override" with required reason
   - Sends notification to Billing team via Google Chat (`GOOGLE_CHAT_WEBHOOK_OPS_BILLING`)
   - Allows dispense to proceed after override

**Files Created/Modified**:
| File | Purpose |
|------|---------|
| `/app/api/patients/[id]/qbo-last-payment/route.ts` | [NEW] Fetch last sales receipt |
| `/app/api/dispense-override/route.ts` | [NEW] Send override notification |
| `/app/inventory/TransactionForm.tsx` | [MODIFIED] Override UI & logic |
| `/lib/patientQueries.ts` | [MODIFIED] Added `method_of_payment` to PatientOption |

**Staff SOP**: `docs/SOP-QuickBooks-Override.md`

**Database Tables Used**:
- `quickbooks_sales_receipts` - Recurring payment history (2,221 rows)
- `patient_data_entry_v` - Patient method of payment

---

### January 14, 2026: Proactive AI Scribe & Automation (Deep Dive Fix)

**Purpose**: Ensure Care Plans, Discharge Instructions, and Work/School notes are generated **proactively** or via simple prompts, rather than requiring manual creation.

**New Capabilities Enabled**:
1.  **Automated Care Plans**:
    - **Trigger**: Happens immediately after audio processing.
    - **Process**: Jarvis extracts goals/interventions -> Proposal shown in Telegram -> **Auto-created in Healthie upon approval**.
    - **No extra clicks**: If you approve the note, you approve the Care Plan.

2.  **Proactive Discharge Instructions**:
    - **Trigger**: Happens in background during note approval.
    - **Process**: Jarvis generates the PDF -> Prompts via Telegram: *"Discharge Instructions ready. Send to Portal? (Yes/Edit)"*.
    - **Improvement**: Removes the "Do you want to generate?" step. Now it's just "Review & Send".

3.  **School/Work Notes**:
    - **Process**: If audio mentions "excuse note" or "work", Jarvis auto-detects -> Prompts via Telegram.
    - **Manual Trigger**: You can also ask Jarvis in the Telegram thread: *"Generate school note for [Patient]"*.

**Debugging Checklist (If "Missing Note"):**
1.  **Check Telegram**: Did you receive the "Review Scribe Note" message?
2.  **Check Process**: `pm2 list` (ensure `upload-receiver` is online).
3.  **Check Logs**: `/home/ec2-user/.pm2/logs/upload-receiver-out.log`.

---

### January 13, 2026 (PM): Jarvis Gemini Migration & Snowflake Auth Overhaul

**Jarvis Telegram Bot - Migrated to Google Gemini**
- **Old**: AWS Bedrock Claude 3 Haiku
- **New**: Google Gemini 2.5 Flash via REST API (upgraded from 2.0 Flash on April 6, 2026 — Google deprecated 2.0)
- **Why**: Cost savings, align with Vertex AI strategy
- **File**: `/home/ec2-user/gmhdashboard/scripts/telegram-ai-bot-v2.ts`
- **Change**: Added `callGemini()` helper, replaced 3 `InvokeModelCommand` calls

**Snowflake Authentication - Service Account Setup**
- **Old User**: `tinetio123` (blocked by MFA)
- **New User**: `JARVIS_SERVICE_ACCOUNT` (TYPE=SERVICE, key-pair auth)
- **Private Key**: `/home/ec2-user/.snowflake/rsa_key_new.p8`
- **Role**: `JARVIS_BOT_ROLE` with grants on `PATIENT_DATA` and `FINANCIAL_DATA` schemas
- **Sync Scripts Updated**:
  - `sync-healthie-billing-items.ts` - Now uses key-pair auth
  - `sync-healthie-invoices.ts` - Now uses key-pair auth

**Schema Name Fix**
- **Problem**: AI hallucinating `GMHCLINIC` instead of `GMH_CLINIC`
- **Solution**: Post-processing code fixes schema names after AI generates SQL
- **Lines 1060-1064** in telegram-ai-bot-v2.ts

**Cron Jobs Installed**
```cron
# Healthie Billing Items - Every 6 hours at :30
30 */6 * * * cd /home/ec2-user/gmhdashboard && HEALTHIE_API_KEY=... /usr/bin/npx tsx scripts/sync-healthie-billing-items.ts

# Healthie Invoices - Every 6 hours at :15
15 */6 * * * cd /home/ec2-user/gmhdashboard && HEALTHIE_API_KEY=... /usr/bin/npx tsx scripts/sync-healthie-invoices.ts
```

**⚠️ Snowflake Sync Status (Updated Feb 2026)**
All tables now synced by unified Python script `sync-all-to-snowflake.py` every 4 hours.

| Table | Source | Sync Status |
|-------|--------|-------------|
| PATIENTS | Postgres | ✅ Running (every 4h) |
| VIALS | Postgres | ✅ Running (every 4h) |
| DISPENSES | Postgres | ✅ Running (every 4h) |
| HEALTHIE_BILLING_ITEMS | Postgres | ✅ Running (every 4h) |
| HEALTHIE_INVOICES | Postgres | ✅ Running (every 4h) |
| QB_PAYMENTS | Postgres | ✅ Running (every 4h) |
| MEMBERSHIPS | Postgres | ✅ Running (every 4h) |
| PRESCRIPTIONS | Postgres | ✅ Running (every 4h) |

**Files Updated (Jan 13)**:
- `scripts/telegram-ai-bot-v2.ts` - Gemini migration + schema fix
- `scripts/sync-healthie-billing-items.ts` - Key-pair auth
- `scripts/sync-healthie-invoices.ts` - Key-pair auth

---
