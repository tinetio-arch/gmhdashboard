# TASKS.md — AntiGravity Task Queue

> **Instructions**: Pick the highest priority pending task. Mark it 🔄 when starting, ✅ when done.
> Add new tasks at the bottom with the next number. Never delete completed tasks — they're your history.
>
> **Reference document**: `claude-code-ipad-improvements.md` (committed to repo root) — contains full implementation code for all tasks below.

---

## ⚠️ CRITICAL ERRATA — Read Before ANY Task

The reference prompt (`claude-code-ipad-improvements.md`) contains **systemic errors** that will break the build if followed verbatim. Apply these corrections to EVERY task:

### E1: File Paths — NO `src/` prefix
The prompt says `src/app/api/...`, `src/lib/...`, `src/migrations/...`. The **actual repo has NO `src/` prefix**.
- ❌ `src/app/api/prescriptions/...` → ✅ `app/api/prescriptions/...`
- ❌ `src/lib/healthie.ts` → ✅ `lib/healthie.ts`
- ❌ `src/migrations/...` → ✅ `migrations/...`

### E2: Healthie Client — Do NOT create `healthieQuery()`. Use the existing class.
The prompt creates a standalone `healthieQuery()` function. The repo already has:
- `lib/healthie.ts` — `HealthieClient` CLASS with `graphql()` method + rate limiter (`healthieRateLimiter` at 5 req/s with 429 backoff)
- `lib/healthieApi.ts` — `healthieGraphQL<T>()` standalone function (also rate-limited)
- The 360 route already uses `healthieGraphQL<T>()` for direct calls and `createHealthieClient` for class-based calls.
- **USE `healthieGraphQL<T>()` from `lib/healthieApi.ts`** — it already does everything the prompt's `healthieQuery()` tries to do.
- If you create a duplicate client, you **bypass the rate limiter** and risk a 30-60 minute IP ban from Healthie.

### E3: Auth Pattern — `requireApiUser` THROWS, never returns null
The prompt writes `if (!user) return 401`. In reality:
```typescript
// CORRECT pattern (used in 360, generate-note, and all existing routes):
try { await requireApiUser(request, 'read'); }
catch (error) {
    if (error instanceof UnauthorizedError)
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    throw error;
}
```
The `requireApiUser` function THROWS `UnauthorizedError` on failure — it never returns null. Any `if (!user)` check is dead code.

### E4: DB Query Returns — `query<T>()` returns `T[]` directly
The prompt's cache fallback uses `cached.rows.filter(...)`. The actual `query<T>()` function returns `T[]` directly (not `{ rows: T[] }`).
- ❌ `const result = await query(...); result.rows.filter(...)` → crash: "Cannot read property 'filter' of undefined"
- ✅ `const results = await query<MyType>(...); results.filter(...)`

### E5: Patient Healthie ID Column — `healthie_client_id`, not `healthie_id`
The prompt references `patient.healthie_id` and `WHERE healthie_id IS NOT NULL`. The actual column is:
- **DB column**: `patients.healthie_client_id` (VARCHAR 50, added by migration `20260108_add_clinic_and_healthie_columns.sql`)
- **iPad JS**: `chartPanelData.healthie_id` (mapped from `healthieChart?.healthie_id || local360?.demographics?.healthie_client_id`)
- **In API routes**: always use `patient.healthie_client_id` from the DB row.
- **In iPad app.js**: `chartPanelData.healthie_id` is correct (already mapped).

### E6: Dynamic Route Params — Must `await` params in Next.js 14.2
The prompt writes `{ params }: { params: { id: string } }`. Every route in the repo uses:
```typescript
{ params }: { params: Promise<{ id: string }> | { id: string } }
// ...
const resolvedParams = params instanceof Promise ? await params : params;
const { id } = resolvedParams;
```

### E7: CSS Variables — No `--surface-2`
The prompt references `var(--surface-2)`. This does NOT exist. Actual variables:
- `--bg: #0C141D` | `--surface: #111827` | `--card: #1F2937` | `--card-hover: #263347`
- `--cyan` / `--purple` / `--green` / `--red` / `--yellow` / `--orange`
- `--text-primary` / `--text-secondary` / `--text-tertiary`
- `--border` / `--border-light` / `--radius` / `--radius-sm` / `--radius-xs`

### E8: `refreshSession` Does Not Exist in `lib/auth.ts`
The prompt assumes `refreshSession()` is available. It is not exported from `lib/auth.ts`. Task 010 must implement session refresh from scratch using `createSession()` and cookie signing from the existing auth module.

### E9: Chart Panel Tab Pattern — `if/else` not `switch/case`
The prompt shows a `switch (tabName)` dispatch. The actual `renderChartTabContent()` function uses `if/else if`:
```javascript
if (window._chartTab === 'charting') { renderChartingTab(container, d); }
else if (window._chartTab === 'forms') { renderFormsTab(container, d); }
// etc.
```
The tab bar HTML uses `onclick="switchChartTab('...')"` with string-based dispatching. Add new tabs by:
1. Adding a `<button>` to the tab bar HTML in `renderChartPanel()`
2. Adding an `else if` clause in `renderChartTabContent()`

