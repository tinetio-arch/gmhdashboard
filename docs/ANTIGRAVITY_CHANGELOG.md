# GMH Dashboard — Changelog Archive

**Purpose**: Complete historical record of all incidents, bug fixes, and system changes from December 2025 - March 2026.

**Active Documentation**: See [ANTIGRAVITY_SOURCE_OF_TRUTH.md](../ANTIGRAVITY_SOURCE_OF_TRUTH.md) for current system state.

**Organization**: Chronological from newest to oldest.

---

## TABLE OF CONTENTS

| Date | Incident | Type | Impact |
|------|----------|------|--------|
| Mar 12, 2026 | [PM2 Version Mismatch & IPv6](#2026-03-12-pm2-mismatch) | Infrastructure | High |
| Mar 7, 2026 | [IPv6 Root Cause Fix](#2026-03-07-ipv6-fix) | Infrastructure | Critical |
| Mar 5, 2026 | [Dispensing Data Integrity](#2026-03-05-dispensing-integrity) | Data Corruption | Critical |
| Mar 4, 2026 | [Patient Matching 3-Tier](#2026-03-04-patient-matching) | Feature | Medium |
| Mar 4, 2026 | [Fax PDF Encoding Bug](#2026-03-04-fax-encoding) | Bug Fix | Low |
| Mar 2, 2026 | [Node v22 Upgrade](#2026-03-02-node-upgrade) | Infrastructure | Medium |
| Feb 26, 2026 | [SQL Injection in DEA MCP](#2026-02-26-sql-injection) | Security | Critical |
| Feb 24-25, 2026 | [DEA Improvements & Vial Deletion](#2026-02-24-dea-improvements) | Feature | Medium |
| Feb 23, 2026 | [Supply PAR System](#2026-02-23-supply-par) | Feature | Low |
| Feb 20, 2026 | [Inventory 15-Fix Audit](#2026-02-20-inventory-audit) | Bug Fix | High |
| Feb 2, 2026 | [Fax S3 Region Fix](#2026-02-02-fax-s3) | Bug Fix | Medium |
| Feb 1, 2026 | [Healthie Webhook 308](#2026-02-01-webhook-308) | Bug Fix | Critical |
| Jan 28, 2026 | [Snowflake MFA Auth](#2026-01-28-snowflake-auth) | Infrastructure | High |
| Jan 27, 2026 | [Fax Processing System](#2026-01-27-fax-system) | Feature | Medium |
| Jan 27, 2026 | [Peptide Inventory](#2026-01-27-peptide-system) | Feature | Low |
| Jan 26, 2026 | [Jane EMR Products Import](#2026-01-26-jane-import) | Feature | Low |
| Dec 25-30, 2025 | [Foundation Features](#2025-12-foundation) | Multiple | High |

---


> [!WARNING]
> **AFTER PM2 UPDATES / `pm2 update` / SYSTEM REBOOT — USE THIS PROCEDURE:**
>
> PM2 updates can lose process env vars (like PORT). If services restart without their PORT env var, Next.js defaults to **port 3000**, causing 502 errors and EADDRINUSE cascading failures.
>
> **Correct restart procedure:**
> ```bash
> # 1. Stop all services
> pm2 stop all
>
> # 2. Delete all processes (clears stale state)
> pm2 delete all
>
> # 3. Start ALL services from ecosystem config (restores PORT env vars)
> pm2 start /home/ec2-user/ecosystem.config.js
>
> # 4. Wait 10 seconds, verify all online
> sleep 10 && pm2 list
>
> # 5. Save the process list
> pm2 save
> ```
>
> **If a single service is down:**
> ```bash
> pm2 delete <service-name>
> pm2 start /home/ec2-user/ecosystem.config.js --only <service-name>
> pm2 save
> ```
>
> **NEVER** use `pm2 start npm -- start` directly — it won't have PORT or NODE_ENV set.

> [!CAUTION]
> **Port Conflict Incidents:**
> - **Jan 28, 2026**: `nowprimary-website` and `nowmenshealth-website` reached **34,000+ restarts** — ad-hoc start without restart limits, port conflicts caused infinite CPU meltdown.
> - **Mar 4, 2026**: After PM2 update, `gmh-dashboard` lost PORT=3011 env var → started on 3000 → **502 Bad Gateway**. `nowoptimal-website` also tried 3000 → EADDRINUSE. `jessica-mcp` failed because `psycopg2` wasn't installed for python3.11. **Fix**: delete ad-hoc processes, restart from ecosystem config.

---

## 🔥 RECENT MAJOR CHANGES (DEC 25, 2025 - MAR 7, 2026)

### March 12, 2026: 🔴 Server Stability Deep Fix — PM2 Mismatch, Crash Loop, Antigravity Anti-Hang

**Problem**: Server commands hanging, `uptime-monitor` crash-looping (398+ restarts), `system-health` API returning errors, CLI tools (psql, node scripts) hanging when connecting to RDS. User reported persistent hangs despite March 7 IPv6 fix.

**Root Cause Analysis** (5 issues found):

| Issue | Root Cause | Impact |
|-------|-----------|--------|
| **PM2 version mismatch** | In-memory PM2 (6.0.13) older than installed (6.0.14). `pm2 jlist` prepended a red warning to stdout. | `system-health` API parsed this as JSON → crash |
| **Uptime-monitor crash loop** | `uptime_monitor.py` calls `pm2 jlist` → got corrupted JSON → crashed → PM2 restarted it → infinite loop (398+ restarts) | Resource drain |
| **system-health route fragile** | Directly passed `pm2 jlist` output to `JSON.parse()` with no sanitization | Any PM2 warning = total API failure |
| **Missing CLI env vars** | `psql` and ad-hoc Node scripts lacked `PGHOST`, `PGPORT`, etc. → defaulted to `localhost:5432` | CLI DB commands hung |
| **NODE_OPTIONS duplication** | Exported multiple times in `~/.bashrc` from repeated shell sourcing | Minor, but cluttered env |

**Fix (5-part):**

| Fix | File | Change |
|-----|------|--------|
| PM2 updated | `pm2` in-memory | Ran `pm2 update` to sync in-memory (6.0.14) with installed version |
| system-health hardened | `app/api/analytics/system-health/route.ts` | Strip non-JSON prefix lines from `pm2 jlist` output before parsing; added 15s timeout |
| Env vars centralized | `~/.server_env` [NEW] | Single source for `NODE_OPTIONS`, `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSSLMODE`, `DATABASE_HOST/PORT/NAME/USER/SSLMODE`, curl/wget IPv4 aliases |
| `.bashrc` simplified | `~/.bashrc` | Replaced inline env vars with `source ~/.server_env` |
| Antigravity workflow | `~/.agents/workflows/server-commands.md` [NEW] | Enforces `source ~/.server_env && timeout <N> <cmd>` for all agent-run commands |

**Key Files Created:**

- **`~/.server_env`** — Central environment file sourced by `~/.bashrc` AND Antigravity workflows. Contains IPv4 enforcement for Node.js (`NODE_OPTIONS`), Python/curl/wget (`-4` flag), and PostgreSQL CLI vars.
- **`~/.agents/workflows/server-commands.md`** — Workflow that every Antigravity agent follows: source env, use timeout, prefer `view_file` over shell reads.

**Antigravity User Rule Added** (in Settings → Customizations):
```
CRITICAL SERVER RULE: This EC2 server has NO working IPv6. Any command that attempts IPv6 will hang forever.
1. ALWAYS source ~/.server_env before running any command
2. ALWAYS wrap commands with timeout
3. Follow the workflow at ~/.agents/workflows/server-commands.md
4. Prefer view_file over tail/cat for reading log files
5. Never run pm2 logs without --nostream flag
```

**Verification Results (from uptime-monitor logs at 11:26 MST):**

| Service | Status |
|---------|--------|
| GMH Dashboard | ✅ OK (restarts: 2 — from rebuild) |
| System Health API | ✅ OK |
| Webhook Health | ✅ 314 processed, 0 pending |
| upload-receiver | ✅ OK (restarts: 0) |
| telegram-ai-bot-v2 | ✅ OK (restarts: 0) |
| email-triage | ✅ OK (restarts: 0) |
| ghl-webhooks | ✅ OK (restarts: 0) |
| nowmenshealth-website | ✅ OK (restarts: 0) |
| QuickBooks token refresh | ✅ Working (DB queries succeeded) |
| Dashboard error log | ✅ Empty (cleared, no new PM2 errors) |

> [!IMPORTANT]
> The March 7 IPv6 fix IS working correctly. The hangs in this session were caused by PM2 version mismatch and missing CLI env vars, NOT IPv6 regression.

> [!TIP]
> If commands hang in Antigravity despite the workflow, the agent's terminal session may be corrupted from previous hung processes. The agent should use `view_file` for reading files and terminate stuck background commands.

---

### March 7, 2026: 🔴 IPv6 Root Cause Fix — Persistent Command Hanging


**Problem**: `node`, `npx`, `npm`, `psql`, and other outbound commands would hang for 30-120+ seconds or indefinitely. Previously misdiagnosed as a Node v20 race condition (Mar 2 fix). The Node upgrade helped that specific issue but the hanging persisted.

**Root Cause**: **Broken IPv6 connectivity.** IPv6 is enabled at the kernel level (`disable_ipv6 = 0`) but the EC2 instance has **no global IPv6 address** (only `fe80::` link-local) and **no IPv6 route**. DNS returns AAAA records (e.g., npm registry on Cloudflare). Tools try IPv6 first → connection hangs (kernel doesn't reject it, just waits) → eventually times out or hangs forever. Made worse by Node v22's `verbatim` DNS order (prefers IPv6 first).

**Fix (3-part):**

| Fix | File | Change |
|-----|------|--------|
| System-wide IPv4 preference | `/etc/gai.conf` [NEW] | `precedence ::ffff:0:0/96 100` — tells `getaddrinfo()` to sort IPv4 before IPv6 |
| Node.js defense-in-depth | `/home/ec2-user/ecosystem.config.js` | Added `NODE_OPTIONS: '--dns-result-order=ipv4first'` to all 7 Node.js services |
| Interactive shell fix | `~/.bashrc` | Added `export NODE_OPTIONS="--dns-result-order=ipv4first"` |

**Verification Results:**

| Test | Before | After |
|------|--------|-------|
| `node -e "console.log('OK')"` | Hang (30s+) | **0.01s** |
| `node HTTP fetch` | Hang (indefinite) | **0.03s** |
| `npm view express version` | Hang (30s+) | **0.15s** |
| `npx -y semver --version` | Hang (indefinite) | **0.15s** |

> [!CAUTION]
> **DO NOT enable global IPv6 on this VPC** unless you add a proper IPv6 CIDR block, update route tables, security groups, and assign a global IPv6 address to the instance. The current state (IPv6 kernel enabled, no connectivity) is the worst case — connections hang instead of being rejected.

> [!IMPORTANT]
> If the server is rebuilt or AMI-cloned, `/etc/gai.conf` must be recreated. The `ecosystem.config.js` and `.bashrc` changes will carry over with the home directory.

---

### March 5, 2026: 🔴 Critical Dispensing Data Integrity Fix

**Problem**: Morning testosterone counts off by 22mL. Transactions page showed "Total Volume" intermittently. Audit revealed **22 active vials with discrepancies** and **89 dispense records with NULL `total_amount`**.

**Root Causes (3 compounding issues):**

| # | Issue | Impact |
|---|-------|--------|
| 1 | **Silent scaling guard** (added Mar 4) | `inventoryQueries.ts` silently reduced `totalDispensedMl`/`wasteMl` when they exceeded vial remaining → records stored **less** than actually dispensed → vial showed **more** remaining than reality |
| 2 | **Split-vial bug** (Snyder incident Mar 3) | Inflated records (60mL from 30mL vial) created cascading discrepancies when deleted and re-entered |
| 3 | **NULL total_amount** | 89 dispense records had `total_amount = NULL`, causing intermittent display in Transactions table |

**Code Fixes:**

| Fix | File | Change |
|-----|------|--------|
| Silent guard → hard error | `lib/inventoryQueries.ts` L810-820 | Throws error instead of silently scaling. Forces split-vial flow. |
| Dose column display | `app/transactions/TransactionsTable.tsx` L141 | Shows `total_dispensed_ml` (actual dose) instead of `total_amount` |
| Split-vial budget cap | `app/inventory/TransactionForm.tsx` L399-408 | Already fixed Mar 4 — doseNext from remaining budget, not recalculated |

**Data Corrections (SQL):**

1. Backfilled 89 NULL `total_amount` records: `SET total_amount = dispensed + waste`
2. Recalculated ALL active vial `remaining_volume_ml` from actual dispense records
3. Marked depleted vials (remaining ≤ 0) as 'Empty'

> [!CAUTION]
> **NEVER silently modify dispense values in the backend.** If a dispense exceeds vial remaining, THROW AN ERROR — do not scale down. Silent modifications create inventory discrepancies that compound over time and are extremely hard to debug.

> [!IMPORTANT]  
> **Vial Integrity Rule**: `remaining_volume_ml` MUST always equal `size_ml - SUM(dispensed + waste)` for all dispenses against that vial. If these diverge, run the audit script: `bash /tmp/audit_vials.sh`

### March 5, 2026: System-Wide Arizona Timezone Fix

**Problem**: Dates displayed in UTC instead of Arizona time. Dispenses done late in the day (Mountain) could appear as the next day. All date formatters across the dashboard used `getUTCMonth()/getUTCDate()`.

**Fix**: Changed all date formatting to use `Intl.DateTimeFormat` with `timeZone: 'America/Phoenix'` (no DST, always UTC-7).

| File | Functions Fixed |
|------|----------------|
| `lib/dateUtils.ts` | `formatDateUTC`, `formatDateTimeUTC`, `formatDateLong` (shared utilities) |
| `app/transactions/TransactionsTable.tsx` | `formatDate` |
| `app/patients/PatientTable.tsx` | `formatDateInput`, `normalizeDateValue` |
| `app/components/QuickBooksCard.tsx` | `safeDateFormat` |

> [!CAUTION]
> **Date DISPLAY Rule**: ALL dates displayed to users MUST use `America/Phoenix` timezone via `Intl.DateTimeFormat`. The clinic is in Arizona — dates must match the wall clock.
> 
> For date-only strings (YYYY-MM-DD), parse as noon UTC (`${date}T12:00:00Z`) to avoid day-boundary shift.

> [!CAUTION]
> **Date STORAGE Rule (CRITICAL)**: When saving dates to the database (`normalizeDateValue`, any YYYY-MM-DD conversion for API calls), ALWAYS use UTC (`getUTCFullYear`, `getUTCMonth`, `getUTCDate`). **NEVER** use `America/Phoenix` for storage normalization — this causes dates to shift backward by 1 day per save (UTC midnight → PHX = previous day). This bug was introduced March 5 and fixed March 9.

### March 9, 2026: Date Save Shift Bug (CRITICAL FIX)

**Problem**: Every time a date field (DOB, lastLab, nextLab, serviceStartDate, contractEnd) was edited and saved, the date shifted backward by 1 day. Saving twice = 2-day shift.

**Root Cause**: The March 5 Arizona timezone fix incorrectly applied `America/Phoenix` to `normalizeDateValue()` in `PatientTable.tsx`. This function converts dates to YYYY-MM-DD for database storage. When a date stored as `2026-03-09` was parsed as UTC midnight and then formatted in Arizona time (UTC-7), it became `2026-03-08`.

**Fix**: Reverted `normalizeDateValue()` to use UTC date extraction for storage. Arizona timezone is now ONLY used in display functions (`formatDateInput`, `formatDisplayDate`).

### March 9, 2026: Morning Check Prefilled Dose Count Fix

**Problem**: Morning inventory check showed inflated partial volume (38mL instead of 7mL) because staged/prefilled doses had already been deducted from source vials.

**Fix**: `getSystemInventoryCounts()` now queries `staged_doses` table separately and reports `stagedDoseMl` as a distinct value. Morning check form subtracts staged dose volume from the partial pre-fill and shows prefilled doses as a separate purple info line.

---

### March 5, 2026: UPS Shipping Fixes & Enhancements

**1. Negotiated Rate Fix ($32 vs $7 Discrepancy)**
- **Problem**: Shipment creation showed $7.41 quoted rate but UPS charged $32.11. The `createShipment` request was not requesting the negotiated rate in the response.
- **Fix**: Added `ShipmentRatingOptions: { NegotiatedRatesIndicator: '' }` to the shipment request.
- **File**: `lib/ups.ts` L424-431

**2. Healthie Address Sync Fix (Location Mutations)**
- **Problem**: Address updates in the dashboard silently failed to sync to Healthie. `updateClient` mutation **ignores** the `location` field — Healthie requires dedicated `createLocation`/`updateLocation` mutations.
- **Root Cause #2**: `getClientLocations` used a standalone `locations(user_id:)` query that returned empty results. Healthie requires querying `user(id:) { locations { ... } }` instead.
- **Result**: Every save created a new "Primary" location without updating existing ones → duplicates piled up.

| Fix | File | Change |
|-----|------|--------|
| Location CRUD methods | `lib/healthie.ts` | Added `getClientLocations`, `createLocation`, `updateLocation`, `deleteLocation`, `upsertClientLocation` |
| Query fix | `lib/healthie.ts` | Changed from `locations(user_id:)` to `user(id:) { locations { ... } }` |
| Dedup logic | `lib/healthie.ts` `upsertClientLocation` | Updates first location, auto-deletes all duplicates |
| Use location mutations | `lib/healthieDemographics.ts` | Calls `upsertClientLocation()` instead of passing `location` to `updateClient()` |
| Skip inactive patients | `lib/healthieDemographics.ts` | Added `status_key` lookup; skips sync if `status_key = 'inactive'` |

> [!CAUTION]
> **Healthie API Gotcha**: The `updateClient` mutation silently ignores the `location` field. You MUST use `createLocation`/`updateLocation` mutations to manage patient addresses. The `locations` field must be queried via the `user` object, NOT via a standalone `locations` query.

**3. UPS SMS Tracking Notifications (via GHL)**
- **What**: When a shipping label is created → patient receives SMS with tracking # and UPS tracking link. When a shipment is voided → patient receives SMS cancellation notice.
- **Channel**: Sent via GHL `928-212-2112` number using `GHLClient.sendSms()`
- **Non-blocking**: SMS is fire-and-forget (async `.catch()`). Failures are logged but don't block shipment operations.

| File | Purpose |
|------|---------|
| `lib/upsNotifications.ts` [NEW] | `notifyShipmentCreated()`, `notifyShipmentVoided()` — looks up `ghl_contact_id` from `patients` table, routes through correct GHL location client |
| `app/api/ups/ship/route.ts` | Calls `notifyShipmentCreated()` after successful shipment |
| `app/api/ups/void/route.ts` | Calls `notifyShipmentVoided()` after successful void |

**4. Admin Shipments Dashboard Page**
- **Navigation**: Admin dropdown → Shipments (`/ops/admin/shipments`)
- **Features**: Stat cards (total, active, delivered, voided, total cost), search bar, status filter buttons, data table with expandable detail rows, clickable tracking links (UPS.com), print label, void actions.

| File | Purpose |
|------|---------|
| `app/admin/shipments/page.tsx` [NEW] | Server page with admin auth check |
| `app/admin/ShipmentsAdminClient.tsx` [NEW] | Client component with full dashboard UI |
| `app/api/admin/shipments/route.ts` [NEW] | API endpoint — JOINs `ups_shipments` with `patients`, aggregates stats |
| `app/layout.tsx` | Added `{ label: 'Shipments', href: '/admin/shipments' }` to `adminItems` |

**5. Healthie `requestFormCompletion` Method**
- Added `requestFormCompletion(userId, formId)` to `HealthieClient` class for assigning forms to patients.
- **File**: `lib/healthie.ts`

---

### March 4, 2026: RDS Connectivity Fix (psycopg2-binary 2.9.11 → 2.9.10)

**Problem**: All Python scripts using psycopg2 could not connect to RDS. Connections hung indefinitely during TLS handshake. `psql`, `openssl s_client`, and pg8000 (pure Python) all worked fine.

**Root Cause**: psycopg2-binary **2.9.11** bundles its own `libssl-81ffa89e.so.3` which is **incompatible** with this RDS instance's TLS configuration (PostgreSQL 17.6 on aarch64). The bundled libssl hangs during the TLS handshake after the server agrees to SSL.

**Fix**: Downgraded to psycopg2-binary **2.9.10** which bundles a compatible libssl.

> [!CAUTION]
> **DO NOT upgrade psycopg2-binary to 2.9.11** — it will break ALL Python DB connections. Pin to `psycopg2-binary==2.9.10`. Also installed `pg8000` as a backup pure-Python driver.

### March 4, 2026: Lab Patient Matching — 3-Tier Pipeline

**Problem**: All 14 pending labs had **0% match confidence** (no Healthie ID linked). Patient matching depended entirely on Snowflake via `ScribeOrchestrator.get_patient_candidate_list()`. When Snowflake is unavailable, matching silently returns 0%.

**Fix**: Replaced single-tier Snowflake matching in `fetch_results.py` with 3-tier strategy:

| Tier | Source | Speed | Reliability |
|------|--------|-------|-------------|
| 1 | **Postgres `patients` table** | Fast (local) | Always available |
| 2 | **Healthie API direct search** | Medium (HTTP) | High |
| 3 | **Snowflake `PATIENT_360_VIEW`** | Slow | Fragile |

**Also added**:
- **Name normalization**: `BADILLA` → `Badilla`, `DOE, JOHN` → `John Doe`
- **DOB normalization**: Handles `MM/DD/YYYY`, `YYYY-MM-DD`, etc.
- **Zero-results alerting**: Telegram alert if no new labs for 48+ hours (state file: `/home/ec2-user/data/last-lab-results-seen.json`)

### March 4, 2026: Split-Vial Dispense Bug Fix (+20mL Inflation)

**Problem**: When dispensing across two vials (split-vial handler), the second dispense recorded wildly inflated quantities. Example: Snyder on 03/03 — V0339 recorded 60 mL dispensed from a 30 mL vial (12 syringes × 5.0 mL).

**Root Cause**: `handleSplitAcrossVials()` in `TransactionForm.tsx` had a fallback path (L402) that recalculated `doseNext = nextSyringes × doseValue` from scratch instead of using the remaining removal budget. The `nextSyringes` fallback (`fallbackSyringes`) could produce syringe counts equal to or larger than the original total.

| Fix | File | Change |
|-----|------|--------|
| Cap doseNext to budget | `app/inventory/TransactionForm.tsx` L399-408 | Derive doseNext from `remainingRemoval - wasteBase` instead of `nextSyringes * doseValue` |
| Cap nextSyringes | `app/inventory/TransactionForm.tsx` L401 | `Math.min(fallbackSyringes, totalSyringes - predictedCurrentSyringes)` |
| Backend guard | `lib/inventoryQueries.ts` L810-820 | If `totalDispensedMl + wasteMl > currentRemaining`, scale both down proportionally |

> [!IMPORTANT]
> Snyder's two incorrect dispense records from 03/03 need to be deleted and re-entered manually.

---

### March 2, 2026: Three Bug Fixes (Billing, DOB, Lab Approval)

**1. Billing Info Not Saving (iPhone App)**
- **Root Cause**: Lambda `index.js` had **duplicate billing action handlers** (lines 299-327 and 494-522). The first `add_payment_method` handler returned `{ paymentMethod }` without `success: true`. `AddCardScreen.tsx` checks `response.success`, so the card was actually saved to Healthie but the app always reported failure.
- **Fix**: Removed duplicate handlers. Added `success: true` to the first `add_payment_method` response.
- **File**: `backend/lambda-booking/src/index.js`
- **Status**: Code fixed — requires Lambda redeployment

**2. Date of Birth Incorrect (iPhone App)**
- **Root Cause**: `safeParseDate` in `dateUtils.ts` parsed date-only strings (`"1990-05-15"`) using `new Date("1990-05-15T12:00:00")`. On iOS this is interpreted as UTC; on Android as local time. This cross-platform inconsistency shifts the displayed DOB by ±1 day.
- **Fix**: Changed to use `Date` component constructor `new Date(year, month-1, day, 12, 0, 0)` which is consistently local time on all platforms.
- **File**: `mobile-app/src/utils/dateUtils.ts`
- **Status**: Code fixed — requires app rebuild
- **CRITICAL LEARNING**: Never use `new Date(isoString)` without timezone for date-only values in React Native. Always use `new Date(y, m-1, d, 12)`.

**3. Cannot Approve Restricted Lab Orders**
- **Root Cause**: `app/api/labs/order/[id]/approve/route.ts` called `requireApiUser(req, 'admin')` — only the highest role could approve. Users with `write` role were getting 401 Unauthorized.
- **Fix**: Changed to `requireApiUser(req, 'write')` so any write-level user can approve restricted labs.
- **File**: `app/api/labs/order/[id]/approve/route.ts`
- **Status**: ✅ Deployed (PM2 restart completed)

**4. Node.js v20.20.0 Hang Fix (PARTIALLY CORRECT — see March 7 IPv6 fix)**
- **Root Cause**: Node v20.20.0 (NodeSource RPM) had a **race condition** causing all Node processes to hang on startup. Proven by running under `strace` which added enough timing delay for Node to work.
- **Fix**: Installed `nvm` (v0.40.1) and upgraded to **Node v22.22.0** (latest LTS). Reinstalled PM2 globally under new Node.
- **NOTE (Mar 7 2026)**: This fix resolved the Node v20 race condition but the hanging persisted. The **true root cause** was broken IPv6 connectivity (see March 7, 2026 entry). Node v22's `verbatim` DNS order actually made IPv6 hangs MORE frequent.
- **Status**: ✅ Node upgrade deployed; IPv6 fix applied March 7, 2026

### February 26, 2026: Lab Review Queue Migration (JSON → PostgreSQL)

**Problem**: The lab review queue was stored in a ~27MB JSON file (`data/labs-review-queue.json`). Every read loaded the entire file and every write rewrote it — slow and not scalable.

**Migration**: Created `lab_review_queue` PostgreSQL table with 31 columns matching the `LabQueueItem` interface, plus indexes on `status` and `created_at`.

| File | Action | Purpose |
|------|--------|---------|
| `migrations/20260226_lab_review_queue.sql` | NEW | Table schema + indexes |
| `scripts/import-lab-review-queue.py` | NEW | One-time Python import (73 records) |
| `app/api/labs/review-queue/route.ts` | MODIFIED | GET/POST now use `query()` from `lib/db.ts` |

**Key changes in `route.ts`**:
- Removed `loadQueue()` / `saveQueue()` + `LABS_QUEUE_FILE` constant
- Added `loadQueueItem(id)` — `SELECT ... WHERE id = $1`
- Added `updateQueueItem(id, updates)` — dynamic parameterized `UPDATE`
- GET handler: `SELECT * FROM lab_review_queue WHERE status = $1 ORDER BY created_at DESC LIMIT $2`
- All Healthie upload, S3 download, visibility, and lab-date-update logic unchanged

**Import Results**: 73/73 records (55 approved, 16 pending_review, 2 rejected), 0 errors.

> [!NOTE]
> The JSON file `data/labs-review-queue.json` is kept as a backup. As of March 4, 2026: `fetch_results.py` now syncs new items to PostgreSQL via `_sync_to_db()`. Both `page.tsx` and `app/api/labs/pdf/[id]/route.ts` read from PostgreSQL. The review-queue API (`route.ts` GET/POST) reads from PostgreSQL.

### March 4-5, 2026: Lab Fetch Resilience & Data Source Fix

**Problem 1 — "Item not found" on approval**: After the Feb 26 migration, `page.tsx` and `labs/pdf/[id]/route.ts` still read from the JSON file, while the approval API reads from PostgreSQL. Items created after migration existed only in JSON → API returned 404.

**Fix**: Changed `page.tsx` and `labs/pdf/[id]/route.ts` to read from PostgreSQL. Added `_sync_to_db()` to `fetch_results.py`'s `save_queue()` so new items go to both JSON and DB. Synced 6 missing records.

**Problem 2 — Missing results (Jessica Porter)**: The `fetchInbox` → `flagBatchAsRemoved` cycle is destructive. Once a batch is flagged, late-arriving results in that batch are permanently lost. Porter's results (completed 02/28) were never returned by the API.

**Resilience fix in `fetch_results.py`**:

| Change | Purpose |
|--------|---------|
| `_record_processed_accessions()` | Records every accession from the API to `lab_processed_accessions` table for audit trail |
| `_flag_previous_batch()` | Flags the **previous** run's batch, not the current one (delayed flagging) |
| `_save_batch_info()` | Saves current batch info to `.last_batch_info.json` for next run |
| `lab_processed_accessions` table | Audit trail of all accessions ever seen (80 backfilled from existing queue) |

**How delayed flagging works**: Each run flags the batch from the *previous* run (stored in `.last_batch_info.json`), then processes current results and saves batch info for the next run. This gives late-arriving results a 30-minute window to be picked up before their batch is flagged.

> [!IMPORTANT]
> The existing dedup logic (skip accessions already in queue) prevents double-processing. The delayed flagging is purely additive — no existing flow was changed.

### February 26, 2026: SQL Injection Fix in DEA MCP Server

**Vulnerability**: `lib/mcp/dea-server.ts` `get_recent_dispenses` tool used string interpolation for `INTERVAL '${days} days'` — a SQL injection vector in the DEA compliance module.

**Fix**: Replaced with parameterized `($1 || ' days')::INTERVAL` + params array. All other 4 tools in the file already used parameterized queries.

**Verified**: PostgreSQL correctly blocks injection attempts with `invalid input syntax for type interval` error at the type cast level.

### February 26, 2026: Apple AI Privacy Fix, Journal/Metrics Bug Fixes

**Apple App Store Rejection Fix (Guidelines 5.1.1(i) & 5.1.2(i))**:
- Added first-time AI consent dialog to `JarvisScreen.tsx` — discloses what data is sent to Google Gemini AI, requires explicit "I Agree" before Jarvis is usable
- Consent stored in `expo-secure-store` (one-time prompt)
- Updated `nowoptimal-website/app/privacy/page.tsx` Section 3: removed contradictory "not shared with external AI providers" wording, replaced with accurate Gemini disclosure
- Added Google (Gemini AI) to BAA list in Section 4
- Website rebuilt and redeployed via PM2

**Journal & Metrics Display Bug Fixes** (`JournalScreen.tsx`, `MetricsScreen.tsx`):
- Fixed "Invalid Date" — `safeParseDate()` handles Healthie date-only strings (`"2025-12-26"`) that iOS chokes on
- Fixed Blood Pressure: `13686` → `136/86 mmHg` (smart split based on digit count)
- Fixed Weight: `56` → `56 lbs (25.4 kg)` (dual units)
- Fixed Height: `5` → `5'0" (152.4 cm)` (detects feet vs inches, shows both)
- Fixed Sleep: `8.5` → `8.5 hours` (unit label added)
- Added smart `formatMetricValue()` dispatcher for all metric categories
- MetricsScreen cards now show secondary unit line (e.g., `86.2 kg` under Weight card)

### February 25, 2026: Peptide System Overhaul, Revenue Fix, Transaction Delete Fix

**Peptide Soft-Delete** (`lib/peptideQueries.ts`, `app/peptides/PeptideTable.tsx`):
- Added `active` boolean column to `peptide_products` table
- Replaced hard delete with toggle (deactivate/reactivate)
- Inactive peptides shown with reduced opacity and "Show Inactive" filter

**Healthie Patient Search for Peptide Dispenses** (`app/peptides/DispenseForm.tsx`):
- Replaced plain text patient name field with debounced Healthie patient search (same API as labs: `/ops/api/patients/search`)
- Auto-fills patient name and DOB on selection; DOB stored in new `patient_dob` column on `peptide_dispenses`
- DOB passed to label generation for accurate prescription labels

**Label Date Formatting** (`lib/pdf/labelGenerator.ts`):
- Added `formatDateMMDDYYYY()` helper — normalizes all dates (ISO, slash, dash) to MM-DD-YYYY
- Applied to `patientDob`, `dateDispensed`, and `expDate` on all labels

> [!IMPORTANT]
> **Critical Schema Gotcha — `patients` table column names**:
> - The raw `patients` table uses `dob` (DATE type) and `full_name` — NOT `date_of_birth` or `patient_name`
> - `date_of_birth` only exists on the VIEW `patient_data_entry_v` 
> - When JOINing to `patients`, always use `pt.dob` and `pt.full_name`
> - When using `dob` in COALESCE with a TEXT column, cast it: `pt.dob::text`
> - `sale_date` on `peptide_dispenses` is a plain DATE — do NOT apply `AT TIME ZONE` to it

**Revenue "Today" Card Fix** (`lib/peptideQueries.ts` → `fetchPeptideFinancials()`):
- Root cause: `CURRENT_DATE` is UTC; clinic is in MST (UTC-7). Afternoon dispenses showed as "tomorrow"
- Fix: Use `(NOW() AT TIME ZONE 'America/Phoenix')::date` for date boundaries
- `sale_date` is a DATE column — only apply timezone to `NOW()` and `created_at`, never to `sale_date` itself

**Transaction Delete Fix** (`lib/inventoryQueries.ts` → `deleteDispense()`):
- Root cause: `dispense_history` table has NOT NULL FK to `dispenses` with ON DELETE SET NULL → constraint violation
- Fix: Added `DELETE FROM dispense_history WHERE dispense_id = $1` before deleting the dispense

**Revenue Section Rename** (`app/analytics/components/PeptideFinancials.tsx`, `app/analytics/AnalyticsClient.tsx`):
- Renamed "Peptide Financials" → "Revenue" (💰)
- Moved from Overview tab to Revenue tab on CEO Dashboard

### February 24-25, 2026: DEA Improvements, Label Printing, Vial Deletion Bug Fix & Cleanup

> [!WARNING]
> **Gemini Flash Incident**: On Feb 24, Gemini Flash made changes without consulting or updating the SOT. It reverted the `TransactionsTable` column fix (#3 from Feb 18), dumped 18 debug scripts in the project root, and made direct database modifications without documentation. All issues were remediated on Feb 25.

**DEA Page Enhancements** (`app/dea/page.tsx`, `lib/deaQueries.ts`):
- Date range filtering (start/end date inputs) for DEA log
- Default limit increased from 200→500 dispenses
- `ChecksManager` component added for controlled substance check history
- CSV export now supports date-filtered downloads
- Date formatting switched to `formatDateUTC()`

**Label Printing** (`lib/pdf/labelGenerator.ts` [NEW], `lib/healthieUploadLabel.ts` [NEW]):
- PDF label generation for testosterone dispensing
- Print Label button added to Transactions table (per-row action)
- Upload label to Healthie patient chart support

**`deleteDispense()` Hardening** (`lib/inventoryQueries.ts`):
- Audit trail: records deletion event via `recordDispenseEvent()` BEFORE removing the dispense
- Overfill cap: restored volume capped at `LEAST(size_ml, ...)` to prevent vials exceeding max capacity
- Auto-reactivate: vials with 0 mL restored to 'Active' when volume is added back
- `staged_doses` FK: nullifies `dispense_dea_tx_id` and `vial_id` references before cascade delete

**Vial Deletion Bug (Phil Schafer)**: Investigation found that deleting transactions for Phil Schafer didn't correctly restore vial inventory. Gemini Flash manually restored 9.6 mL to V0367 and marked V0368 as 'Completed'. Also changed `dispense_history_dispense_id_fkey` from CASCADE to SET NULL so history survives dispense deletion.

**Cleanup (Feb 25)**: 18 debug scripts moved from project root to `.tmp/gemini-flash-feb24-debug/`. `TransactionsTable` "Total Volume" column reverted to `total_amount` (per Feb 18 Fix #3). `CLAUDE.md` and `GEMINI.md` updated with mandatory SOT review protocol.

---

### February 23, 2026: Monitoring Alert Cycling Fix & Cron Schedule Correction

**Problem 1 — Webhook Alert/Recovery Cycling**: The uptime monitor checked webhook health every 60s, but the webhook processor runs every 5 min. Between processing cycles, pending webhooks naturally queued up (>10), triggering WARNING → then processing cleared them → RECOVERY. This cycled 24/7 with misleading "Payment failure alerts may not be working!" text.

**Problem 2 — No Morning Report**: Cron schedule comments said "7am MST (2pm UTC)" and "8am MST (3pm UTC)" but the server's cron daemon runs in **MST** (not UTC). So `0 14 * * *` = **2pm MST** and `0 15 * * *` = **3pm MST**. Neither report ever ran in the morning.

| Fix | File | Change |
|-----|------|--------|
| Webhook threshold raised | `app/api/analytics/system-health/route.ts` L562 | `pending > 10` → `pending > 50` |
| 10-min grace period | `scripts/uptime_monitor.py` L27, L191-240 | Only alerts after 10 min of continuous degradation |
| Payment warning text | `scripts/uptime_monitor.py` L221 | "Payment alerts may not be working" only on actual `error` status |
| Recovery suppression | `scripts/uptime_monitor.py` L236 | No recovery message if alert was never sent (cleared during grace) |
| Morning Report cron | crontab | `0 14 * * *` → `0 8 * * *` (8:00 AM MST) |
| Infrastructure Monitor cron | crontab | `0 15 * * *` → `30 8 * * *` (8:30 AM MST) |

> [!IMPORTANT]
> **Cron runs in MST** on this server (`/etc/localtime` → `America/Phoenix`). Always use MST hours in cron expressions. Comments must say MST, not UTC.

---

### February 19, 2026: Supply PAR System (Multi-Location)

**New system** for tracking general clinic supplies with Periodic Automatic Replenishment (PAR) level alerts. **Completely separate from DEA controlled substance inventory** (`app/inventory/`).

> [!CAUTION]
> The Supply PAR system (`app/supplies/`, `supply_*` tables) is **NOT** for controlled substances. DEA-regulated vials use `app/inventory/`, `vials` table, and `app/dea/`. Never mix these systems.

**Locations**:
| Location ID | Name | Address | Seeded Data |
|-------------|------|---------|-------------|
| `primary_care` | NowPrimary.Care | 404 S. Montezuma, Prescott, AZ 86303 | 132 items from Jan 16 2026 inventory |
| `mens_health` | NowMensHealth.Care | 215 N. McCormick, Prescott, AZ 86301 | Empty (no data yet) |

**Database Tables**:
| Table | Purpose |
|-------|---------|
| `supply_locations` | Clinic locations (id, name, address) |
| `supply_items` | Master catalog (132 items, 10 categories) |
| `supply_counts` | Current qty per item+location (UNIQUE constraint) |
| `supply_count_history` | Audit trail — every count, usage, adjustment with optional Healthie patient association |

**Key Files**:
| File | Purpose |
|------|---------|
| `lib/supplyQueries.ts` | All queries: CRUD, bulk counts, patient-linked usage, history |
| `app/supplies/page.tsx` | Main dashboard (server component) |
| `app/supplies/SupplyTable.tsx` | Interactive table with location selector, Use/Count modals |
| `app/api/supplies/route.ts` | GET (list/filter by location) + POST (create item) |
| `app/api/supplies/[id]/route.ts` | PATCH (update PAR level, name, etc.) |
| `app/api/supplies/count/route.ts` | POST (bulk inventory count) |
| `app/api/supplies/use/route.ts` | POST (use supplies, link to Healthie patient visit) |
| `app/api/supplies/history/route.ts` | GET (audit trail) |
| `scripts/seed-supply-inventory.ts` | Seeds 132 items from Google Doc (NowPrimary.Care) |
| `migrations/20260219_supply_par.sql` | Schema migration |

**Features**: Location selector tabs, PAR level alerts (🟢 OK / 🟡 Low / 🔴 Reorder / ✕ Out), category filter pills (10 categories), Use Supplies modal with Healthie patient association, Record Count modal for bulk inventory counts, full audit trail.

**Navigation**: Under **Clinical ▼** → Supplies (along with Patients, Labs, Faxes, Peptides)

**Categories** (10): Blood Glucose, Cleaning/Office, IV Supplies, Kits, Meds/Supplements, Miscellaneous, Monofilament, Pelleting Supplies, Syringes/Needles, Tests

---

### February 23, 2026: Scribe System — Dual Upload, Patient Search & Name Fix

**Root Cause**: When provider clicked "Confirm & Send" during active scribe lock, Python scribe uploaded to Healthie AND TS bot processed the same callback after lock was released — creating **duplicate chart notes**. Additionally, `updateFormAnswerGroup` mutation included invalid `filler_id` field, causing resubmit failures.

| Bug | File | Fix |
|-----|------|-----|
| Dual upload race condition | `telegram-ai-bot-v2.ts` L3009 | Skip `confirm_send` if session already `SUBMITTED` |
| Duplicate upload safety net | `telegram-ai-bot-v2.ts` L3122 | 30-second timestamp protection on `confirm_final_send` |
| `filler_id` schema error | `telegram-ai-bot-v2.ts` L3207 | Removed invalid field from `updateFormAnswerGroup` |
| Chart note update fallback | `telegram-ai-bot-v2.ts` L3256 | Falls back to create if update fails (e.g. deleted in Healthie) |
| Duplicate patient search | `telegram_approver.py` L466 | `PATIENT_360_VIEW` filtered to `STATUS = 'ACTIVE'` + `ROW_NUMBER()` dedup |
| Wrong name in SOAP after change | `telegram_approver.py` L694, L1027 | Auto-replace old patient name in SOAP note when patient is changed |

> **Key Learning**: The Python scribe (`telegram_approver.py` + `scribe_orchestrator.py`) and TS bot (`telegram-ai-bot-v2.ts`) both handle callbacks. When scribe lock is released mid-callback, TS bot re-processes the same action. Always check session status before acting.

### February 19, 2026: Home Directory Reorganization

**Moved 220+ loose files from root home directory into organized structure.** Nothing deleted — all preserved in `archive/`.

| Category | Destination |
|---|---|
| 72 documentation files | `docs/` (architecture, integrations, audits, plans, setup, incidents) |
| 72 loose scripts (.js/.py/.ts/.sh) | `archive/loose-scripts/` |
| 12 log files | `archive/loose-logs/` |
| 18 data exports | `archive/loose-data/` |
| Build artifacts, stale configs | `archive/build-artifacts/`, `archive/configs/` |
| Stale dashboard copies (gmhdashboard-1, apps/gmh-dashboard) | `archive/` |
| Root app/, lib/, components/ dirs | `archive/` |

**New directory structure**:
- `docs/` — All documentation organized by topic + `SOURCE_OF_TRUTH.md` symlink
- `directives/` — 3-layer architecture SOPs
- `execution/` — 3-layer architecture Python scripts
- `archive/` — Everything old (recoverable)

**3-Layer Architecture** added per `AGENTS.md`:
- Directives (SOPs) in `directives/`
- Execution scripts in `execution/`
- AI orchestrates between them

---

### February 17, 2026: Recurring Payment Hold Loop Fix

**Problem**: Patients who had already paid were being repeatedly put on "Hold - Payment Research" then reactivated, creating a hold-reactivate-hold loop.

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
- **New**: Google Gemini 2.0 Flash via REST API
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

### January 13, 2026 (AM): Staged Doses Bug Fixes & DEA Compliance Hardening


**Critical Bug Fixed: V0129 Over-Count**
- **Issue**: V0129 showed 30ml (full) but had a 9.6ml staged dose deducted from it
- **Cause**: Early failed staged dose attempts and race conditions from rapid clicking
- **Fix**: Manually corrected V0129 to 20.4ml (30 - 9.6ml staged)
- **Prevention**: Transaction-based operations with proper COMMIT/ROLLBACK

**Patient Selector Modal for Generic Prefills**
- **Old behavior**: Used JavaScript `prompt()` which was confusing
- **New behavior**: Opens a modal with autocomplete patient search (same as Transactions page)
- **File changed**: `app/inventory/StagedDosesManager.tsx`

**Data Integrity Checks - Run This Query to Audit:**
```sql
-- Check for vials with staged doses that don't match remaining volume
SELECT v.external_id, v.remaining_volume_ml,
       sd.total_ml as staged_ml, sd.status
FROM staged_doses sd
JOIN vials v ON v.vial_id = sd.vial_id
WHERE sd.status = 'staged';

-- Count all Carrie Boyd vials
SELECT 
  COUNT(*) FILTER (WHERE remaining_volume_ml >= 29.9) as full_count,
  COUNT(*) FILTER (WHERE remaining_volume_ml > 0 AND remaining_volume_ml < 29.9) as partial_count,
  SUM(remaining_volume_ml) as total_ml
FROM vials WHERE dea_drug_name LIKE '%30%';
```

**Known Issues & Lessons Learned:**
1. **Rapid clicking creates duplicates**: Users clicking "Save Prefill" multiple times creates multiple staged doses
   - Solution: Add loading state to disable button after first click (already implemented)
2. **Database transactions are critical**: All inventory changes MUST be in a transaction
3. **PostgreSQL type inference**: Always use explicit casts (::uuid, ::numeric) for parameterized queries
4. **NULL vial_id in early attempts**: Some staged doses have NULL vial_id from before we added vial tracking
   - These are harmless (status='discarded') but show up in audits
5. **Morning check math**: System expects = (Full vials × 30ml) + partial vials - staged doses

**Inventory Reconciliation Formula:**
```
Physical vials in storage = System vial total - (staged doses in syringes)

Example:
- System shows: 35 full (1050ml) + V0129 (20.4ml) + V0165 (8ml) = 1078.4ml in vials
- Plus staged: 9.6ml in syringes
- Total controlled substance: 1088ml
```

**Files for DEA Compliance Audit:**
- `/home/ec2-user/gmhdashboard/docs/SOP-Inventory-Check.md` - Staff procedure
- `/home/ec2-user/gmhdashboard/docs/SOP-PreFilled-Doses.md` - Prefill procedure
- PDFs available at: `nowoptimal.com/ops/menshealth/`

---

### January 12, 2026: Pre-Filled (Staged) Doses System

**Purpose**: Allow staff to pre-fill syringes the night before for patients coming in the next day. This improves efficiency while maintaining DEA compliance and accurate inventory tracking.

**Database Table**: `staged_doses`
- Tracks all prefilled syringes with patient info, dose details, and status
- Links to `vials` table (which vial was used) and `dea_transactions` (audit trail)
- Status values: `staged` (waiting to be used), `dispensed` (given to patient), `discarded` (removed/wasted)

**API Endpoints**:
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/staged-doses` | GET | Fetch all staged doses |
| `/api/staged-doses` | POST | Create new prefilled dose (deducts inventory immediately) |
| `/api/staged-doses?id=` | DELETE | Remove prefill and restore medication to vial |
| `/api/staged-doses/use` | POST | Convert prefill to actual dispense (no double DEA entry) |

**UI Component**: `app/inventory/StagedDosesManager.tsx`
- Appears on both Inventory page (`/ops/inventory`) and Transactions page (`/ops/transactions`)
- Shows list of staged doses with "✓ Use This" and "Remove" buttons
- Form for creating new prefills (patient-specific or generic)

**Workflow**:
1. **Create Prefill** (night before):
   - Staff selects patient (or "Generic" for walk-ins)
   - Enters dose details: dose_ml, waste_ml, syringe_count
   - System IMMEDIATELY deducts medication from a vial
   - System creates DEA transaction marked as "STAGED PREFILL"
   - Prefill appears in staged doses list

2. **Use Prefill** (next day when patient arrives):
   - Staff physically hands prefilled syringes to patient
   - Clicks "✓ Use This" button on the staged dose
   - System creates dispense record for the patient
   - System updates existing DEA transaction (NO double entry)
   - Prefill disappears from list

3. **Remove Prefill** (if patient no-shows or prefill unused):
   - Staff clicks "Remove" button
   - System RESTORES medication to the original vial
   - System marks DEA transaction as "[VOIDED - Prefill removed]"
   - Inventory is fully restored

**DEA Compliance**:
- ✅ Medication is logged when prefilled (before physical dispense)
- ✅ Single DEA entry per transaction (no double-counting)
- ✅ Voids are documented with "[VOIDED]" note
- ✅ Full audit trail from prefill → dispense or prefill → discard

**Key Design Decisions**:
- Inventory deducted at PREFILL time (not dispense time) - ensures physical syringes match logged inventory
- DEA transaction created at prefill, updated at dispense - avoids duplicate entries
- Vial external ID stored in staged_doses for traceability
- All queries use explicit type casts (::uuid, ::numeric, etc.) to avoid PostgreSQL parameter inference issues

**Files Changed**:
- `app/api/staged-doses/route.ts` - GET/POST/DELETE for staged doses
- `app/api/staged-doses/use/route.ts` - POST to convert staged → dispensed
- `app/inventory/StagedDosesManager.tsx` - UI component
- `app/inventory/page.tsx` - Added StagedDosesManager
- `app/transactions/page.tsx` - Added StagedDosesManager
- `lib/inventoryQueries.ts` - Added COALESCE for recorded_by fallback
- `app/transactions/TransactionsTable.tsx` - Fixed to use total_dispensed_ml

**Morning Check Update**:
- Replaced "missed transactions" checkbox with a link to Transactions page
- Staff can now click "→ Enter Prior Day Transactions" to open transactions page in new tab
- More actionable than a simple checkbox

### January 7, 2026: Payment Status & Merge UI Fixes

**QuickBooks Payment Issue Auto-Status (FIX)**:
- **Problem**: 142 patients had unresolved payment_declined issues but still showed "Active" status
- **Root Cause**: Payment issues were being recorded in `payment_issues` table but patient status wasn't being updated
- **Solution**: Ran bulk update to set all patients with unresolved payment issues to "Hold - Payment Research"
- **Affected Table**: `patients` - updated `status_key` and `alert_status`

**Merge Patients Auto-Refresh (FIX)**:
- **Problem**: After merging duplicate patients, the UI didn't refresh and patients appeared to still exist
- **Root Cause**: `router.refresh()` in Next.js App Router only does a soft refresh
- **Solution**: Changed to `window.location.reload()` for full page reload after merge/resolve
- **Files Changed**: `app/admin/membership-audit/SimplifiedAuditClient.tsx`

**Note on Merged Patients**:
- Merged patients are NOT deleted (for audit trail)
- They're marked as `status_key = 'inactive'` and `alert_status = 'Inactive (Merged)'`
- Filter by status to exclude merged patients from views

### January 6, 2026: DEA Controlled Substance System Improvements

**DEA Log Reconciliation (CRITICAL FIX)**:
- **Problem**: System had 6.5 vials more than physical inventory, dispenses spread across multiple vials incorrectly
- **Root Cause**: Initial reconciliation used flawed logic that didn't drain vials completely before moving to next
- **Solution**: Rewrote reconciliation to use proper FIFO (First In, First Out) - each vial fully emptied before next
- **Result**: 
  - Carrie Boyd: 37 empty, 1 in-progress (6.8ml), 8 full = 36.8ml (1.23 vials)
  - TopRX: 56 empty, 24 full = 240ml correct

**Controlled Substance Inventory Checks (NEW FEATURE)**:
- **Purpose**: DEA compliance - staff must verify physical inventory twice daily
- **Database Table**: `controlled_substance_checks` (with `check_type` column: 'morning' or 'evening')
- **Library**: `lib/controlledSubstanceCheck.ts`
- **API Endpoint**: `/api/inventory/controlled-check`
- **UI Component**: `app/inventory/MorningCheckForm.tsx`
- **Check Types**:
  | Type | Required for Dispensing? | Purpose |
  |------|-------------------------|---------|
  | Morning | ✅ YES - Blocks dispensing | DEA compliance - verify inventory before opening |
  | EOD | ❌ NO - Optional | Audit trail - verify inventory at end of day |

**Timezone Handling (IMPORTANT)**:
- All date comparisons use **Mountain Time** (`America/Phoenix`), NOT UTC
- PostgreSQL queries use: `(NOW() AT TIME ZONE 'America/Phoenix')::DATE`
- This ensures EOD checks submitted after 5PM MST are recorded for TODAY, not tomorrow
- Morning check requirement is based on local Mountain Time date, not server UTC

**Discrepancy Threshold & Auto-Waste (NEW)**:
- **Threshold**: Only differences >2ml trigger a "discrepancy" requiring explanation
- **Auto-Waste**: Differences ≤2ml are auto-documented as "user waste" (needle dead-space, spillage)
- **Example**: If system shows 50.4ml but staff counts 49.1ml (1.3ml difference), system auto-records as waste

**Morning Telegram Report (NEW)**:
- **Script**: `scripts/morning-telegram-report.ts`
- **Cron Job**: `0 14 * * *` (7am MST = 2pm UTC)
- **Contents**:
  - System health status
  - Yesterday's morning + EOD check status
  - Current testosterone inventory levels
  - Last 24hr dispensing activity
  - Unsigned dispenses count
  - Action items (missed checks, low stock, etc.)

**Environment Variables Added**:
```bash
TELEGRAM_BOT_TOKEN=(see .env.local)
TELEGRAM_CHAT_ID=7540038135
```

**Telegram DEA Commands**:
| Command | Description |
|---------|-------------|
| `/dea` or `/inventory` or `/t` | Show current inventory status |
| `/check cb:1,6.8 tr:24` | Record morning check (1 CB full + 6.8ml partial, 24 TopRX) |
| `/dea-history` | View check history |

**Frontend/Backend Validation**:
- **Frontend**: Vial dropdown only shows vials with remaining > 0
- **Backend**: API rejects dispenses from 0ml vials
- **Morning Check Enforcement**: API blocks controlled substance dispensing until morning check completed
- **Error**: "Daily controlled substance audit not completed..."

**Staff Documentation**:
- Created: `docs/STAFF_DISPENSING_GUIDE.md`
- Comprehensive guide for staff on dispensing workflow
- Explains morning + EOD checks, waste calculation, troubleshooting

**Waste Calculation Verified**:
- 0.1ml per syringe (needle dead-space)
- 185.7ml total waste / 1,855 syringes = exactly 0.100 ml/syringe ✅

---

### January 4, 2026: Data Sync Recovery & Monitoring Improvements

**CRITICAL: Healthie → Snowflake Sync Fixed**
- **Problem**: Billing items sync had been silently failing since Dec 29 - Snowflake data was 6 days stale!
- **Root Cause**: Cron job using old Node.js path `/home/ec2-user/.local/share/nvm/v20.19.6/bin/npx` which no longer exists
- **Solution**: Updated cron to use `/usr/bin/npx`
- **Manual Sync Ran**: Data now current (last payment: January 4, 2026)

**Telegram Bot Improvements (NOWJarvis)**:
- **Date Format**: All dates now display as **MM-DD-YYYY** (not YYYY-MM-DD)
- **Time Range Clarification**: AI now asks for clarification when queries like "total" are ambiguous
- **"Total" Interpretation**: When user asks for "total" without date qualifier, queries ALL data (no date filter)
- **Year Updated**: AI prompts updated from 2025 to 2026
- **New Commands Added**:
  - `/ghl` - Show Men's Health existing patients from GoHighLevel
  - `/dashboard [SQL]` - Query PostgreSQL directly (SELECT only)
  - `/datasources` - List all connected data sources

**Data Staleness Monitoring Added**:
- Health monitor now checks Snowflake billing data freshness
- Alerts via Telegram if data is >2 days old (sync failure)
- Prevents silent data sync failures from recurring

**Healthie Payment Decline Alerts (UPDATED 2026-02-01)**:
- **File**: `scripts/process-healthie-webhooks.ts`
- **Detection**: Monitors for status containing `failed`, `declined`, `error`, `rejected`, `cancelled`, `card_error`
- **CRITICAL: Recent Payment Check**: Before alerting or setting Hold, system checks if patient has a more recent SUCCESSFUL payment. If they've paid since the failure, **NO ALERT is sent**.
- **Healthie API Semantics**:
  - `billingItems`: `sender` = PATIENT (who pays), `recipient` = PROVIDER (who receives)
  - `requestedPayments`: `recipient` = PATIENT, `sender` = PROVIDER (REVERSED!)
- **Alerts To** (only if no recent payment):
  1. **Telegram**: Immediate alert with patient name, amount, status
  2. **Google Spaces**: ops-billing space (requires `GOOGLE_CHAT_WEBHOOK_OPS_BILLING` env var)
- **Automatic Dashboard Update**:
  - Patient status set to **"Hold - Payment Research"** (red)
  - Note added with timestamp: `[MM/DD/YYYY HH:MM AM] PAYMENT DECLINED - Amount: $X, Due: MM/DD/YYYY. Status auto-set to Hold - Payment Research.`
  - **Staff must manually set to Inactive if needed** - system never sets Inactive
- **Auto Message to Patient** (via Healthie Chat - in-app messaging):
  - Uses Healthie's `createConversation` + `createNote` mutations
  - Message appears in patient's Healthie messaging/chat inbox
  - **NOT SMS** - this is in-app chat that patients see when they log into Healthie
  - Message: `Hi {FirstName}, we noticed your {clinic} payment didn't go through. Please update your card here: https://secureclient.gethealthie.com/users/sign_in (Log in → Settings ⚙️ → Update Payment Cards). Questions? Call {phone}. Thank you!`
  - **Phone Numbers**: Men's Health = **928-212-2772**, All Others = **928-277-0001**
  - **Payment Portal**: `https://secureclient.gethealthie.com/users/sign_in` - patients log in, go to Settings → Update Payment Cards
  - **IMPORTANT**: GHL SMS is NOT used - only Healthie Chat to prevent duplicate messages
  - **CRITICAL**: Only messages ACTIVE patients - archived patients are SKIPPED. System checks `user.active` field from Healthie API before sending.
- **Auto-Reactivation** (when patient pays after being on Hold):
  - Patient status → Active
  - Note added: `[timestamp] PAYMENT RECEIVED - Auto-reactivated from Hold - Payment Research.`
  - Telegram notification sent to staff
  - **Chat to Patient** (via Healthie): `Hi {FirstName}, thank you! Your {clinic} payment has been received. We appreciate you! - NOW Optimal`


**Patient Status Color Rules** (GMH Dashboard):
| Status | Key | Color | Description |
|--------|-----|-------|-------------|
| Active | `active` | Green (`#d9ead3`) | Current, no issues |
| Active - Pending | `active_pending` | Yellow (`#fff2cc`) | Labs due or pending action |
| **Hold - Payment Research** | `hold_payment_research` | Red (`#f4cccc`) | **AUTO-SET when Healthie payment declines** |
| Hold - Patient Research | `hold_patient_research` | Red (`#f4cccc`) | Manual investigation needed |
| Inactive | `inactive` | Red (`#f4cccc`) | **STAFF ONLY** - No longer active patient |


**Overdue Rule** (Red status trigger):
- Balance > $0.50, OR
- Status contains "past"/"due", OR
- > 3 days past charge date

**Cost Report Enhanced**:
- Now includes real Snowflake credit usage (not estimates)
- Added SaaS subscriptions: GHL ($97), Healthie ($149), Ngrok ($8)
- **Grand Total**: Displays complete monthly infrastructure cost (~$356/mo)

**PM2 Services Updated**:
- Added `fax-processor` and `uptime-monitor` to critical services monitoring list


---

### January 2, 2026: NOW Primary Care Website Deployed


**New Website Live at https://www.nowprimary.care**
- **Purpose**: Professional public-facing website for NOW Primary Care clinic
- **Technology**: Next.js 14, vanilla CSS design system
- **Port**: 3004 (Nginx proxies nowprimary.care to localhost:3004)
- **PM2 Service**: `nowprimary-website`
- **Directory**: `/home/ec2-user/nowprimarycare-website/`

**Pages Created**:
- Home: Hero, features, provider spotlight, location, CTA
- About: Mission, values, Phil Schafer bio
- Services: All 26 Healthie appointment types organized by category
- Contact: Location map, contact form
- Book: Interactive service selection widget → Healthie portal

**Design System**:
- Navy Blue: `#00205B` (primary, from logo)
- Green: `#00A550` (accent, from logo compass)
- Inter font (Google Fonts)
- Responsive, mobile-first design

**Nginx Config Updated**:
- Changed `nowprimary.care` proxy from port 3001 to 3004
- Port 3001 remains for upload-receiver (Scribe service)

**postcss.config.mjs Relocated**:
- Moved from `/home/ec2-user/postcss.config.mjs` to `/home/ec2-user/gmhdashboard/postcss.config.mjs`
- Prevents conflict when building nowprimarycare-website (which doesn't use Tailwind)

---

## 🔥 PREVIOUS MAJOR CHANGES (DEC 25-30, 2025)

### December 30: Dashboard Hydration Fix & Jarvis Bot Improvements

**PatientTable Hydration Error Fixed**
- **Problem**: React hydration error on `/ops/patients/` - server rendered "Bruce French" but client expected "Travis Gonzales"
- **Root Cause**: Client-side sorting with `comparePatients()` produced different order than server SQL ORDER BY
- **Solution**: Added `mounted` state guard pattern to `PatientTable.tsx` (same pattern already in `AddPatientForm.tsx`)
- **Pattern Used**:
  ```typescript
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return <LoadingPlaceholder />;
  ```

**PM2 Production Mode Fixed**
- **Problem**: PM2 was running `npm run dev` instead of `npm run start`
- **Impact**: Dev mode causes slower hydration, extra React strict mode renders
- **Solution**: 
  ```bash
  pm2 delete gmh-dashboard
  pm2 start npm --name "gmh-dashboard" -- run start
  pm2 save
  ```
- **Verification**: `pm2 describe gmh-dashboard | grep "script args"` → should show "run start"

**Jarvis Telegram Bot Response Formatting Improved**
- **Problem**: Bot giving verbose, padded responses with unnecessary emojis and filler text
- **Solution**: Updated `formatAnswer()` prompt in `scripts/telegram-ai-bot-v2.ts`:
  - Reduced `max_tokens` from 800 to 300
  - Reduced `temperature` from 0.3 to 0.1
  - Added explicit instructions: "Be EXTREMELY BRIEF - 1-3 sentences max"
  - Added good/bad examples to guide response style
- **File**: `/home/ec2-user/gmhdashboard/scripts/telegram-ai-bot-v2.ts` (lines 1103-1145)

**CRITICAL FIX: Healthie Billing Items Sync Gap**
- **Problem**: Jarvis bot reporting $0 revenue when Healthie showed $1,280 for Dec 29
- **Root Cause**: `HEALTHIE_BILLING_ITEMS` table in Snowflake had NO automated sync from Healthie API
  - The existing `sync-healthie-ops.js` syncs from Postgres (dashboard data), NOT from Healthie API
  - Billing items table was stuck with data from Dec 23
- **Solution**: 
  1. Created `/home/ec2-user/gmhdashboard/scripts/sync-healthie-billing-items.ts` 
  2. Added hourly cron job to sync billing items from Healthie API to Snowflake
  3. Ran manual sync - now shows Dec 29: 8 transactions = $1,280 ✅
- **Cron Added**: `0 * * * *` (every hour at minute 0)

**Removed Rogue PM2 Process**
- `upload-receiver` had 1481 restart attempts and was in stopped state
- Deleted with `pm2 delete upload-receiver && pm2 save`

**Snowflake Sync System Overview** (Updated Feb 2026)
| Sync Job | Schedule | What It Syncs | Script Location |
|----------|----------|---------------|-----------------|
| Unified Python Sync | Every 4 hrs at :00 | patients, invoices, vials, dispenses, memberships, qb_payments, prescriptions → Snowflake | `/home/ec2-user/scripts/sync-all-to-snowflake.py` |
| QuickBooks | Every 3 hrs | QB payments/transactions | `/home/ec2-user/quickbooks-sync.sh` |
| Revenue Cache | Every 6 hrs at :40 | Healthie revenue data | `/home/ec2-user/scripts/cache-healthie-revenue.py` |

**Rate Limiting Measures** (added Dec 30):
- Billing items sync reduced from hourly to every 6 hours
- Staggered at :30 to avoid collision with scribe sync at :00
- Added 500ms delay between paginated API requests

**Important**: The Jarvis bot queries `HEALTHIE_BILLING_ITEMS` for financial data.

### December 28: Infrastructure Hardening
**Disk Space Crisis & Resolution**
- Ran out of disk space (98% on 20GB volume)
- Cleaned 4GB (old duplicates, logs, n8n Docker)
- Expanded EBS volume 20GB → 50GB via AWS Console
- Commands: `sudo growpart /dev/nvme0n1 1 && sudo xfs_growfs -d /`
- Result: Now 32% usage (35GB free) ✅

**QuickBooks OAuth Routes Created**
- **Problem**: Routes never existed, returned 404
- **Solution**: Created from scratch:
  - `/app/api/auth/quickbooks/route.ts` - Initiates OAuth
  - `/app/api/auth/quickbooks/callback/route.ts` - Token exchange
  - Added `getPublicUrl()` helper for proper redirects
- **Database**: Stores tokens in `quickbooks_oauth_tokens` table
- **Flow**: User → QuickBooks → Callback → Tokens saved → Redirect to dashboard

**Redirect Loop Fixed**
- **Problem**: `ERR_TOO_MANY_REDIRECTS` on `/ops` ↔ `/ops/`
- **Root Cause**: Nginx forced `/` but Next.js stripped it
- **Solution**: 
  - Added `trailingSlash: true` to `next.config.js`
  - All URLs now end with `/` (standard)
  - Renamed cookie `gmh_session` → `gmh_session_v2` (invalidate old)

**Base Path Configuration Standardized**
- **ENV**: `NEXT_PUBLIC_BASE_PATH=/ops` (in `.env.local` AND `next.config.js`)
- **Helper**: `lib/basePath.ts` exports `withBasePath(path)` and `getBasePath()`
- **Rule**: ALL client-side fetches MUST use `withBasePath('/api/...')`
- **Example**: `fetch(withBasePath('/api/admin/quickbooks/sync'), ...)`

**Production Mode Fixed**
- **Problem**: PM2 was running `npm run dev` instead of `npm run start`
- **Solution**: 
  ```bash
  pm2 delete gmh-dashboard
  pm2 start npm --name "gmh-dashboard" -- run start
  pm2 save
  ```
- **Verify**: `pm2 logs gmh-dashboard` should show `next start` (not `next dev`)

**Type Safety & Hydration Fixes**
- **Hydration**: Added client-side guards to `AddPatientForm`, `LoginForm`
- **Pattern**: `useState(false)` + `useEffect(() => setMounted(true))` + early return
- **Formatters**: All `formatCurrency/formatNumber` now handle `number | string | null | undefined`
- **Dates**: Use UTC-based `safeDateFormat()` instead of `toLocaleString()`

### December 25-27: AI Scribe System Built
**Full Clinical Documentation Automation**
- **Location**: `/home/ec2-user/scripts/scribe/`
- **Workflow**:
  1. Audio recording uploaded → Deepgram transcription
  2. Claude analyzes visit → Classifies visit type
  3. Generates 4 documents: SOAP note, patient summary, prescription recs, lab orders
  4. Sends to Telegram for provider approval (inline buttons)
  5. Provider reviews/edits/approves
  6. Approved docs injected into Healthie chart

**Key Components**:
- `scribe_orchestrator.py` - Main coordinator
- `telegram_approver.py` - Human-in-the-loop approval UI
- `document_generators.py` - AI-powered generation
- `prompts_config.yaml` - Customizable prompt templates
- `upload_receiver.js` - PM2 service (listens on port 3001)

**Visit Types Detected**:
- Initial consultation
- Follow-up visit
- Prescription refill
- Medication adjustment
- Lab review

**Safety Features**:
- Telegram approval required (no auto-injection)
- Edit capability before approval
- **Change Patient feature** (Jan 21, 2026): When fuzzy matching assigns wrong patient, tap "🔄 Change Patient" to search and reassign to correct patient
- Comprehensive logging
- Graceful error handling (Telegram failures don't crash workflow)

**Documentation**:
- Setup: `scripts/scribe/SETUP.md`
- Safety: `scripts/scribe/SAFETY_GUIDE.md`
- Customization: `scripts/scribe/PROMPT_CUSTOMIZATION.md`

### December 25-27: Snowflake "Mini-Bridge" Complete
**Infrastructure Provisioned**:
1. **AWS S3 Bucket**: `gmh-snowflake-stage` (us-east-2)
2. **IAM Role**: `snowflake-s3-access-role` (trust to Snowflake)
3. **Storage Integration**: S3 → Snowflake connection
4. **Snowpipe**: Auto-ingest on file upload

**Data Flow**:
```
Clinical Systems (Healthie, QB, Postgres)
  ↓ (Sync scripts)
AWS S3 (gmh-snowflake-stage)
  ↓ (Snowpipe)
Snowflake (GMH_CLINIC)
  ↓ (SQL views)
Metabase (BI)
```

**Active Syncs**:
- Every 6 hours: `scripts/sync-healthie-ops.js` → Snowflake
- Every hour: `scripts/scribe/healthie_snowflake_sync.py`
- On-demand: Invoice sync, provider sync, billing items

**Snowflake Details**:
- Account: `KXWWLYZ-DZ83651`
- User: `JARVIS_SERVICE_ACCOUNT` (key-pair auth) — see Snowflake Auth section above
- Database: `GMH_CLINIC`
- Schemas: `FINANCIAL_DATA`, `PATIENT_DATA`, `INTEGRATION_LOGS`

**Key Tables** (as of Dec 28):
- `PATIENTS`: 305 rows
- `HEALTHIE_INVOICES`: 69
- `HEALTHIE_BILLING_ITEMS`: 20
- `QB_PAYMENTS`: 84
- `MEMBERSHIPS`: 102
- `DISPENSES`: 192