### E10: Scribe Route Uses Gemini, Not OpenAI
The generate-note route (`app/api/scribe/generate-note/route.ts`) calls **Gemini 2.0 Flash** via `GOOGLE_AI_API_KEY`. It does NOT use OpenAI. The prompt is built via `buildSoapPrompt()`. Medications should be injected into that function's context parameter, not added as a separate system message.

### E11: apiFetch Prefixes `/ops/` Not Needed
The prompt shows calls like `/ops/api/prescriptions/...`. In the actual iPad app, `apiFetch()` does NOT auto-prefix — the URL passed IS the full path. Existing calls already use `/ops/api/...` as the full URL. This is correct for the iPad app since it's served from `nowoptimal.com/ipad/` and the API is at `nowoptimal.com/ops/api/`.

---

## Priority Legend
- 🔴 **CRITICAL** — Blocking production or patient care
- 🟡 **HIGH** — Important feature or significant bug
- 🟢 **MEDIUM** — Improvement or non-blocking bug
- 🔵 **LOW** — Nice to have, tech debt cleanup

## Status Legend
- ⬜ **PENDING** — Not started
- 🔄 **IN PROGRESS** — Currently being worked on
- ✅ **DONE** — Completed (include date and summary)
- ❌ **BLOCKED** — Cannot proceed (include reason)

---

## Active Tasks

### Task 013 — 🔴 FIX: Patient 360 Route Timeout (labOrders fetches ALL org data)
- **Priority**: 🔴 CRITICAL — blocks patient detail loading on iPad
- **Status**: ⬜ PENDING
- **Phase**: Hotfix
- **Depends On**: None
- **Description**: The 360 route (`app/api/patients/[id]/360/route.ts`) hangs for 30+ seconds because its `labOrders` Healthie query fetches ALL lab orders for the entire organization (no patient filter), then filters client-side. This route also lacks `maxDuration` and runs its 3 Healthie calls sequentially instead of in parallel.
- **Root Cause**: Lines 200-221 — the `labOrders` GraphQL query has NO `patient_id` variable. It pulls thousands of records from Healthie.
- **Files**:
  - `app/api/patients/[id]/360/route.ts` — MODIFY (3 changes)

#### Change 1: DELETE the labOrders query block entirely (lines 197-234)
Remove this entire block:
```typescript
// Optional: fetch lab orders from Healthie if needed
// NOTE: Healthie labOrders doesn't accept patient_id filter ...
try {
    const labData = await healthieGraphQL<{...}>(`
        query GetPatientLabOrders {
            labOrders { ... }
        }
    `);
    healthieLabs = (labData.labOrders || [])
        .filter(lab => lab.patient?.id === healthieId)
        .map(lab => ({ ... }));
} catch (labErr) { ... }
```
The local Postgres `lab_review_queue` table (already queried at lines 98-103) provides the same data. `healthieLabs` stays as its initialized empty array `[]`.

#### Change 2: Add `maxDuration` after line 7
After `export const dynamic = 'force-dynamic';` add:
```typescript
export const maxDuration = 10;
```

#### Change 3: Parallelize the remaining 2 Healthie calls
Currently appointments (lines 155-195) and prescriptions (lines 236-288) run sequentially inside `if (healthieId)`. Wrap them in `Promise.allSettled`:

```typescript
if (healthieId) {
    const [appointmentResult, prescriptionResult] = await Promise.allSettled([
        // Appointments
        (async () => {
            const appointmentData = await healthieGraphQL<{
                appointments: Array<{
                    id: string;
                    date: string;
                    appointment_type?: { name?: string } | null;
                    provider?: { full_name?: string } | null;
                    pm_status?: string | null;
                    location?: string | null;
                    notes?: string | null;
                }>;
            }>(`
              query GetPatientAppointments($userId: ID, $offset: Int) {
                appointments(
                  user_id: $userId,
                  offset: $offset,
                  should_paginate: true,
                  filter: "all"
                ) {
                  id
                  date
                  appointment_type { name }
                  provider { full_name }
                  pm_status
                  location
                  notes
                }
              }
            `, { userId: healthieId, offset: 0 });
            return appointmentData.appointments || [];
        })(),
        // Prescriptions
        (async () => {
            const prescriptionData = await healthieGraphQL<{
                prescriptions: Array<{
                    id: string;
                    product_name?: string | null;
                    display_name?: string | null;
                    dosage?: string | null;
                    dose_form?: string | null;
                    directions?: string | null;
                    quantity?: string | null;
                    unit?: string | null;
                    refills?: number | null;
                    days_supply?: number | null;
                    normalized_status?: string | null;
                    schedule?: string | null;
                    date_written?: string | null;
                    last_fill_date?: string | null;
                    prescriber_name?: string | null;
                    pharmacy?: { name?: string; city?: string; state?: string } | null;
                }>;
            }>(`
              query GetPatientPrescriptions($patient_id: ID!) {
                prescriptions(patient_id: $patient_id, current_only: true) {
                  id product_name display_name dosage dose_form directions quantity unit
                  refills days_supply normalized_status schedule date_written last_fill_date
                  prescriber_name pharmacy { name city state }
                }
              }
            `, { patient_id: healthieId });
            return prescriptionData.prescriptions || [];
        })(),
    ]);

    healthieVisits = appointmentResult.status === 'fulfilled' ? appointmentResult.value : [];
    healthiePrescriptions = prescriptionResult.status === 'fulfilled' ? prescriptionResult.value : [];

    if (appointmentResult.status === 'rejected') {
        console.error(`[Patient360] Healthie visits failed for ${healthieId}:`, appointmentResult.reason);
    }
    if (prescriptionResult.status === 'rejected') {
        console.error(`[Patient360] Healthie prescriptions failed for ${healthieId}:`, prescriptionResult.reason);
    }
}
```

- **Acceptance Criteria**:
  - [ ] The `labOrders` query block is completely removed
  - [ ] `export const maxDuration = 10;` added after `export const dynamic`
  - [ ] Appointments and prescriptions run via `Promise.allSettled` (parallel)
  - [ ] `healthieLabs` remains `[]` (set from the initialized value)
  - [ ] The `labs.healthie_labs` field in the response is now always `[]` — this is acceptable because `labs.queue_items` (from local Postgres) has the data
  - [ ] Error logging preserved with `[Patient360]` prefix
  - [ ] Existing response shape unchanged (all fields still present)
  - [ ] Build passes: `npm run build`
- **Test After Deploy**:
  ```bash
  pm2 restart gmh-dashboard
  # Open iPad → Patients tab → click any patient → should load in <3 seconds
  # Open iPad → Today tab → click 📋 Chart → chart panel should open without hanging
  ```
- **Headless Command**: `claude -p "Read CLAUDE.md fully. Read TASKS.md Task 013 carefully — it has the exact code to use. Open app/api/patients/[id]/360/route.ts. Make exactly 3 changes: (1) Delete the labOrders query block (lines 197-234), (2) Add maxDuration=10 after line 7, (3) Wrap the remaining appointments + prescriptions Healthie calls in Promise.allSettled for parallel execution. Keep all types and error handling. Build with npm run build." --dangerously-skip-permissions --max-turns 15`
- **Completed**: _(date and brief summary when done)_

---

### Task 014 — 🔴 FIX: Regimen Auto-Fill (iPad regex + syringe default + dashboard placeholder)
- **Priority**: 🔴 CRITICAL — causes wrong dispense amounts if staff doesn't catch it
- **Status**: ⬜ PENDING
- **Phase**: Hotfix
- **Depends On**: None (can run in parallel with Task 013)
- **Description**: Two dispense forms have regimen auto-fill bugs:
  1. **iPad Quick Dispense**: Regex requires "ml"/"mL" suffix — fails on common regimens like "0.5 q4d". Neither form sets syringes to 1 when auto-filling.
  2. **Dashboard TransactionForm**: Regex works but syringe field stays empty with misleading placeholder "(e.g. 16)".
- **Files**:
  - `public/ipad/app.js` — MODIFY (3 small changes)
  - `app/inventory/TransactionForm.tsx` — MODIFY (2 small changes)

#### Fix A — iPad `public/ipad/app.js`

**Location**: `selectQuickDispensePatient` function (search for `function selectQuickDispensePatient`)

**Change 1**: Fix regex — make "ml" optional. Find:
```javascript
const match = regimen.match(/(\d+(?:\.\d+)?)\s*(?:ml|mL)/i);
```
Replace with:
```javascript
const match = regimen.match(/(\d+(?:\.\d+)?)\s*(?:ml|mL)?/i);
```
(Add `?` after the `(?:ml|mL)` group)

**Change 2**: Auto-set syringes to 1 when dose auto-fills. After the line:
```javascript
document.getElementById('qdDoseMl').value = regimenDose.toFixed(2);
```
Add:
```javascript
// FIX(2026-03-18): Auto-set syringes to 1 when regimen dose auto-fills
document.getElementById('qdSyringes').value = 1;
```

**Change 3**: Update the regimen info message. Change:
```javascript
regimenEl.innerHTML = `📋 Regimen: <strong>${sanitize(regimen)}</strong> — dose auto-filled to ${regimenDose} mL`;
```
To:
```javascript
regimenEl.innerHTML = `📋 Regimen: <strong>${sanitize(regimen)}</strong> — auto-filled: ${regimenDose} mL × 1 syringe`;
```

#### Fix B — Dashboard `app/inventory/TransactionForm.tsx`

**Change 1**: In `handlePatientSelect` function (search for `function handlePatientSelect`), after `setDosePerSyringe(regimenDose.toString());`, add syringe default:
```typescript
    if (regimenDose !== null && !dispenseEntireVial) {
      setDosePerSyringe(regimenDose.toString());
      // FIX(2026-03-18): Auto-set syringes to 1 when regimen dose auto-fills.
      // Prevents confusion from empty syringe field with misleading placeholder.
      if (!syringes) {
        setSyringes('1');
      }
    }
```

**Change 2**: Fix misleading placeholder. Search for:
```
placeholder="Total syringes (e.g. 16)"
```
Replace with:
```
placeholder="# of syringes (e.g. 1)"
```

- **Acceptance Criteria**:
  - [ ] iPad regex matches regimens without "ml" suffix (e.g., "0.5 q4d" → dose=0.5)
  - [ ] iPad auto-sets syringes to 1 when dose auto-fills from regimen
  - [ ] Dashboard auto-sets syringes to '1' when dose auto-fills AND syringes field is empty
  - [ ] Dashboard placeholder says "(e.g. 1)" not "(e.g. 16)"
  - [ ] Build passes: `npm run build`
- **Test After Deploy**:
  ```bash
  pm2 restart gmh-dashboard
  # iPad: Open Quick Dispense → search patient with regimen "0.5 q4d"
  #   → Dose should show 0.50, Syringes should show 1
  # Dashboard: Go to Inventory → Dispense → select patient with regimen "0.5 q4d"
  #   → Dose should show 0.5, Syringes should show 1
  ```
- **Headless Command**: `claude -p "Read CLAUDE.md fully. Read TASKS.md Task 014 carefully — it has exact find/replace instructions. Make 3 changes in public/ipad/app.js (in the selectQuickDispensePatient function): fix regex to make ml optional, add syringe auto-set to 1, update info message. Make 2 changes in app/inventory/TransactionForm.tsx: add syringe auto-set in handlePatientSelect, fix placeholder text. Build with npm run build." --dangerously-skip-permissions --max-turns 15`
- **Completed**: _(date and brief summary when done)_

---

### Task 001 — Prescription Cache Table Migration
- **Priority**: 🔴 CRITICAL
- **Status**: ⬜ PENDING
- **Phase**: 1 — Backend Foundation
- **Description**: Create the `prescription_cache` PostgreSQL table via a new migration file. This caches DoseSpot prescription data pulled through Healthie's GraphQL API.
- **⚠️ Errata Applied**: E1 (no `src/` prefix), E2 (do NOT create `healthieQuery()` — it already exists as `healthieGraphQL()` in `lib/healthieApi.ts`)
- **Files**:
  - `migrations/20260315_prescription_cache.sql` — CREATE new migration file
- **Acceptance Criteria**:
  - [ ] `prescription_cache` table created with all columns from the prompt's Phase 1 Section 1.2
  - [ ] ⚠️ Use `healthie_patient_id TEXT` (not `patient_id INT`) as the primary key/reference — the prompt's table schema is correct in structure
  - [ ] Unique constraint on `healthie_patient_id`
  - [ ] Indexes on `healthie_patient_id`, `normalized_status`
  - [ ] Migration runs cleanly (`psql -f migrations/20260315_prescription_cache.sql`)
- **Source Prompt Sections**: Phase 1, Section 1.2 ONLY (skip Section 1.1 — helper already exists)
- **Test Command**: `npx next build 2>&1 | tail -20`
- **Headless Command**: `claude -p "Read CLAUDE.md fully. Read TASKS.md — pay close attention to the ERRATA section at the top. Create migrations/20260315_prescription_cache.sql using the schema from claude-code-ipad-improvements.md Phase 1 Section 1.2. Do NOT create or modify lib/healthie.ts — the healthieGraphQL function already exists in lib/healthieApi.ts." --dangerously-skip-permissions --max-turns 15`
- **Notes**: The ERRATA section explains that `healthieQuery()` from the prompt = `healthieGraphQL()` which already exists. You ONLY need the migration file here. One file, one task.
- **Completed**: _(date and brief summary when done)_

---

### Task 002 — Prescription API Routes (3 Endpoints)
- **Priority**: 🔴 CRITICAL
- **Status**: ⬜ PENDING
- **Phase**: 1 — Backend Foundation
- **Depends On**: Task 001
- **Description**: Create three new API routes that fetch prescription data from Healthie/DoseSpot and return it for the iPad frontend.
- **⚠️ Errata Applied**: E1, E2, E3, E4, E5, E6
- **Files**:
  - `app/api/prescriptions/[patientId]/route.ts` — CREATE
  - `app/api/prescriptions/[patientId]/history/route.ts` — CREATE
  - `app/api/prescriptions/[patientId]/medications/route.ts` — CREATE
- **Acceptance Criteria**:
  - [ ] All routes use try/catch auth pattern: `try { await requireApiUser(request, 'read'); } catch (error) { if (error instanceof UnauthorizedError) return 401; throw error; }` **(E3)**
  - [ ] Import `{ healthieGraphQL }` from `@/lib/healthieApi` — NOT a new `healthieQuery` **(E2)**
  - [ ] Route params use Promise pattern: `{ params }: { params: Promise<{ patientId: string }> | { patientId: string } }` + `const resolvedParams = params instanceof Promise ? await params : params;` **(E6)**
  - [ ] Cache fallback queries use `query<T>()` which returns `T[]` directly — no `.rows` property **(E4)**
  - [ ] When looking up patient by healthie ID in DB, use column `healthie_client_id` **(E5)**
  - [ ] Build passes (`npx next build`)
- **Source Prompt Sections**: Phase 1, Section 1.3 — but apply ALL errata corrections
- **Test Command**: `npx next build 2>&1 | tail -20`
- **Headless Command**: `claude -p "Read CLAUDE.md fully. Read TASKS.md — pay close attention to the ERRATA section. Read lib/healthieApi.ts to understand the existing healthieGraphQL function. Read app/api/patients/[id]/360/route.ts for the correct auth pattern and params pattern. Then create the three prescription API routes in app/api/prescriptions/[patientId]/. Reference claude-code-ipad-improvements.md Phase 1 Section 1.3 for the GraphQL queries and business logic — but fix all paths (no src/ prefix), use healthieGraphQL instead of healthieQuery, use try/catch auth pattern, and use query<T>() returning T[] directly." --dangerously-skip-permissions --max-turns 20`
- **Notes**: Read the 360 route (`app/api/patients/[id]/360/route.ts`) as your reference pattern — it demonstrates every correct pattern in one file.
- **Completed**: _(date and brief summary when done)_

---

### Task 003 — Integrate Prescriptions into Patient 360 Response
- **Priority**: 🟡 HIGH
- **Status**: ⬜ PENDING
- **Phase**: 1 — Backend Foundation
- **Depends On**: Task 001
- **Description**: Modify the existing Patient 360 API route to include prescription/medication data. The 360 route already uses `healthieGraphQL()` for Healthie data — add prescription fetching alongside the existing appointment/lab queries.
- **⚠️ Errata Applied**: E2, E5
- **Files**:
  - `app/api/patients/[id]/360/route.ts` — MODIFY (additive only)
- **Acceptance Criteria**:
  - [ ] Uses `healthieGraphQL` (already imported) to fetch prescriptions — same as existing appointment/lab pattern
  - [ ] Patient's Healthie ID is `patient.healthie_client_id` (already used on line 145 as `healthieId`) **(E5)**
  - [ ] Prescription query added inside the `if (healthieId)` block alongside existing queries
  - [ ] Wrapped in its own try/catch (same pattern as existing appointment/lab queries at lines 147-227)
  - [ ] Added to the response object: `prescriptions: healthiePrescriptions`
  - [ ] Returns empty array on failure (graceful degradation)
  - [ ] Existing 360 response fields unchanged — additive only
  - [ ] Build passes (`npx next build`)
- **Source Prompt Sections**: Phase 1, Section 1.4
- **Test Command**: `npx next build 2>&1 | tail -20`
- **Headless Command**: `claude -p "Read CLAUDE.md fully. Read TASKS.md — pay close attention to ERRATA E2 and E5. Read app/api/patients/[id]/360/route.ts COMPLETELY first. It already imports healthieGraphQL, already has the patient healthie ID as healthieId (line 145), and already has the try/catch pattern for Healthie queries. Add a prescription fetch INSIDE the existing if(healthieId) block, wrapped in its own try/catch. Add prescriptions to the result object. Reference claude-code-ipad-improvements.md Phase 1 Section 1.4 for the GraphQL query." --dangerously-skip-permissions --max-turns 15`
- **Notes**: This file is 319 lines. Read it fully before modifying. The key insertion point is inside the `if (healthieId) { ... }` block (line 146). Follow the exact same try/catch + graceful fallback pattern used for appointments (lines 147-187) and labs (lines 192-226).
- **Completed**: _(date and brief summary when done)_

---

### Task 004 — Prescription Sync Cron Job
- **Priority**: 🟡 HIGH
- **Status**: ⬜ PENDING
- **Phase**: 1 — Backend Foundation
- **Depends On**: Tasks 001, 002
- **Description**: Create a cron route that periodically syncs prescription data from Healthie/DoseSpot into the `prescription_cache` table.
- **⚠️ Errata Applied**: E1, E2, E3, E4, E5
- **Files**:
  - `app/api/cron/sync-prescriptions/route.ts` — CREATE
- **Acceptance Criteria**:
  - [ ] Uses `x-cron-secret` header auth pattern (see CLAUDE.md Cron Routes section)
  - [ ] Fetches patients with `WHERE healthie_client_id IS NOT NULL AND healthie_client_id != ''` **(E5 — column is `healthie_client_id`, NOT `healthie_id`)**
  - [ ] `query<T>()` returns `T[]` directly — no `.rows` **(E4)**
  - [ ] Uses `healthieGraphQL` from `@/lib/healthieApi` **(E2)**
  - [ ] Upserts into `prescription_cache` using `ON CONFLICT`
  - [ ] Handles errors per-patient (one failure doesn't block others)
  - [ ] Build passes (`npx next build`)
- **Source Prompt Sections**: Phase 1, Section 1.5 — apply errata
- **Test Command**: `npx next build 2>&1 | tail -20`
- **Headless Command**: `claude -p "Read CLAUDE.md fully. Read TASKS.md — pay close attention to ERRATA E2, E4, E5. Create app/api/cron/sync-prescriptions/route.ts. The DB column for Healthie patient ID is healthie_client_id (not healthie_id). Use healthieGraphQL from lib/healthieApi.ts. query<T>() returns T[] directly. Reference claude-code-ipad-improvements.md Phase 1 Section 1.5 for logic — fix column names and imports." --dangerously-skip-permissions --max-turns 15`
- **Notes**: Process patients in batches of ~10 with delays between batches — the Healthie rate limiter allows 5 req/s but sustained bursts can trigger IP bans.
- **Completed**: _(date and brief summary when done)_

---

### Task 005 — Chart Panel Prescriptions Tab (Frontend)
- **Priority**: 🟡 HIGH
- **Status**: ⬜ PENDING
- **Phase**: 2 — Chart Panel UI
- **Depends On**: Tasks 002, 003
- **Description**: Add a "Prescriptions" tab to the iPad chart panel's tab bar and create the rendering function.
- **⚠️ Errata Applied**: E7, E9, E11
- **Files**:
  - `public/ipad/app.js` — MODIFY: add tab button + `renderPrescriptionsTab()` + dispatch
- **Acceptance Criteria**:
  - [ ] Tab button added to `renderChartPanel()` tab bar HTML (around line 3637, after the Dispense Hx button)
  - [ ] `else if (window._chartTab === 'prescriptions') { renderPrescriptionsTab(container, d); }` added to `renderChartTabContent()` (around line 3675) **(E9 — if/else, not switch/case)**
  - [ ] Tab fetches from `/ops/api/prescriptions/{healthieId}` using `apiFetch()` **(E11 — full path)**
  - [ ] Uses `chartPanelData.healthie_id` for the patient's Healthie ID (already mapped in app.js line 3411)
  - [ ] CSS uses existing variables only: `--card`, `--surface`, `--border`, `--text-primary`, etc. **(E7 — no `--surface-2`)**
  - [ ] Shows loading spinner, empty state, and error state
- **Source Prompt Sections**: Phase 2, Section 2.1 — fix CSS variables and tab dispatch pattern
- **Test Command**: `npx next build 2>&1 | tail -20`
- **Headless Command**: `claude -p "Read CLAUDE.md fully. Read TASKS.md — pay close attention to ERRATA E7, E9, E11. Read public/ipad/app.js — find renderChartPanel (line ~3434), the tab bar HTML (line ~3631), switchChartTab (line ~3645), and renderChartTabContent (line ~3660). Add a Prescriptions tab button and renderPrescriptionsTab function following the exact same if/else pattern used for existing tabs. Use healthieId from chartPanelData.healthie_id. CSS var --surface-2 does NOT exist — use --surface or --card. Reference claude-code-ipad-improvements.md Phase 2 Section 2.1 for the tab rendering code — fix CSS variables." --dangerously-skip-permissions --max-turns 20`
- **Notes**: The iPad app is 7,820 lines of vanilla JS. Tab dispatch is if/else (line 3665-3675), not switch/case. The tab bar buttons are in an HTML template literal inside `renderChartPanel()` (line 3631-3638). Follow the existing pattern exactly.
- **Completed**: _(date and brief summary when done)_

---

### Task 006 — Controlled Substance Alerts + Medications Section Upgrade
- **Priority**: 🟡 HIGH
- **Status**: ⬜ PENDING
- **Phase**: 2 — Chart Panel UI
- **Depends On**: Task 005
- **Description**: Add controlled substance schedule badges to prescription cards and upgrade the medications section with richer data.
- **⚠️ Errata Applied**: E7
- **Files**:
  - `public/ipad/app.js` — MODIFY
  - `public/ipad/style.css` — MODIFY
- **Acceptance Criteria**:
  - [ ] Schedule badges: II = red (`--red`), III = orange (`--orange`), IV = yellow (`--yellow`) **(E7 — use actual CSS vars)**
  - [ ] No `--surface-2` — use `--surface` or `--card` for backgrounds **(E7)**
  - [ ] Medications section shows last fill date and refill status
  - [ ] Build passes (`npx next build`)
- **Source Prompt Sections**: Phase 2, Sections 2.2 and 2.3 — fix CSS variables
- **Test Command**: `npx next build 2>&1 | tail -20`
- **Headless Command**: `claude -p "Read CLAUDE.md fully. Read TASKS.md — pay close attention to ERRATA E7. Read public/ipad/style.css :root block (lines 16-47) to see actual CSS variables. Add controlled substance badges and medications upgrades to public/ipad/app.js. Add CSS to public/ipad/style.css using ONLY existing variables. Reference claude-code-ipad-improvements.md Phase 2 Sections 2.2-2.3 — replace any --surface-2 with --surface or --card." --dangerously-skip-permissions --max-turns 20`
- **Notes**: Read the `:root` block in `style.css` (lines 16-47) for all available CSS variables before writing any styles.
- **Completed**: _(date and brief summary when done)_

---

### Task 007 — Patient 360 Inline Sections (Allergies, Diagnoses, Medications, Rx Summary)
- **Priority**: 🟢 MEDIUM
- **Status**: ⬜ PENDING
- **Phase**: 3 — Patient 360 Inline
- **Depends On**: Tasks 003, 005
- **Description**: Add collapsible inline summary sections to the Patient 360 view on the iPad.
- **⚠️ Errata Applied**: E7
- **Files**:
  - `public/ipad/app.js` — MODIFY
- **Acceptance Criteria**:
  - [ ] Allergies, diagnoses, medications, and recent prescriptions sections rendered
  - [ ] Collapsible with tap-to-toggle
  - [ ] Uses existing CSS variables **(E7)**
  - [ ] Data comes from the 360 response (modified in Task 003)
  - [ ] Build passes (`npx next build`)
- **Source Prompt Sections**: Phase 3, Section 3.1
- **Test Command**: `npx next build 2>&1 | tail -20`
- **Headless Command**: `claude -p "Read CLAUDE.md fully. Read TASKS.md — pay close attention to ERRATA E7. Read public/ipad/app.js — find where Patient 360 data is rendered. Add collapsible inline sections. Reference claude-code-ipad-improvements.md Phase 3 Section 3.1 — fix CSS variables." --dangerously-skip-permissions --max-turns 20`
- **Completed**: _(date and brief summary when done)_

---

### Task 008 — Inject Medications into SOAP Note Generation (Scribe)
- **Priority**: 🟡 HIGH
- **Status**: ⬜ PENDING
- **Phase**: 4 — Scribe Integration
- **Depends On**: Tasks 002, 003
- **Description**: Add current medications to the AI scribe's SOAP note generation context.
- **⚠️ Errata Applied**: E10, E3
- **Files**:
  - `public/ipad/app.js` — MODIFY: send medications with generate-note request
  - `app/api/scribe/generate-note/route.ts` — MODIFY: inject medications into `buildSoapPrompt()`
- **Acceptance Criteria**:
  - [ ] Frontend sends `medications` array in the POST body to generate-note
  - [ ] Backend `buildSoapPrompt()` function (line 13) accepts a new `medications` param and includes it in the prompt **(E10 — this is a Gemini prompt, not OpenAI)**
  - [ ] If no medications provided, prompt works exactly as before (backwards compatible)
  - [ ] The scribe already fetches `recentMeds` and `recentTrt` from the DB (lines 235-248) — merge new medications alongside
  - [ ] Build passes (`npx next build`)
- **Source Prompt Sections**: Phase 4, Section 4.1
- **Test Command**: `npx next build 2>&1 | tail -20`
- **Headless Command**: `claude -p "Read CLAUDE.md fully. Read TASKS.md — pay close attention to ERRATA E10. Read app/api/scribe/generate-note/route.ts COMPLETELY — it uses Gemini 2.0 Flash (not OpenAI), builds prompts via buildSoapPrompt(), and already fetches recentMeds/recentTrt from the DB. Add a medications parameter to buildSoapPrompt and inject from the request body. Reference claude-code-ipad-improvements.md Phase 4 Section 4.1 for logic." --dangerously-skip-permissions --max-turns 15`
- **Notes**: The generate-note route is 396 lines. Read it fully. The prompt is constructed by `buildSoapPrompt()` (line 13). The medication data should be added to the context object that `buildSoapPrompt` receives, formatted as a string section within the existing prompt.
- **Completed**: _(date and brief summary when done)_

---

### Task 009 — Bug Fixes: Button Labels, Trailing Slash, DEA Modal, Search Threshold
- **Priority**: 🟢 MEDIUM
- **Status**: ⬜ PENDING
- **Phase**: 5 — Bug Fixes & Polish
- **Depends On**: None (independent)
- **Description**: Fix four small bugs in the iPad app.
- **Files**:
  - `public/ipad/app.js` — MODIFY
- **Acceptance Criteria**:
  - [ ] No buttons display "undefined" as label text
  - [ ] API URLs end with `/` where needed
  - [ ] DEA modal closes on outside click and Escape
  - [ ] Patient search only fires after 2+ characters
  - [ ] Build passes (`npx next build`)
- **Source Prompt Sections**: Phase 5, Sections 5.1–5.4
- **Test Command**: `npx next build 2>&1 | tail -20`
- **Headless Command**: `claude -p "Read CLAUDE.md fully. Read TASKS.md. Read public/ipad/app.js. Fix four bugs: (1) undefined button labels, (2) missing trailing slashes in API URLs, (3) DEA modal not closing, (4) search firing on every keystroke. Reference claude-code-ipad-improvements.md Phase 5 Sections 5.1-5.4." --dangerously-skip-permissions --max-turns 15`
- **Notes**: Independent — can run in parallel with any backend task.
- **Completed**: _(date and brief summary when done)_

---

### Task 010 — Session Auto-Refresh + Auth CSS Polish
- **Priority**: 🟢 MEDIUM
- **Status**: ⬜ PENDING
- **Phase**: 5 — Bug Fixes & Polish
- **Depends On**: None (independent)
- **Description**: Add silent session auto-refresh for long clinic days and polish the auth UI.
- **⚠️ Errata Applied**: E1, E3, E8
- **Files**:
  - `app/api/auth/refresh/route.ts` — CREATE
  - `public/ipad/app.js` — MODIFY
  - `public/ipad/style.css` — MODIFY
- **Acceptance Criteria**:
  - [ ] Refresh endpoint validates current session, creates new one via `createSession()`, sets cookie via `setSessionCookie()` **(E8 — `refreshSession()` does NOT exist; build from `createSession` + `setSessionCookie`)**
  - [ ] Auth pattern uses try/catch on `requireApiUser` **(E3)**
  - [ ] Frontend sets 10-hour refresh interval
  - [ ] Auth overlay styled with existing CSS variables **(E7)**
  - [ ] Build passes (`npx next build`)
- **Source Prompt Sections**: Phase 5, Sections 5.5–5.6 — but `refreshSession()` must be built from existing auth primitives
- **Test Command**: `npx next build 2>&1 | tail -20`
- **Headless Command**: `claude -p "Read CLAUDE.md fully. Read TASKS.md — pay close attention to ERRATA E3 and E8. Read lib/auth.ts COMPLETELY to understand the session system. The function refreshSession() does NOT exist — you must build the refresh endpoint using createSession(), setSessionCookie(), and requireApiUser. Create app/api/auth/refresh/route.ts. Add auto-refresh timer to public/ipad/app.js. Add auth CSS to public/ipad/style.css. Reference claude-code-ipad-improvements.md Phase 5 Sections 5.5-5.6 for logic." --dangerously-skip-permissions --max-turns 20`
- **Notes**: Read `lib/auth.ts` fully — it exports `createSession()` (line 204), `setSessionCookie()` (line 270), and `requireApiUser()` (line 322). The refresh route should: validate current session → get user → create new session → set new cookie → return success.
- **Completed**: _(date and brief summary when done)_

---

### Task 011 — DoseSpot iFrame URL API Route
- **Priority**: 🟢 MEDIUM
- **Status**: ⬜ PENDING
- **Phase**: 6 — DoseSpot E-Prescribing iFrame
- **Depends On**: None (uses existing healthieGraphQL)
- **Description**: Create an API route that generates authenticated DoseSpot iFrame URLs via Healthie's GraphQL API.
- **⚠️ Errata Applied**: E1, E2, E3, E6
- **Files**:
  - `app/api/prescriptions/[patientId]/iframe-url/route.ts` — CREATE
- **Acceptance Criteria**:
  - [ ] Uses `healthieGraphQL` from `@/lib/healthieApi` **(E2)**
  - [ ] Auth: try/catch `requireApiUser(request, 'write')` **(E3)**
  - [ ] Params: Promise pattern with await **(E6)**
  - [ ] Returns `{ url: 'https://...' }` on success
  - [ ] No caching (URLs are short-lived)
  - [ ] Build passes (`npx next build`)
- **Source Prompt Sections**: Phase 6, Section 6.1
- **Test Command**: `npx next build 2>&1 | tail -20`
- **Headless Command**: `claude -p "Read CLAUDE.md fully. Read TASKS.md — pay close attention to ERRATA E2, E3, E6. Create app/api/prescriptions/[patientId]/iframe-url/route.ts. Use healthieGraphQL from lib/healthieApi.ts. Use try/catch auth pattern. Use Promise params pattern. Reference claude-code-ipad-improvements.md Phase 6 Section 6.1." --dangerously-skip-permissions --max-turns 15`
- **Completed**: _(date and brief summary when done)_

---

### Task 012 — E-Rx Tab, Fullscreen Modal, Prescribe Button (Frontend)
- **Priority**: 🟢 MEDIUM
- **Status**: ⬜ PENDING
- **Phase**: 6 — DoseSpot E-Prescribing iFrame
- **Depends On**: Tasks 005, 011
- **Description**: Add e-prescribing UI to the iPad: E-Rx tab, fullscreen modal, and Prescribe button.
- **⚠️ Errata Applied**: E7, E9
- **Files**:
  - `public/ipad/app.js` — MODIFY
  - `public/ipad/style.css` — MODIFY
- **Acceptance Criteria**:
  - [ ] E-Rx tab added with if/else dispatch **(E9)**
  - [ ] CSS uses existing variables only **(E7)**
  - [ ] Modal works on iPad Safari (`position: fixed` + `inset: 0`)
  - [ ] Build passes (`npx next build`)
- **Source Prompt Sections**: Phase 6, Sections 6.2–6.4
- **Test Command**: `npx next build 2>&1 | tail -20`
- **Headless Command**: `claude -p "Read CLAUDE.md fully. Read TASKS.md — pay close attention to ERRATA E7, E9. Read public/ipad/app.js — find the chart panel tabs. Add E-Rx tab and fullscreen DoseSpot modal. Use if/else dispatch pattern (not switch/case). CSS vars: --surface-2 does NOT exist. Reference claude-code-ipad-improvements.md Phase 6 Sections 6.2-6.4." --dangerously-skip-permissions --max-turns 20`
- **Completed**: _(date and brief summary when done)_

---

## Dependency Graph

```
Task 001 (DB Migration)
  ├── Task 002 (Rx API Routes) ──┬── Task 004 (Sync Cron)
  │                               ├── Task 005 (Rx Tab) ──── Task 006 (Alerts + Meds)
  │                               │                     └── Task 012 (E-Rx Tab)
  │                               └── Task 008 (Scribe)
  ├── Task 003 (360 Integration) ── Task 007 (360 Inline Sections)
  └── Task 011 (iFrame URL Route) ── Task 012 (E-Rx Tab)

Task 009 (Bug Fixes) ── independent, run anytime
Task 010 (Session Refresh) ── independent, run anytime
```

## Execution Order (Recommended)

| Order | Task | Can Parallelize With |
|-------|------|---------------------|
| **1** | **013 (HOTFIX: 360 Timeout)** | **014** |
| **2** | **014 (HOTFIX: Regimen Auto-Fill)** | **013** |
| 3     | 001  | 009, 010            |
| 4     | 002  | 003, 009, 010       |
| 5     | 003  | 002, 009, 010       |
| 6     | 004  | 005, 009, 010       |
| 7     | 005  | 004, 011            |
| 8     | 006  | 011                 |
| 9     | 007  | 008, 011            |
| 10    | 008  | 007, 011            |
| 11    | 011  | 007, 008            |
| 12    | 012  | —                   |

Tasks 009 and 010 are independent bug fixes — run them anytime, even first.

---

## Completed Tasks

_(Move completed tasks here to keep the active section clean)_

---

## How Perplexity Adds Tasks

Perplexity Computer writes task specs here with full context:
- Exact files to modify
- Code patterns to follow (referencing CLAUDE.md)
- Database schema if relevant
- API contracts (request/response shapes)
- Test commands to verify

AntiGravity picks them up, implements, and marks done.

---

*This file is the shared handoff point between Perplexity (research/planning) and AntiGravity (implementation).*
