# 28 — Hardening Plan v3 (verified against reality)

> **Status:** Verified rewrite of [`28-hardening-plan-v2.md`](./28-hardening-plan-v2.md) after audit ([`28-hardening-plan-v2-audit.md`](./28-hardening-plan-v2-audit.md)) flagged ~half the v2 specs as inaccurate. Every claim in v3 was checked against the live database, the live `lib/` modules, and the existing cron inventory.
>
> **Drafted:** 2026-04-24 (Phil + Claude verification pass)
>
> **Replaces v2.** v2 stays in repo for diff/history but is no longer the operating doc. Treat v3 as canonical.

---

## What changed from v2 (read this first)

| Topic | v2 said | Reality | Impact |
|---|---|---|---|
| `patient_id` type | `INTEGER` in every migration block | **`uuid`** (DEFAULT `uuid_generate_v4()`) | Every Phase 1/4/5/7/8/9 migration was wrong. v3 corrects all SQL. |
| `billing_source` column (Phase 3) | Add new enum column | `client_type_key` already encodes this (FK to `client_type_lookup`, 18 values incl. `approved_disc_pro_bono_pt`) | Phase 3 simplified — no new column. Auto-classification writes `client_type_key`. |
| Healthie recurring query (Phase 9) | `recurringPayments(user_id)` only | **Two valid paths.** `lib/healthie.ts:1043` `getClientSubscriptions(clientId)` uses `billingItems` with embedded `recurring_payment`. Top-level `recurringPayments(user_id)` query also works (Phil-validated 2026-04-24, per memory pin). The code comment "User.recurring_payments does NOT exist" refers to the User-type field, NOT the top-level query. | Phase 9 uses `getClientSubscriptions` for codebase consistency. Memory pin clarified (not deleted) to document both paths. |
| Email infrastructure (Phase 9) | "Use existing notifications layer (Postmark/SendGrid)" | **AWS SES already wired** in `lib/notifications.ts` (inventory) + `lib/messaging.ts` (patient broadcast via `SendEmailCommand`) | Phase 9 uses SES directly. No new vendor needed. |
| `lib/ghl.ts` build delta (Phase 6) | "Build typed helpers `sendSms/sendEmail/createTask/applyTag` from scratch" | `sendSms` already exists at `lib/ghl.ts` ~289. 4 location factories already exist (`createGHLClientForMensHealth/PrimaryCare/ABXTAC/Longevity`). `getGHLClientForPatient(clinic, clientType)` at line 942 already does routing. | Phase 6 narrowed: build `sendEmail`, `createTask`, `applyTag` + `ghl_send_log` table + dry-run wrapper. Don't rebuild what's there. |
| Status_key writers (Phase 1) | Guard at API layer | **16 distinct writers**, mostly outside `app/api/`. Highest-volume is `scripts/process-healthie-webhooks.ts` (lines 322, 455, 468, 690, 1011, 1031). Existing protection at `lib/patientQueries.ts:686` already blocks `inactive → anything`. | Phase 1 rewritten: guard wraps the webhook processor, dedupes with existing protection, focuses on transitions TO `inactive` and FROM `hold_payment_research`. |
| Jane / QBO legacy IDs (Phase 5) | "Preserve and migrate" | **0/459** patients have `jane_id`. **0/459** have `qbo_customer_id`. | Phase 5 downscoped — migration tracker only for cohort identifiable from Healthie/Stripe/manual list, not from preserved IDs. |
| `healthie_group_id` population (Phase 8 care-line derivation) | Derive care line from `patients.healthie_groups` | Column exists but only **4/459** patients have it set | Phase 8 care-line derivation falls back to `client_type_key` until backfill ships. Backfill becomes a Phase 8 sub-step. |
| Status canonicalization scope (Phase 1) | Reason about all 8 status values | Only **4** have any production patients: active (348), inactive (59), active_pending (47), hold_payment_research (5). Other 4 lookup values exist but unused. | Phase 1 ships with full 8-value support but tests focus on the 4 active-use values. |
| `clinic` column population | 5 enum values, all in use | `nowmenshealth.care` (279), `nowprimary.care` (31), **NULL (149)**. Mental Health, Longevity, ABXTac all zero in `clinic` column despite being in CHECK constraint. | Phase 3/Phase 6.5 stop relying on `clinic` for routing. Use `client_type_key` + `healthie_group_id` instead. |
| SOT module 23 (Jessica/Max GHL agents) | Referenced as authoritative | File is mis-titled — contains brand color tables, NOT GHL agent docs | Phase 6 prerequisite. Module 23 needs a separate doc-rebuild before Phase 6 can ship. Tracked in v3 Open Questions. |
| Existing reconciliation crons | Phase 9 builds new recon | `patient-reconciliation`, `healthie-id-audit`, `morning-prep` already exist and touch overlapping tables | Phase 9 consumes outputs from these crons rather than duplicating their logic. |

**TL;DR for skimmers:**
- v2 invented columns that already exist (`status_key`, `service_start_date`, would-have-been `billing_source`).
- v2 used `INTEGER patient_id` everywhere — every migration block was wrong.
- v2 specced rebuilds of code that already works (`sendSms`, location-routed GHL clients, SES email).
- v3 keeps every architectural decision from Phil's 2026-04-24 hardening session intact, but corrects the implementation surface to match the codebase.

---

## Locked decisions (carried from `project_hardening_plan_decisions.md` 2026-04-24)

| # | Decision | Source |
|---|---|---|
| 1 | Healthie is SOT for membership/recurring billing | `feedback_healthie_source_of_truth.md` |
| 2 | `client_type_key='approved_disc_pro_bono_pt'` is the pro-bono flag (already in lookup) | DB query 2026-04-24 |
| 3 | Recon email goes to `admin@granitemountainhealth.com` only | `project_hardening_plan_decisions.md` |
| 4 | Phases 1 + 4 ship first | same |
| 5 | One workflow per channel — Send SMS / Send Email / Create Task / Apply Tag — branching in code, not GHL nodes | `feedback_ghl_workflow_pattern.md` |
| 6 | Inactive transition NEVER auto-flips. Human-only flip. | `feedback_critical_rules.md` + existing `lib/patientQueries.ts:691` guard |
| 7 | Auto-classification mechanical (Phase 3) — never overrides human-set status | This doc |

---

## Recommended sequence (revised)

| Order | Phase | Why this slot | Dependencies |
|---|---|---|---|
| 1 | **Phase 1** (Inactive Safety) | Tiny, high-risk-reducing, blocks accidental churn during rollout | None |
| 2 | **Phase 2** (GHL Disable) | Parallel — pure config change, immediate noise reduction | None |
| 3 | **Phase 3** (Auto-Classification) | Unlocks Phase 4, 5, 9 with consistent classification | Phase 1 (so reclassification doesn't fight inactive guards) |
| 4 | **Phase 5** (Migration Tracker) | Once Phase 3 produces classification data, identifies legacy cohort | Phase 3 |
| 5 | **Phase 4** (No Man's Land Queue) | Closes Stage 4→5 manual handoff | Phase 3 |
| 6 | **SOT Module 23 rebuild** (prerequisite) | Module 23 is broken; Phase 6 can't safely run without it | None — can run in parallel with 1-5 |
| 7 | **Phase 6** (GHL Rebuild) | Wires nudges from Phase 4, builds the channel infra | Module 23 rebuild + Phase 2 |
| 8 | **Phase 6.5** (Unified Entry Handler) | Funnels new patients into Phase 4 + Phase 7 schemas | Phase 4 + Phase 7 schemas |
| 9 | **Phase 7** (Lead Source) | Marketing attribution unlock | Phase 6.5 (entry handler is the writer) |
| 10 | **Phase 9** (Billing Recon Email) | Surfaces Phase 1/3/5 health weekly | Phase 3 + Phase 5 |
| 11 | **Phase 8** (At-Risk Cron) | Last — depends on Phil's clinical thresholds | Phase 1 (inactive guard); existing morning-prep signals |

**Estimate:** 5–6 weeks active engineering. Wall-clock 7–8 weeks due to Phil-review gates (dry-runs, template approvals, threshold setting).

---

## Phase 1 — Inactive Safety + status_key Audit Trail

**One-line goal:** make every transition into `'inactive'` (and out of `'hold_payment_research'`) traceable, deduped against the existing `lib/patientQueries.ts:691` guard, and visible in a single audit log so Phil can answer "who marked this patient inactive and why?" in <30 seconds.

### Why this phase (corrected from v2)

v2 framed Phase 1 as "add an inactive guard at the API layer." Reality:

- **The guard already partially exists.** `lib/patientQueries.ts:686-691` blocks `inactive → anything else` reactivation. Phase 1 must NOT duplicate this — it complements.
- **The real risk surface is the webhook processor**, not the API. `scripts/process-healthie-webhooks.ts` writes `status_key` at lines 322 (active recovery), 455/468/690/1011/1031 (`hold_payment_research`). These are autonomous, fast, and have no audit trail today.
- **No status_key audit log exists.** When a patient flips to `inactive`, there is no record of who/what/when/why. This is the actual bug.

The v3 phase fixes the audit gap, wraps the webhook writer with a transition validator, and surfaces transitions on the dashboard.

### Architectural design

#### Single chokepoint helper

```typescript
// lib/status-transitions.ts (NEW)

import { query } from '@/lib/db';
import type { StatusKey } from '@/lib/types';

export interface StatusTransitionInput {
  patientId: string;            // UUID
  fromStatus: StatusKey | null; // null = unknown / no prior read
  toStatus: StatusKey;
  source: 'webhook' | 'admin_api' | 'cron' | 'manual_script' | 'merge';
  sourceDetail: string;         // e.g., 'process-healthie-webhooks.ts:322:payment_received'
  reason: string;               // human-readable
  actorUserId?: number | null;  // null for system writes
  externalRef?: string | null;  // e.g., Healthie webhook event id
}

export async function transitionStatus(input: StatusTransitionInput): Promise<{
  applied: boolean;
  blocked?: 'no_op' | 'reactivation_blocked' | 'no_clinical_outreach' | 'guard_failed';
  newStatus: StatusKey;
}> {
  // 1. Read current status under transaction
  // 2. If from === to → no_op (don't write, don't audit, return)
  // 3. If current === 'inactive' AND target !== 'inactive' AND source !== 'admin_api' → blocked: reactivation_blocked
  //    (preserves existing patientQueries.ts:691 behavior with audit trail)
  // 4. If target === 'inactive' AND source === 'webhook' → blocked (webhooks NEVER auto-inactive)
  // 5. UPDATE patients SET status_key = $1, status_key_updated_at = NOW() WHERE patient_id = $2
  // 6. INSERT INTO patient_status_audit (...)
  // 7. Return applied: true
}
```

Every status_key write goes through `transitionStatus()`. Direct `UPDATE patients SET status_key = …` becomes a code-review-blocked anti-pattern.

#### Migration to single chokepoint

| Caller | Current line | Migration |
|---|---|---|
| `app/api/admin/membership-audit/resolve-duplicate/route.ts:102` | direct UPDATE → 'inactive' | wrap in `transitionStatus({ source: 'merge', ... })` |
| `app/api/admin/patients/merge/route.ts:231, 261` | direct UPDATE → 'inactive' | wrap in `transitionStatus({ source: 'merge', ... })` |
| `scripts/merge-duplicate-patients.ts:38` | direct UPDATE → 'inactive' | wrap in `transitionStatus({ source: 'manual_script', ... })` |
| `scripts/resolve_sandy_payment.js:54` | UPDATE → 'active' | wrap |
| `scripts/daily-payment-check.js:132` | dynamic UPDATE | wrap |
| `scripts/fix-payment-hold-patients.ts:136` | UPDATE → 'active' | wrap |
| `scripts/fix-holds-now.js:22` | UPDATE → 'active' | wrap |
| `scripts/process-healthie-webhooks.ts:322, 455, 468, 690, 1011, 1031` | UPDATE → 'active' or 'hold_payment_research' | wrap; hardest because runs at high frequency |
| `scripts/sync-healthie-failed-payments.ts:256, 275` | UPDATE → 'hold_payment_research' or 'active' | wrap |
| `scripts/startup-payment-sync.ts:191, 214, 298, 319` | UPDATE → 'hold_payment_research' | wrap |
| `scripts/process-unpaid-payments.ts:85` | UPDATE → 'hold_payment_research' | wrap |

16 sites total. Each migration is a 5-line change. Can be done incrementally — the helper can co-exist with direct writes during rollout.

#### Audit table

```sql
-- migrations/2026XXXX_status_audit.sql

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS status_key_updated_at TIMESTAMPTZ;
-- (status_key column already exists; this just adds the timestamp companion)

CREATE TABLE patient_status_audit (
  id BIGSERIAL PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(patient_id),
  from_status TEXT REFERENCES patient_status_lookup(status_key),
  to_status TEXT NOT NULL REFERENCES patient_status_lookup(status_key),
  source TEXT NOT NULL,            -- 'webhook' | 'admin_api' | 'cron' | 'manual_script' | 'merge'
  source_detail TEXT,              -- e.g., 'process-healthie-webhooks.ts:322:payment_received'
  reason TEXT,
  actor_user_id INTEGER REFERENCES users(id),
  external_ref TEXT,               -- Healthie event id, Stripe event id, etc.
  was_blocked BOOLEAN DEFAULT false,
  block_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_status_audit_patient ON patient_status_audit(patient_id, created_at DESC);
CREATE INDEX idx_status_audit_to_status ON patient_status_audit(to_status, created_at DESC);
CREATE INDEX idx_status_audit_blocked ON patient_status_audit(was_blocked, created_at DESC) WHERE was_blocked = true;
```

Note: `patient_id UUID NOT NULL REFERENCES patients(patient_id)` — UUID, not integer. Every Phase 1 schema reference is corrected.

`patient_status_lookup` already FK-enforces values, so `to_status TEXT REFERENCES patient_status_lookup(status_key)` reuses the existing constraint.

#### Webhook processor wrap (highest-risk integration)

`scripts/process-healthie-webhooks.ts` is a long-running PM2 process. The 6 status_key writers all share the same shape:

```typescript
// BEFORE (line 322 example)
await client.query(
  `UPDATE patients SET status_key = 'active' WHERE patient_id = $1`,
  [patientId]
);

// AFTER
await transitionStatus({
  patientId,
  fromStatus: currentStatus,  // we already read this above
  toStatus: 'active',
  source: 'webhook',
  sourceDetail: 'process-healthie-webhooks:payment_received',
  reason: `Healthie payment received for invoice ${invoiceId}`,
  externalRef: webhookEventId,
});
```

Key safety property: webhooks can NEVER set `to_status = 'inactive'` (helper enforces). This is hard-coded in the helper, not configurable per call site.

#### Dashboard view: recent inactive transitions

New page `/admin/status-audit` (admin-role gate):

```
RECENT STATUS TRANSITIONS              Last 30 days
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Filters: status, source, date range, actor]

Date          Patient     From        To          Source       Reason            Actor
2026-04-23    [P abc123]  active      inactive    merge        duplicate of...   admin@gmh
2026-04-23    [P def456]  hold_pay…   active      webhook      payment received  system
2026-04-22    [P ghi789]  active_p…   active      cron         service started   system
...

[Blocked transitions: 3 in last 30 days — view]
```

iPad CEO widget: counts only.

```
STATUS ACTIVITY (7d)
─────────────────
Inactive flips:        2  (both manual)
Recoveries:           14  (payment received)
Blocked attempts:      0  ✓
```

Pull into `loadDashboard()` per dashboard mapping pin.

### Database schema changes

```sql
-- migrations/2026XXXX_status_audit.sql (full)

-- 1. Status timestamp companion
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS status_key_updated_at TIMESTAMPTZ;

-- 2. Audit table
CREATE TABLE patient_status_audit (
  id BIGSERIAL PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(patient_id),
  from_status TEXT REFERENCES patient_status_lookup(status_key),
  to_status TEXT NOT NULL REFERENCES patient_status_lookup(status_key),
  source TEXT NOT NULL CHECK (source IN ('webhook', 'admin_api', 'cron', 'manual_script', 'merge')),
  source_detail TEXT,
  reason TEXT,
  actor_user_id INTEGER REFERENCES users(id),
  external_ref TEXT,
  was_blocked BOOLEAN DEFAULT false,
  block_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_status_audit_patient ON patient_status_audit(patient_id, created_at DESC);
CREATE INDEX idx_status_audit_to_status ON patient_status_audit(to_status, created_at DESC);
CREATE INDEX idx_status_audit_blocked ON patient_status_audit(was_blocked, created_at DESC) WHERE was_blocked = true;

-- 3. Backfill status_key_updated_at from existing data (best-effort: NULL → updated_at)
UPDATE patients SET status_key_updated_at = updated_at WHERE status_key_updated_at IS NULL;
```

NO `status_key` column added (already exists). NO `service_start_date` (already exists). NO new lookup table (`patient_status_lookup` already has 8 values, sufficient).

### Per-path code changes

| File | Change | Notes |
|---|---|---|
| `migrations/2026XXXX_status_audit.sql` | NEW | UUID FK, reuses existing lookups |
| `lib/status-transitions.ts` | NEW | Single chokepoint helper |
| `lib/types.ts` | MODIFY | Export `StatusKey` union type if not already |
| `lib/patientQueries.ts:686-691` | MODIFY | Replace existing inline guard with call to `transitionStatus()` (preserves behavior, adds audit) |
| `app/api/admin/membership-audit/resolve-duplicate/route.ts` | MODIFY | Line 102 → use helper |
| `app/api/admin/patients/merge/route.ts` | MODIFY | Lines 231, 261 → use helper |
| `scripts/merge-duplicate-patients.ts` | MODIFY | Line 38 → use helper |
| `scripts/process-healthie-webhooks.ts` | MODIFY | Lines 322, 455, 468, 690, 1011, 1031 → use helper |
| `scripts/sync-healthie-failed-payments.ts` | MODIFY | Lines 256, 275 → use helper |
| `scripts/startup-payment-sync.ts` | MODIFY | Lines 191, 214, 298, 319 → use helper |
| `scripts/process-unpaid-payments.ts` | MODIFY | Line 85 → use helper |
| `scripts/daily-payment-check.js` | MODIFY | Line 132 → use helper |
| `scripts/fix-payment-hold-patients.ts` | MODIFY | Line 136 → use helper |
| `scripts/fix-holds-now.js` | MODIFY | Line 22 → use helper |
| `scripts/resolve_sandy_payment.js` | MODIFY | Line 54 → use helper |
| `app/api/admin/status-audit/route.ts` | NEW | List endpoint (filters, pagination) |
| `app/admin/status-audit/page.tsx` | NEW | Admin view |
| `components/admin/StatusAuditTable.tsx` | NEW | Filterable table |
| `app/api/dashboard/status-activity/route.ts` | NEW | Counts for iPad widget |
| `public/ipad/app.js` | MODIFY | Add status activity card to `loadDashboard()` mapping |
| `docs/sot-modules/27-patient-flow-map.md` | UPDATE | Stage 8 references audit table |
| `eslint` rule (optional) | NEW | Block `UPDATE patients SET status_key` outside `lib/status-transitions.ts` |

### Won't-touch guarantees

- **Will NOT auto-flip anyone to inactive.** Helper hard-codes: webhooks/crons cannot set `to_status='inactive'`. Only `source IN ('admin_api', 'merge', 'manual_script')` can.
- **Will NOT change existing reactivation behavior.** `lib/patientQueries.ts:691` semantics preserved (inactive → anything blocked unless admin override). Now also audited.
- **Will NOT modify `patient_status_lookup` rows.** Phil owns this table; phase only reads from it.
- **Will NOT delete or rewrite the existing `daily-payment-check.js` logic.** Just routes its writes through the helper.
- **Will NOT block direct DB modifications by Phil.** Audit table accepts `source='manual_script'`; Phil's `psql` UPDATEs won't go through helper but the `was_blocked=false, source=NULL` rows are detectable in audit gaps.

### Acceptance criteria

1. **Helper exists, all 16 writers migrated.** `grep -rn "UPDATE patients SET status_key" --include='*.ts' --include='*.js' app/ lib/ scripts/` returns ONLY `lib/status-transitions.ts`.
2. **Webhook inactive-block holds.** Synthetic test: webhook handler attempting `to_status='inactive'` → returns `blocked: 'webhook_cannot_set_inactive'`, audit row written with `was_blocked=true`.
3. **Existing reactivation guard holds.** Inactive patient → admin attempts via merge endpoint → succeeds with audit. Webhook attempts to recover same patient → blocked.
4. **Audit completeness.** For 1 week post-deploy, every `status_key` value change in `patients` has a corresponding `patient_status_audit` row within 5s of the change (verified by trigger-based shadow check).
5. **Dashboard widget accuracy.** iPad widget counts match `SELECT COUNT(*) FROM patient_status_audit WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY to_status`.
6. **No-op writes don't pollute audit.** Setting `to_status` to current value → returns `applied: false`, no audit row.
7. **Backfill query usable.** `SELECT * FROM patients WHERE status_key='inactive' AND patient_id NOT IN (SELECT patient_id FROM patient_status_audit WHERE to_status='inactive')` returns 59 (the existing inactive patients with no audit history) — expected and documented.
8. **Phil can answer "who set patient X inactive when and why" in 30s.** Manual test: pick 3 random inactive patients flipped post-deploy, run query, get 3 audit rows with reason + source.

### Risk + rollback

**Risks:**
- Helper has a bug → patient transitions silently fail. **Mitigation:** Helper returns `{ applied: false, blocked: ... }`; callers must handle. Returning `applied: false` for an unexpected reason → log + Telegram alert.
- 16-site migration is partial → some writers still bypass helper → audit gaps. **Mitigation:** Migration is incremental; ESLint rule (post-migration) catches new violations. Audit-gap query (acceptance #7) detects historical/skipped writes.
- Webhook processor restart during migration → mid-flight writes skip audit. **Mitigation:** Migration adds helper call BEFORE removing direct UPDATE; PR is one-file-at-a-time.
- Audit table grows unbounded. **Mitigation:** Expected ~50 rows/day; 18k/year. No retention needed initially. Add 12mo retention cron only if growth surprises.
- Performance: every status write now does an extra read + insert. **Mitigation:** Same transaction; one round-trip overhead. Healthie webhook processor already does multiple writes per event; one more is negligible.

**Rollback plan:**
- Helper is additive; can be disabled by reverting one PR per writer.
- `patient_status_audit` table data preserved.
- ESLint rule can be disabled instantly if it blocks emergency patches.
- No data loss possible — helper only writes, never deletes.

### Sub-phases within Phase 1

| Sub-phase | Scope | Days |
|---|---|---|
| 1.0 | Schema migration + helper skeleton + unit tests | 1 |
| 1.1 | Migrate 3 admin-API writers + audit dashboard | 1 |
| 1.2 | Migrate 6 webhook-processor writers (highest-risk) | 1.5 |
| 1.3 | Migrate 7 script writers | 1 |
| 1.4 | iPad widget + ESLint rule + acceptance tests | 1 |
| 1.5 | 1-week soak + audit-gap report | (calendar) |

Active engineering: ~5.5 days. Wall-clock: ~10 days incl soak.

### Open questions for Phil before kickoff

1. **Reactivation policy.** Today: `inactive → anything` blocked at `patientQueries.ts:691`. Phase 1 preserves this BUT logs blocked attempts. Confirm: do you want admin merge to be the ONLY exit from `inactive`, or should there also be an explicit "restore patient" admin action?
2. **ESLint rule timing.** Block direct `UPDATE patients SET status_key` writes from Day 1 (forces migration), or after migration is complete? Recommend: warn from Day 1, error after sub-phase 1.3.
3. **Audit retention.** Indefinite (compliance angle), or 12mo rolling? Recommend indefinite until disk pressure.
4. **Telegram alert noise.** Should every blocked transition Telegram-alert, or only inactive-target blocks? Recommend: inactive-target only (signal); others log silently.
5. **Backfill the 59 existing inactive patients.** Insert synthetic audit rows with `source='backfill', reason='pre-Phase-1 inactive'`? Helps query consistency. Recommend: yes, one-time seed.

---

## Phase 2 — GHL Workflow Disable + Pipeline Audit

**One-line goal:** stop the GHL workflow sprawl (75+ workflows across 4 sub-accounts, many duplicate / draft / dead) by disabling everything not on the locked keep-list, and audit the (separate) pipelines for the same dead-weight problem.

### Why this phase

`feedback_ghl_workflow_pattern.md` locks the architecture: one workflow per channel (Send SMS / Send Email / Create Task / Apply Tag), branching in code. Today the GHL accounts have many workflows that:
- Pre-date the dashboard
- Were one-off campaigns
- Are duplicates of each other (e.g., "2025 LAB TEST", "2026 LAB TEST")
- Drift from the code-side intent

Disabling them is pure config work — no code changes — and reduces ambiguity before Phase 6 ships new receivers.

### Architectural design

#### Inventory snapshot

Workflow inventory at `/tmp/ghl-workflow-inventory.json` (regenerated via `.tmp/ghl-workflow-inventory.mjs`):

- **Men's Health** location: ~69 workflows
- **Primary Care / Longevity** location: TBD via inventory script
- **ABXTac** location: TBD

Pipeline inventory captured separately via `.tmp/ghl-pipeline-inventory.mjs` (already exists per recent code, see file). Pipelines are NOT workflows — they are opportunity-stage configs and need their own keep-list.

#### Keep-list (locked 2026-04-24)

| Workflow | Purpose | Location |
|---|---|---|
| `Send SMS` | Outbound SMS receiver — one per location | All 3 (Men's Health, PC, ABXTac) |
| `Send Email` | Outbound email receiver — one per location | All 3 |
| `Create Task` | Staff task receiver — one per location | All 3 |
| `Apply Tag` | Tag-application receiver — one per location | All 3 |
| `Inbound SMS Handler` | Routes inbound SMS to dashboard webhook | All 3 |
| `Appointment Booked` (iPad-connected) | Sends to dashboard for processing | Men's Health (others TBD) |

Total: ~12 outbound + 3 inbound + 3 booked = ~18 workflows kept.

Everything else: disabled (not deleted — disabled lets us revive in 1 click if needed).

#### Pipeline keep-list

Pipelines store opportunity stages (Lead → Qualified → Booked → etc.). Per `feedback_ghl_workflow_pattern.md`, dashboard-side classification (Phase 3) is the SOT for member status, so most GHL pipelines are advisory at best.

Recommended: keep one pipeline per location for opportunity intake (Lead → Booked → Won → Lost). Disable the rest.

Pipeline inventory must be reviewed with Phil before disable — pipelines drive some staff dashboards in GHL itself, and disabling can hide opportunities from staff who use the GHL UI.

### Per-path code changes

**No code changes.** This is a pure GHL UI / API config change.

| File | Change | Notes |
|---|---|---|
| `.tmp/ghl-workflow-inventory.mjs` | Regenerate | Already exists, re-run for fresh snapshot |
| `.tmp/ghl-pipeline-inventory.mjs` | Regenerate | Already exists |
| `scripts/ghl/disable-workflow.mjs` | NEW | Idempotent disable via GHL API; takes workflow ID |
| `scripts/ghl/restore-workflow.mjs` | NEW | Reverse — re-enable |
| `docs/sot-modules/23-ghl-ai-agents.md` | REWRITE | Currently has brand color content; must be rebuilt to actually document GHL agent state, keep-list, disable history |

### Won't-touch guarantees

- **Will NOT delete any workflow.** Disable only.
- **Will NOT modify keep-list workflows.** They are locked; Phase 6 builds inside them, not around them.
- **Will NOT touch GHL contact data, tags, or conversation history.**
- **Will NOT disable any iPad-connected workflow without Phil's explicit per-workflow confirmation.** Some Phil-built iPad flows route through GHL workflows we may not recognize.

### Acceptance criteria

1. **Inventory captured.** Pre-disable JSON snapshot of all workflows (active + draft) per location, saved to `.tmp/ghl-workflow-inventory-2026-04-XX.json` for diff baseline.
2. **Keep-list confirmed.** Phil reviews the keep-list and approves it explicitly before any disable runs.
3. **Disables idempotent.** `disable-workflow.mjs` can run twice without error.
4. **Phase 1 audit shows no spike.** After Phase 2 disable, `patient_status_audit` shows no unusual transitions in 7 days (no patient orphaned by a disabled workflow).
5. **Pipeline review separate.** Pipeline disables happen in a second sub-phase after workflow disables soak for 1 week.
6. **Restore script works.** Pick 1 disabled workflow at random, restore it via `restore-workflow.mjs`, verify it's active again in GHL UI.

### Risk + rollback

**Risks:**
- iPad / dashboard relies on a workflow not on the keep-list → silent breakage. **Mitigation:** Phase 1 audit + 7-day soak. Restore script tested.
- Phil-approved keep-list is incomplete → important workflow disabled. **Mitigation:** Per-workflow confirmation prompt for any with "iPad", "Dashboard", "Active", or recent (last 30d) activity.
- Phase 6 hasn't shipped yet → disabling old workflows leaves a comm gap. **Mitigation:** Phase 2 only disables draft/duplicate workflows in week 1. Active-but-replaced workflows wait until Phase 6 ships.

**Rollback plan:**
- One-line restore per workflow.
- All disabled workflow IDs logged in `docs/sot-modules/23-ghl-ai-agents.md` for traceability.

### Sub-phases within Phase 2

| Sub-phase | Scope | Days |
|---|---|---|
| 2.0 | Re-run inventory; review with Phil; finalize keep-list | 0.5 |
| 2.1 | Disable obvious draft / duplicate / 2024 / 2025 workflows (low risk) | 0.5 |
| 2.2 | 7-day soak | (calendar) |
| 2.3 | Disable remaining non-keep-list workflows | 0.5 |
| 2.4 | Pipeline audit + Phil review + selective disable | 1 |
| 2.5 | Rewrite `23-ghl-ai-agents.md` with final state | 1 |

Active engineering: ~3.5 days. Wall-clock: ~14 days due to soak periods.

### Open questions for Phil before kickoff

1. **Pipeline scope.** Are GHL pipelines actively used by staff in the GHL UI? If yes, audit & keep more conservatively.
2. **2025 / 2024 named workflows.** Many drafts have year prefixes — confirm safe to disable in bulk.
3. **iPad-connected workflow inventory.** Which workflows does the iPad call into? Need to map before disable.
4. **Module 23 rewrite.** I'll rewrite `23-ghl-ai-agents.md` from the disable-result. Confirm scope: just GHL workflow state, or also document Jessica/Max if those names refer to live agents I haven't found yet?

---

## Phase 3 — Auto-Classification (write to client_type_key, not new column)

**One-line goal:** every patient gets `client_type_key` set automatically based on Healthie subscription state + clinic + service usage, with a daily reconciler that catches drift, and a Phil-reviewable override path. **No new column needed** — `client_type_lookup` already has the 18 values we need.

### Why this phase (corrected from v2)

v2 invented `billing_source` as a new enum column. Reality: `patients.client_type_key` already exists, FK-enforced to `client_type_lookup` (18 rows incl. `qbo_tcmh_180_month`, `jane_tcmh_180_month`, `primecare_elite_100_month`, `approved_disc_pro_bono_pt`, `nowmenshealth`, `nowprimarycare`, `abxtac`, `nowlongevity`, etc.).

The actual problem: `client_type_key` is **inconsistently populated**.
- 13/18 lookup values have ≥1 patient
- 20/459 patients have NULL `client_type_key`
- No reconciler keeps it in sync with Healthie subscription state
- Manual edits drift from reality

Phase 3 builds the reconciler. The schema is already correct.

### Architectural design

#### Classification algorithm

```typescript
// lib/classify-client-type.ts (NEW)

type ClassificationResult = {
  clientTypeKey: string;        // FK value to client_type_lookup
  reason: string;               // human-readable
  evidence: Record<string, any>; // { healthieSubscriptions: [...], stripeCharges: [...], ... }
  confidence: 'high' | 'medium' | 'low';
};

export async function classifyPatient(patientId: string): Promise<ClassificationResult> {
  const patient = await getPatient(patientId);
  const healthieSubs = await getHealthieSubscriptions(patient.healthie_client_id);
  const stripeCharges = await getRecentStripeCharges(patient.stripe_customer_id);
  const clinic = patient.clinic;
  const isProBonoFlag = patient.is_pro_bono ?? false;

  // 1. Pro-bono (Phil-set flag wins)
  if (isProBonoFlag) {
    return { clientTypeKey: 'approved_disc_pro_bono_pt', reason: 'is_pro_bono flag set', ... };
  }

  // 2. Active Healthie recurring → map by amount + clinic to specific tier
  const activeRecurring = healthieSubs.filter(s => s.status === 'active');
  if (activeRecurring.length > 0) {
    // Map monthly $ amount × clinic → client_type_key
    return mapHealthieRecurringToClientType(activeRecurring, clinic);
  }

  // 3. No Healthie recurring + recent Stripe direct charges → likely visit-based
  if (stripeCharges.length > 0) {
    return { clientTypeKey: 'sick_visit', reason: 'direct stripe charges only, no recurring', ... };
  }

  // 4. No billing signal at all → fall back to clinic if set
  if (clinic) {
    return { clientTypeKey: clinicToFallbackClientType(clinic), reason: 'no billing signal, derived from clinic', confidence: 'low' };
  }

  // 5. Truly unknown → 'other' with low confidence
  return { clientTypeKey: 'other', reason: 'no signal', confidence: 'low' };
}
```

The mapping `mapHealthieRecurringToClientType` uses the existing client_type_lookup values:
- $50/mo + Primary Care clinic → `primecare_premier_50_month`
- $100/mo + Primary Care → `primecare_elite_100_month`
- $179/mo + ABXTac → (custom — see ABXTAC offering pin)
- $180/mo + TCMH → `qbo_tcmh_180_month` (legacy) OR `nowmenshealth` (Healthie native)
- etc.

Mapping table lives in `lib/client-type-mapping.ts` and is data-driven (not hard-coded if/else).

#### Reconciler cron

`/api/cron/reclassify-clients/route.ts` runs daily at 3am Mountain (after Snowflake sync, before morning-prep):

```typescript
async function reclassify({ dryRun, patientIds }: { dryRun: boolean; patientIds?: string[] }) {
  const targets = patientIds ?? await getActivePatients();

  for (const id of targets) {
    const current = await getCurrentClientType(id);
    const computed = await classifyPatient(id);

    if (current === computed.clientTypeKey) continue;

    // Has the override flag been set?
    const override = await getClassificationOverride(id);
    if (override && override.clientTypeKey !== computed.clientTypeKey) {
      // Phil set this manually — don't overwrite, but flag drift
      await logDrift({ patientId: id, expected: computed.clientTypeKey, actual: override.clientTypeKey });
      continue;
    }

    if (!dryRun) {
      await updateClientType(id, computed.clientTypeKey, { reason: computed.reason, evidence: computed.evidence });
      await logReclassification({ patientId: id, from: current, to: computed.clientTypeKey, ... });
    }
  }
}
```

#### Override mechanism

Sometimes Phil knows something the algorithm doesn't — e.g., a patient is on a custom comp deal not encoded in Healthie. New table `client_type_overrides`:

```sql
CREATE TABLE client_type_overrides (
  patient_id UUID PRIMARY KEY REFERENCES patients(patient_id),
  client_type_key TEXT NOT NULL REFERENCES client_type_lookup(client_type_key),
  reason TEXT NOT NULL,
  set_by_user_id INTEGER REFERENCES users(id),
  set_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ  -- optional
);
```

Reconciler checks override; if set, never overwrites. Drift between override and computed is logged for review.

#### Audit log

```sql
CREATE TABLE client_type_audit (
  id BIGSERIAL PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(patient_id),
  from_value TEXT,
  to_value TEXT NOT NULL,
  source TEXT NOT NULL,    -- 'reconciler' | 'admin_api' | 'override' | 'manual'
  reason TEXT,
  evidence JSONB,
  was_skipped BOOLEAN DEFAULT false,
  skip_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_client_type_audit_patient ON client_type_audit(patient_id, created_at DESC);
```

### Database schema changes

```sql
-- migrations/2026XXXX_client_type_classification.sql

-- 1. Override table (new)
CREATE TABLE client_type_overrides (
  patient_id UUID PRIMARY KEY REFERENCES patients(patient_id),
  client_type_key TEXT NOT NULL REFERENCES client_type_lookup(client_type_key),
  reason TEXT NOT NULL,
  set_by_user_id INTEGER REFERENCES users(id),
  set_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- 2. Audit log (new)
CREATE TABLE client_type_audit (
  id BIGSERIAL PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(patient_id),
  from_value TEXT,
  to_value TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('reconciler', 'admin_api', 'override', 'manual')),
  reason TEXT,
  evidence JSONB,
  was_skipped BOOLEAN DEFAULT false,
  skip_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_client_type_audit_patient ON client_type_audit(patient_id, created_at DESC);

-- 3. Companion timestamp on patients
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS client_type_key_updated_at TIMESTAMPTZ;
```

NO new `billing_source` enum. NO new column on `patients` for classification. The data lives in the existing `client_type_key`.

### Per-path code changes

| File | Change |
|---|---|
| `migrations/2026XXXX_client_type_classification.sql` | NEW |
| `lib/classify-client-type.ts` | NEW — pure classification function |
| `lib/client-type-mapping.ts` | NEW — data-driven $ × clinic → key mapping table |
| `lib/healthie.ts` | (already has `getClientSubscriptions` — no change) |
| `app/api/cron/reclassify-clients/route.ts` | NEW |
| `app/api/admin/client-type-overrides/route.ts` | NEW (CRUD on overrides) |
| `app/api/admin/client-type-audit/route.ts` | NEW (read audit log) |
| `app/admin/classification/page.tsx` | NEW (Phil's review UI) |
| `components/admin/ClassificationDriftTable.tsx` | NEW |
| `crontab` | UPDATE — daily 3am reclassify-clients |
| `scripts/classify/dry-run.ts` | NEW (Phil-runnable: produces CSV of would-be changes) |

### Won't-touch guarantees

- **Will NOT modify `client_type_lookup`.** Phil owns this table.
- **Will NOT overwrite an override.** Once Phil sets an override, only Phil clears it.
- **Will NOT auto-classify patients with `status_key='inactive'`.** Phase 1 dependency.
- **Will NOT invent new client types.** Mapping uses only the 18 existing lookup values.
- **Will NOT touch billing in any external system.** Read-only from Healthie/Stripe/QBO.

### Acceptance criteria

1. **20 NULL `client_type_key` patients reclassified.** Dry-run shows expected values; live run sets them.
2. **Drift detection works.** Synthetic patient with override≠computed → drift log row written, override preserved.
3. **Phase 1 dependency holds.** Reclassifier never touches inactive patients (verified).
4. **Phil dry-run review.** Dry-run CSV shows current vs proposed for all 459 patients. Phil reviews ≥30 random rows; ≥90% reasonable.
5. **Reconciler idempotent.** Running twice in a day produces zero changes on the second run.
6. **Audit trail complete.** Every `client_type_key` change has a corresponding `client_type_audit` row.

### Risk + rollback

**Risks:**
- Bad mapping → 100 patients reclassified to wrong tier. **Mitigation:** Dry-run + Phil review before live; staged rollout (Phase 3.0 = NULL-only, Phase 3.1 = full pop).
- Override drift unbounded — Phil sets 50 overrides, all stale. **Mitigation:** Optional `expires_at` on overrides; weekly drift report in Phase 9 recon email.
- Healthie subscription state stale → wrong computation. **Mitigation:** Reconciler aborts if `getClientSubscriptions` last-sync >24h.

**Rollback plan:**
- Disable cron via `RECLASSIFY_ENABLED=false`.
- Audit log preserved; revert any specific reclassification by reading `from_value`.

### Sub-phases within Phase 3

| Sub-phase | Scope | Days |
|---|---|---|
| 3.0 | Schema + mapping table + dry-run script | 1.5 |
| 3.1 | Phil dry-run review session | 0.5 |
| 3.2 | NULL-only reclassification (20 patients) | 0.5 |
| 3.3 | Full-population reclassification (439 patients) with audit | 0.5 |
| 3.4 | Daily reconciler cron + drift detection | 1 |
| 3.5 | Override CRUD + admin UI | 1.5 |

Active engineering: ~5 days. Wall-clock: 7 days incl Phil review.

### Open questions for Phil before kickoff

1. **Mapping verification.** I'll draft the $ × clinic → key mapping table from current data. Phil reviews each row before code uses it. Acceptable?
2. **Override RBAC.** Admin-only, or any staff role? Recommend admin-only.
3. **Override expiration default.** No expiration (permanent until cleared), or 90-day default? Recommend no default (force explicit choice).
4. **Confidence threshold.** If `classifyPatient()` returns `confidence: 'low'` (e.g., only fallback-from-clinic), should the reconciler skip the write and queue for staff review? Recommend: yes, low-confidence → audit row with `was_skipped=true`, no write.
5. **Initial NULL handling.** 20 patients have NULL `client_type_key`. Reclassify all in one batch, or 1-by-1 with Phil review?

---

## Phase 4 — Pro-Bono Flag + No Man's Land Queue (Stage 4 → 5 handoff)

**One-line goal:** make the manual handoff between "patient evaluated" and "patient on recurring package" a tracked, surfaced, automated cohort — no patient stalls in evaluated-but-not-billing limbo for >7 days without staff seeing it.

### Why this phase

Per `27-patient-flow-map.md` Stage 4 GAP: today, after a patient completes their evaluation visit but before they sign up for a recurring package, they sit in `status_key='active_pending'` with no visibility. Nobody chases them. They drop off.

Pro-bono flag is bundled here because both surfaces hit the same Phil-review queue.

### Architectural design

#### Pro-bono flag — already supported

`client_type_lookup` already has `approved_disc_pro_bono_pt`. Phase 3's classifier respects it (Step 1: `is_pro_bono` flag wins).

What's missing: an `is_pro_bono` boolean column on `patients` for Phase 3 to read. Today there's no way to mark a patient as pro-bono without changing `client_type_key` directly (which Phase 3 would then overwrite).

```sql
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS is_pro_bono BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS pro_bono_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pro_bono_set_by_user_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS pro_bono_reason TEXT;

CREATE INDEX idx_patients_pro_bono ON patients(is_pro_bono) WHERE is_pro_bono = true;
```

When set, Phase 3 writes `client_type_key='approved_disc_pro_bono_pt'` and locks against drift via the override mechanism.

#### No Man's Land detection

A patient is in NML when:
- `status_key = 'active_pending'`
- `service_start_date IS NOT NULL` (they've been seen)
- AND (no active Healthie recurring) AND (no Stripe direct charge in last 30d)
- AND not flagged `is_pro_bono`
- For >7 days

Detection runs daily via existing `morning-prep` cron extension (don't add a separate cron — hook into the cron that already runs).

```typescript
// lib/no-mans-land.ts (NEW)

export async function detectNoMansLand(asOf: Date): Promise<NMLPatient[]> {
  const candidates = await query<PatientRow>(`
    SELECT p.*, MAX(d.dispense_date) as last_dispense
    FROM patients p
    LEFT JOIN dispenses d ON d.patient_id = p.patient_id
    WHERE p.status_key = 'active_pending'
      AND p.service_start_date IS NOT NULL
      AND p.is_pro_bono = false
      AND p.service_start_date < NOW() - INTERVAL '7 days'
    GROUP BY p.patient_id
  `);

  const nmlPatients = [];
  for (const p of candidates) {
    const subs = await getClientSubscriptions(p.healthie_client_id);
    const activeRecurring = subs.filter(s => s.status === 'active');
    const recentStripe = await getStripeChargesLast30d(p.stripe_customer_id);

    if (activeRecurring.length === 0 && recentStripe.length === 0) {
      nmlPatients.push({
        patientId: p.patient_id,
        daysInNML: daysSince(p.service_start_date),
        evidence: { healthie: subs, stripe: recentStripe },
      });
    }
  }

  return nmlPatients;
}
```

#### NML queue table

```sql
CREATE TABLE no_mans_land_queue (
  id BIGSERIAL PRIMARY KEY,
  patient_id UUID NOT NULL UNIQUE REFERENCES patients(patient_id),
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  days_in_nml INTEGER NOT NULL,
  evidence JSONB,
  staff_action TEXT,            -- 'pending' | 'contacted' | 'pro_bono_approved' | 'churned' | 'recovered'
  staff_action_at TIMESTAMPTZ,
  staff_user_id INTEGER REFERENCES users(id),
  notes TEXT,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX idx_nml_unresolved ON no_mans_land_queue(detected_at DESC) WHERE resolved_at IS NULL;
```

UPSERT pattern: each daily detection refreshes `days_in_nml` and `evidence`; doesn't create duplicate rows.

#### Resolution paths

A NML row is resolved when:
- Patient signs up for Healthie recurring → `staff_action='recovered'`, auto-set
- Patient flagged pro-bono → `staff_action='pro_bono_approved'`, manual
- Patient marked inactive → `staff_action='churned'`, manual (via Phase 1 helper)
- Staff dismisses with reason → `staff_action='dismissed'`, manual

#### Staff dashboard widget

iPad CEO + dedicated `/no-mans-land` page:

```
NO MAN'S LAND                  As of 7am
─────────────────────────────
12 patients evaluated, not yet billing

Top by days waiting:
  Patient A — 23 days — last seen 2026-04-01
  Patient B — 18 days — has open recurring? no
  Patient C — 15 days — pro-bono candidate?
  ...

[Send recurring sign-up SMS] (Phase 6 receiver)
[Mark pro-bono]  [Mark churned]  [Dismiss]
```

#### Patient-facing nudge (Phase 6 dependency)

After 7 days NML → Phase 6 SMS receiver sends "your evaluation is complete — finish signup here {link}". After 14 days → escalates to staff task. After 30 days → staff manual call.

Phase 4 ships nudges as **drafts** until Phase 6 is live and Phil approves the template.

### Database schema changes

```sql
-- migrations/2026XXXX_no_mans_land.sql

-- Pro-bono columns on patients
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS is_pro_bono BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS pro_bono_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pro_bono_set_by_user_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS pro_bono_reason TEXT;
CREATE INDEX idx_patients_pro_bono ON patients(is_pro_bono) WHERE is_pro_bono = true;

-- NML queue
CREATE TABLE no_mans_land_queue (
  id BIGSERIAL PRIMARY KEY,
  patient_id UUID NOT NULL UNIQUE REFERENCES patients(patient_id),
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  days_in_nml INTEGER NOT NULL,
  evidence JSONB,
  staff_action TEXT CHECK (staff_action IN ('pending', 'contacted', 'pro_bono_approved', 'churned', 'recovered', 'dismissed')),
  staff_action_at TIMESTAMPTZ,
  staff_user_id INTEGER REFERENCES users(id),
  notes TEXT,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX idx_nml_unresolved ON no_mans_land_queue(detected_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX idx_nml_patient ON no_mans_land_queue(patient_id);
```

### Per-path code changes

| File | Change |
|---|---|
| `migrations/2026XXXX_no_mans_land.sql` | NEW |
| `lib/no-mans-land.ts` | NEW — detection function |
| `app/api/cron/morning-prep/route.ts` | MODIFY — add NML detection step (don't add separate cron) |
| `app/api/admin/no-mans-land/route.ts` | NEW — list + filter |
| `app/api/admin/no-mans-land/[patientId]/action/route.ts` | NEW — staff action |
| `app/api/admin/patients/[patientId]/pro-bono/route.ts` | NEW — toggle pro-bono flag |
| `app/no-mans-land/page.tsx` | NEW |
| `components/nml/NMLQueueTable.tsx` | NEW |
| `public/ipad/app.js` | MODIFY — CEO widget + dashboard mapping |
| `lib/classify-client-type.ts` | MODIFY — Phase 3 already reads `is_pro_bono` per its Step 1 |
| `docs/sot-modules/27-patient-flow-map.md` | UPDATE — Stage 4 references NML queue |

### Won't-touch guarantees

- **Will NOT auto-flip status.** NML detection only writes to `no_mans_land_queue`, never to `patients.status_key`.
- **Will NOT charge any patient.** Pro-bono flag is metadata only; no Healthie/Stripe writes.
- **Will NOT send patient nudges before Phase 6 ships.** Templates ship as drafts.
- **Will NOT delete NML rows.** Resolution sets `resolved_at`; rows preserved for audit.
- **Will NOT touch evaluation/visit records.** Read-only against Healthie scheduling.

### Acceptance criteria

1. **NML detection accuracy.** Synthetic test: patient with `active_pending`, no recurring, no Stripe, >7 days → flagged. Patient with active recurring → NOT flagged. Patient with recent Stripe → NOT flagged.
2. **Idempotency.** Re-running detection same day updates `days_in_nml`, doesn't create duplicate rows.
3. **Pro-bono flag round-trips.** Set `is_pro_bono=true` via admin endpoint → Phase 3 next run writes `client_type_key='approved_disc_pro_bono_pt'` → patient excluded from NML.
4. **Resolution detection.** Patient in NML signs up for Healthie recurring → next morning-prep run sets `resolved_at`, `staff_action='recovered'`.
5. **Staff dashboard usable.** Phil + 1 staff work the NML queue; sort/filter/action all work.
6. **Phil dry-run review.** First detection run dry-runs; Phil reviews list; ≥80% are real NML cases.

### Risk + rollback

**Risks:**
- False positives — patient just signed up but Healthie sync is lagging. **Mitigation:** Detection requires Healthie last-sync within 12h; aborts otherwise.
- Pro-bono flag misuse — staff sets it carelessly, patients lose billing. **Mitigation:** Admin-only RBAC; reason field required; weekly Phil review of new pro-bono flips in Phase 9 recon email.
- NML queue grows unbounded if staff don't action items. **Mitigation:** 30-day auto-escalation to Phil's review queue; iPad widget shows count prominently.
- Morning-prep cron runtime balloons — adding NML detection could push it past timeout. **Mitigation:** NML detection is its own try/catch; failure doesn't break the rest of morning-prep.

**Rollback plan:**
- Disable detection via `NML_DETECTION_ENABLED=false`.
- `is_pro_bono` is additive; can be ignored.
- Queue data preserved.

### Sub-phases within Phase 4

| Sub-phase | Scope | Days | Blocker |
|---|---|---|---|
| 4.0 | Schema + pro-bono columns + admin endpoint | 1 | |
| 4.1 | NML detection function + dry-run | 1 | |
| 4.2 | morning-prep integration + queue table writes | 0.5 | |
| 4.3 | Phil dry-run review | 0.5 | YES (Phil) |
| 4.4 | Staff dashboard + iPad widget | 2 | |
| 4.5 | Phase 6 nudge wiring (after Phase 6 ships) | 1 | YES (Phase 6) |

Active engineering: ~5 days. Wall-clock: 7+ days incl Phil + Phase 6 dep.

### Open questions for Phil before kickoff

1. **NML threshold days.** 7 days proposed. Confirm or adjust per care line (TRT vs Primary Care).
2. **Pro-bono RBAC.** Admin-only, or any staff with reason? Recommend admin-only per `project_hardening_plan_decisions.md`.
3. **Resolution actions.** The 6 action values — anything missing? Specifically: should "patient unreachable" be its own value vs a flavor of "dismissed"?
4. **NML SMS template.** Phase 6 nudge will use template "Hi {name}, your evaluation is complete — finish signup at {link}". Phil approves wording before send.
5. **Morning-prep integration.** OK to add NML to morning-prep, or prefer separate cron? Recommend in-cron to avoid sprawl.

---

## Phase 5 — Legacy Billing Migration Tracker (downscoped)

**One-line goal:** identify every patient still billed outside Healthie (QBO recurring, Jane recurring, manual Stripe), track migration progress per-patient with explicit lifecycle states, surface stuck migrations on the dashboard, and feed the Phase 9 weekly recon email.

### Why this phase (corrected from v2)

v2 assumed patients carry preserved legacy IDs (`jane_id`, `qbo_customer_id`) we'd use to enumerate the legacy cohort. Reality (verified 2026-04-24):

- **0/459 patients have `jane_id` populated**
- **0/459 patients have `qbo_customer_id` populated**

So the cohort can't be derived from preserved IDs. Instead it must be derived from:
1. `client_type_key LIKE 'qbo_%' OR LIKE 'jane_%' OR LIKE 'mixed_%'` — captures the labeled legacy patients (post-Phase 3 reclassification)
2. QBO API direct query for active recurring invoices, joined to `patients` by email
3. Jane CSV manual export, joined to `patients` by email + name + DOB
4. Stripe direct charges in last 90d not associated with a Healthie invoice

This is a smaller, more deliberate cohort than v2 imagined. Probably ~50-80 patients total (cross-checking `client_type_key` distribution: `qbo_tcmh_180_month`=17, `jane_tcmh_180_month`=8, `qbo_f_f_fr_veteran_140_month`=11, `jane_f_f_fr_veteran_140_month`=14, `mixed_*`=2-3 = ~52 confirmed). The cohort is identifiable; we just identify it differently than v2 said.

### Architectural design

#### Cohort identification

Step 1: From dashboard → enumerate patients with legacy `client_type_key`:
```sql
SELECT * FROM patients
WHERE client_type_key IN (
  'qbo_tcmh_180_month',
  'jane_tcmh_180_month',
  'qbo_f_f_fr_veteran_140_month',
  'jane_f_f_fr_veteran_140_month',
  'mixed_primcare_jane_qbo_tcmh',
  'mixed_primecare_jane_qbo_tcmh',
  'mens_health_qbo'
);
```

Step 2: From QBO → enumerate active recurring invoices (via existing `lib/quickbooks.ts`); cross-join by email/customer name → flag any not in Step 1 result (drift).

Step 3: From Jane CSV (Phil-uploaded periodically) → enumerate active recurring memberships; cross-join by email + DOB; flag drift.

Step 4: From Stripe direct (last 90d) → enumerate charges not linked to a Healthie invoice; flag drift.

Output: union set of (patient_id, legacy_source, legacy_external_id, monthly_amount, last_charge_date).

#### Migration tracker table

```sql
CREATE TABLE legacy_billing_migration (
  id BIGSERIAL PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(patient_id),
  legacy_source TEXT NOT NULL CHECK (legacy_source IN ('qbo', 'jane', 'stripe_direct')),
  legacy_external_id TEXT,            -- QBO customer ID, Jane CSV row hash, Stripe customer ID
  monthly_amount_cents INTEGER,
  last_charge_date DATE,
  state TEXT NOT NULL CHECK (state IN (
    'detected',          -- found by ingestion
    'link_sent',         -- migration link emailed/SMS'd
    'link_clicked',      -- patient opened link
    'package_assigned',  -- Healthie package assigned
    'first_charge_ok',   -- first Healthie recurring charge successful
    'legacy_cancelled',  -- legacy recurring cancelled by staff
    'migrated',          -- terminal: fully migrated, ≥30 days post-cancel
    'link_expired',      -- terminal: stuck (>14 days at link_sent or link_clicked)
    'churned',           -- terminal: patient went off-service mid-migration
    'pro_bono'           -- terminal: marked pro-bono, no migration needed
  )),
  state_updated_at TIMESTAMPTZ DEFAULT NOW(),
  state_history JSONB DEFAULT '[]'::jsonb,  -- [{state, at, by, reason}]
  notes TEXT,
  evidence JSONB,  -- raw QBO/Jane/Stripe data for audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (patient_id, legacy_source)  -- one row per (patient, source)
);

CREATE INDEX idx_legacy_state ON legacy_billing_migration(state, state_updated_at DESC);
CREATE INDEX idx_legacy_patient ON legacy_billing_migration(patient_id);
CREATE INDEX idx_legacy_stuck ON legacy_billing_migration(state, state_updated_at)
  WHERE state IN ('link_sent', 'link_clicked');
```

UUID FK throughout.

#### State machine

```
detected → link_sent → link_clicked → package_assigned → first_charge_ok → legacy_cancelled → migrated
                                                                       \→ churned
                              \→ link_expired (>14 days no progress)
                              \→ pro_bono (Phil decision)
```

State transitions logged in `state_history` JSONB array. Terminal states (`migrated`, `link_expired`, `churned`, `pro_bono`) freeze the row.

#### Detection cron

`/api/cron/legacy-billing-detect/route.ts` — daily, 4am Mountain (after Phase 3 reclassifier):

```typescript
async function detectLegacy() {
  // Step 1: client_type_key cohort → upsert as 'detected'
  // Step 2: QBO active recurring → upsert (may already be in Step 1)
  // Step 3: Jane CSV (if uploaded this week) → upsert
  // Step 4: Stripe direct → upsert

  // For each row in 'link_sent' or 'link_clicked' >14 days → transition to 'link_expired'
  // For each 'first_charge_ok' >30 days with no failures → transition to 'migrated'
}
```

#### Migration link generator

For a `detected` row, staff (or auto-trigger) generates a Healthie sign-up link via existing `lib/healthie.ts` package-assign flow → SMS/email via Phase 6 → state transitions to `link_sent`.

Click tracking via short-link service (TBD — could be GHL or our own).

#### Staff dashboard

`/legacy-billing` page:

```
LEGACY BILLING MIGRATION TRACKER
──────────────────────────────
By state:
  Detected           23
  Link Sent          12
  Link Clicked        4
  Package Assigned    8
  First Charge OK     3
  Legacy Cancelled   18
  Migrated          124  ✓
  Link Expired        5  ⚠
  Churned             3
  Pro-bono            2

Stuck (>14d at link_sent/clicked): 5 patients ⚠
[View Stuck]

Per-patient table:
  Patient   Source   $ Monthly   State                Days   Action
  ...
```

iPad CEO widget:
```
LEGACY MIGRATION
─────────────
$8,640 MRR remaining
9 weeks projected (current pace)
5 stuck — needs action
```

### Database schema changes

Already shown above. UUID throughout. Reuses `client_type_lookup` for source-of-truth on legacy types.

### Per-path code changes

| File | Change |
|---|---|
| `migrations/2026XXXX_legacy_billing.sql` | NEW |
| `lib/legacy-billing/detect-from-client-type.ts` | NEW |
| `lib/legacy-billing/detect-from-qbo.ts` | NEW (uses existing `lib/quickbooks.ts`) |
| `lib/legacy-billing/detect-from-jane.ts` | NEW (reads `data/jane-export-YYYY-MM-DD.csv`) |
| `lib/legacy-billing/detect-from-stripe.ts` | NEW |
| `lib/legacy-billing/state-machine.ts` | NEW (transition rules + history) |
| `lib/legacy-billing/generate-migration-link.ts` | NEW (Healthie package-assign + short link) |
| `app/api/cron/legacy-billing-detect/route.ts` | NEW |
| `app/api/admin/legacy-billing/list/route.ts` | NEW |
| `app/api/admin/legacy-billing/[id]/transition/route.ts` | NEW |
| `app/api/admin/legacy-billing/[id]/send-link/route.ts` | NEW |
| `app/legacy-billing/page.tsx` | NEW |
| `components/legacy-billing/MigrationTrackerTable.tsx` | NEW |
| `scripts/legacy-billing/ingest-jane-csv.ts` | NEW (Phil-runnable) |
| `public/ipad/app.js` | MODIFY |
| `crontab` | UPDATE — daily 4am detect |

### Won't-touch guarantees

- **Will NOT cancel any QBO/Jane/Stripe subscription automatically.** Cancel is staff-triggered.
- **Will NOT charge any patient.** Detection + state-tracking only.
- **Will NOT modify legacy IDs that DO get populated later** (e.g., a patient where someone backfills `qbo_customer_id`).
- **Will NOT send migration links before Phil approves the template.** Templates ship as drafts.
- **Will NOT block Phase 3.** Phase 3's reclassifier runs independently; Phase 5 just consumes the labels.

### Acceptance criteria

1. **Cohort identified.** First detect run produces ~50-80 detected rows (matches manual count of legacy `client_type_key` patients ± Stripe outliers).
2. **State machine enforced.** Invalid transitions rejected (e.g., can't go `detected → migrated` without intermediate states).
3. **Stuck detection works.** Synthetic row at `link_sent` for 15 days → next run sets state to `link_expired`.
4. **Resolution: Healthie recurring activated → state advances.** Synthetic patient: assign Healthie package → first charge succeeds → state moves through `package_assigned` → `first_charge_ok` automatically.
5. **Phase 9 dependency.** `legacy_billing_migration` queryable from Phase 9 recon engine for the migration-progress section.
6. **Phil dry-run.** First detection run shows full cohort; Phil verifies count matches expectation ± 10%.
7. **Idempotency.** Re-running detect same day touches only state-transition rows; no duplicate `detected` rows.

### Risk + rollback

**Risks:**
- Cohort identification missing patients (e.g., one not labeled in `client_type_key` AND not in QBO/Jane export). **Mitigation:** Stripe direct check is the catch-all; quarterly Phil manual audit of "patients with revenue but no recurring" to find gaps.
- Jane CSV format changes. **Mitigation:** Ingestion script validates schema; rejects malformed CSV with clear error.
- QBO API rate limits during detection. **Mitigation:** Batch reads; cache for 24h.
- Patient migrated successfully but legacy not cancelled → double-billing. **Mitigation:** Phase 9 recon's `double_billing` rule catches this; surfaces in weekly email.
- "Pro-bono" terminal state misuse — staff marks legacy patient as pro-bono to skip migration. **Mitigation:** Pro-bono transition requires admin role + reason; weekly Phil review.

**Rollback plan:**
- Disable cron via `LEGACY_BILLING_DETECT_ENABLED=false`.
- Detection is read-only; data preserved.
- State transitions are append-only via state_history; reversible by inserting new transition.

### Sub-phases within Phase 5

| Sub-phase | Scope | Days |
|---|---|---|
| 5.0 | Schema + state machine | 1 |
| 5.1 | Detect-from-client-type + Phil cohort review | 1 |
| 5.2 | Detect-from-qbo (uses existing lib/quickbooks.ts) | 1 |
| 5.3 | Detect-from-jane CSV ingestion | 1 |
| 5.4 | Detect-from-stripe direct | 0.5 |
| 5.5 | State transition cron (link_expired, migrated detection) | 1 |
| 5.6 | Migration link generator + Phase 6 wiring | 1 |
| 5.7 | Staff dashboard + iPad widget | 2 |

Active engineering: ~8.5 days. Wall-clock: ~12 days incl Phil cohort review.

### Open questions for Phil before kickoff

1. **Jane CSV cadence.** How often will you upload? Weekly? Monthly? Affects how often Phase 5 considers Jane data current vs stale.
2. **Migration link template.** Phase 6 dependency — wording approval needed.
3. **link_expired timeout.** 14 days proposed. Adjust per channel (SMS faster than email)?
4. **Pro-bono override of migration.** If a legacy patient gets `is_pro_bono=true` (Phase 4) → Phase 5 transitions row to `pro_bono` terminal state automatically. Confirm.
5. **Auto-cancel legacy.** Should the system EVER auto-cancel QBO/Jane recurring after `first_charge_ok` confirms? Recommend NEVER — staff-only. Confirm.

---

## Phase 6 — GHL Receiver Build-Out (delta from existing lib/ghl.ts)

**One-line goal:** complete the "one workflow per channel" infrastructure on top of the existing `lib/ghl.ts`. Don't rebuild what works — add only the missing helpers (`sendEmail`, `createTask`, `applyTag`), the centralized send log, the dry-run mode, and the test-contact whitelist.

### Why this phase (corrected from v2)

v2 specced Phase 6 as a from-scratch build. Reality check (verified 2026-04-24):

**What already works in `lib/ghl.ts`:**
- `GHLClient` class with `sendSms(contactId, body, attachments?)` — line ~289
- 4 location-specific factories: `createGHLClientForMensHealth`, `createGHLClientForPrimaryCare`, `createGHLClientForABXTAC`, `createGHLClientForLongevity`
- `getGHLClientForPatient(clinic?, clientType?)` — routing logic at line 942 already correct per `feedback_ghl_workflow_pattern.md`
- Tag operations: `addTag`, `findOrCreateTag`, `getTags` — already exist
- Used by 21 files across the codebase

**What's missing:**
- `sendEmail(contactId, subject, body)` — does NOT exist
- `createTask(contactId, title, body, dueAt, assigneeId?)` — does NOT exist (exists for appointments but those throw deprecation errors)
- `applyTag` typed wrapper (vs raw `addTag`) — for consistency with the receiver pattern
- `ghl_send_log` table — no centralized log; only `console.log("[GHL]")` exists
- Dry-run mode — none
- Test contact whitelist — none
- Dedup-by-payload-hash — none

Phase 6 builds these. Existing 21 callers continue to work.

### Architectural design

#### Receiver helpers (typed, logged, dedup-aware)

```typescript
// lib/ghl/receivers.ts (NEW)

interface SendOptions {
  dedupKey?: string;        // optional explicit dedup key; if omitted, hash of payload
  dryRun?: boolean;         // overridable per-call; defaults to env GHL_DRY_RUN
  testWhitelist?: boolean;  // if true AND patient not in whitelist, returns dry
  patientId?: string;       // UUID, for log correlation
  source?: string;          // 'phase4_nml' | 'phase5_migration' | 'phase8_at_risk' | etc
  templateId?: string;
}

export async function sendSms(
  contactId: string,
  body: string,
  opts: SendOptions = {}
): Promise<{ sent: boolean; logId: number; reason?: string }> {
  // 1. Resolve dry-run / whitelist
  // 2. Compute dedup key (hash body + contactId + 24h window)
  // 3. Check ghl_send_log for recent duplicate
  // 4. Get correct GHL client via getGHLClientForPatient(...)
  // 5. Call existing client.sendSms()
  // 6. Insert ghl_send_log row
  // 7. Return
}

export async function sendEmail(
  contactId: string,
  subject: string,
  body: string,
  opts: SendOptions = {}
): Promise<{ sent: boolean; logId: number; reason?: string }> {
  // Same shape as sendSms; uses GHL Conversations email API
}

export async function createTask(
  contactId: string,
  title: string,
  body: string,
  dueAt: Date,
  opts: SendOptions & { assigneeUserId?: string } = {}
): Promise<{ created: boolean; logId: number; ghlTaskId?: string }> {
  // GHL tasks API
}

export async function applyTag(
  contactId: string,
  tagName: string,
  opts: SendOptions = {}
): Promise<{ applied: boolean; logId: number }> {
  // Wraps existing addTag with logging
}
```

All four share:
- Routing through `getGHLClientForPatient()` (existing)
- Logging to `ghl_send_log`
- Dedup window (default 24h per-channel-per-contact-per-payload-hash)
- Dry-run support
- Test whitelist (env-defined contact IDs)
- Patient ID correlation

#### Send log table

```sql
CREATE TABLE ghl_send_log (
  id BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email', 'task', 'tag')),
  ghl_contact_id TEXT NOT NULL,
  patient_id UUID REFERENCES patients(patient_id),
  ghl_location_id TEXT NOT NULL,    -- which sub-account
  payload JSONB NOT NULL,            -- {body, subject, dueAt, etc}
  payload_hash TEXT NOT NULL,        -- sha256 of canonicalized payload
  source TEXT,                       -- caller: 'phase4_nml' | etc
  template_id TEXT,
  dedup_key TEXT,
  was_dry_run BOOLEAN DEFAULT false,
  was_whitelisted BOOLEAN DEFAULT false,
  was_deduped BOOLEAN DEFAULT false,
  ghl_response JSONB,                -- raw GHL API response
  ghl_external_id TEXT,              -- e.g., GHL message ID, task ID
  error TEXT,
  http_status INTEGER,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ghl_send_contact_channel ON ghl_send_log(ghl_contact_id, channel, sent_at DESC);
CREATE INDEX idx_ghl_send_patient ON ghl_send_log(patient_id, sent_at DESC);
CREATE INDEX idx_ghl_send_dedup ON ghl_send_log(payload_hash, sent_at DESC);
CREATE INDEX idx_ghl_send_source ON ghl_send_log(source, sent_at DESC);
```

#### Dry-run mode + whitelist

Three layers:

1. **Global env:** `GHL_DRY_RUN=true` → ALL receivers dry-run regardless of caller
2. **Per-call:** `sendSms(id, body, { dryRun: true })` → just this call dry-runs
3. **Whitelist:** `GHL_TEST_CONTACT_IDS=ctc_abc,ctc_def` — when set, sends ONLY to whitelisted contacts; non-whitelisted patients silently dry-run

Used in production:
- `GHL_DRY_RUN=false` (default)
- `GHL_TEST_CONTACT_IDS` empty (default)

Used in staging / first-week production:
- `GHL_DRY_RUN=true` for soak
- After soak: `GHL_DRY_RUN=false`, `GHL_TEST_CONTACT_IDS=phil's_contact_id` for smoke test
- After smoke: clear whitelist

#### Migration of existing 21 callers

Existing callers use `createGHLClient().sendSms(...)` directly. They keep working — the new receivers wrap these. Migrating callers to receivers is **optional** and low-priority; it earns them logging + dedup but isn't required.

Recommended: migrate the new Phase 4/5/8 nudges through receivers from Day 1. Migrate existing callers opportunistically.

#### Module 23 prerequisite

`docs/sot-modules/23-ghl-ai-agents.md` is currently mis-titled (contains brand color content). Phase 6 needs an accurate Module 23 documenting:
- The 12 outbound + 3 inbound + 3 booked workflows (post-Phase 2)
- Which Phase calls which receiver
- The send log structure
- Dry-run / whitelist procedures
- Jessica/Max agent state (if those exist; need to confirm with Phil what they were)

This is a Phase 6.0 prereq — must complete before any code change ships.

### Database schema changes

```sql
-- migrations/2026XXXX_ghl_send_log.sql

CREATE TABLE ghl_send_log (
  -- (full table as shown above)
);
```

No changes to existing GHL-related columns on `patients`. `ghl_contact_id`, `ghl_sync_status`, `ghl_tags` already exist and are used by `lib/patientGHLSync.ts`.

### Per-path code changes

| File | Change |
|---|---|
| `migrations/2026XXXX_ghl_send_log.sql` | NEW |
| `lib/ghl/receivers.ts` | NEW — `sendSms`, `sendEmail`, `createTask`, `applyTag` typed wrappers |
| `lib/ghl/dedup.ts` | NEW — payload-hash + window-check |
| `lib/ghl/whitelist.ts` | NEW — env parser + check |
| `lib/ghl.ts` | MODIFY — add `sendEmail()` and `createTask()` methods to `GHLClient` (raw API calls); receivers wrap these |
| `app/api/admin/ghl-send-log/route.ts` | NEW — list + filter |
| `app/admin/ghl-log/page.tsx` | NEW — staff visibility into sends |
| `components/admin/GHLSendLogTable.tsx` | NEW |
| `docs/sot-modules/23-ghl-ai-agents.md` | REWRITE — make it actually about GHL agents (currently has brand colors) |

### Won't-touch guarantees

- **Will NOT modify `lib/ghl.ts` location routing.** `getGHLClientForPatient()` stays as-is.
- **Will NOT modify existing `sendSms` method on `GHLClient`.** Receivers wrap; raw method unchanged.
- **Will NOT migrate existing 21 callers in Phase 6.** They keep working; opportunistic migration later.
- **Will NOT send any patient comm before `GHL_DRY_RUN=true` soak completes.**
- **Will NOT touch GHL contact data, tags, conversations, opportunities** beyond the new typed helpers.
- **Will NOT replace inbound webhook handlers.** `app/api/webhooks/ghl/messages/route.ts` etc unchanged.

### Acceptance criteria

1. **All 4 receivers callable.** Unit tests for each: dry-run + live (against test contact only).
2. **Dedup works.** Two identical `sendSms` calls within 24h → second logged as `was_deduped=true`, no actual send.
3. **Whitelist enforces.** With `GHL_TEST_CONTACT_IDS=ctc_phil`, calling `sendSms('ctc_other', ...)` → `was_whitelisted=false`, logged as dry.
4. **Send log accurate.** Manual `curl` to send test SMS → log row appears with correct contact, body, payload_hash, location.
5. **Existing callers unaffected.** All 21 callers' tests still pass; `lib/messaging.ts:199,263` broadcast still works.
6. **Module 23 accurate.** Rewritten module documents real workflow keep-list, send-log, dry-run procedure.
7. **Phase 4 NML nudge wired.** End-to-end: NML detection → receiver → log → dry-run shows correct payload.

### Risk + rollback

**Risks:**
- `sendEmail` API differs from SMS in GHL. **Mitigation:** Implement against staging first; validate with manual API exploration.
- Dedup hash collisions over long windows. **Mitigation:** sha256 + 24h window keeps collision space negligible; staff dashboard surfaces dedups for spot-check.
- 21 existing callers break due to side-effect of changes to `lib/ghl.ts`. **Mitigation:** New methods on `GHLClient` are purely additive; existing methods untouched. CI runs full test suite.
- Module 23 rewrite drifts from reality during Phase 6 soak. **Mitigation:** Module 23 is rewritten LAST in Phase 6 (sub-phase 6.7), based on actual deployed state.

**Rollback plan:**
- Receivers fail → existing direct GHL calls still work.
- `ghl_send_log` schema additive; safe to leave.
- Dry-run flag instantly reverts behavior.

### Sub-phases within Phase 6

| Sub-phase | Scope | Days | Blocker |
|---|---|---|---|
| 6.0 | Module 23 audit + Phil interview ("what were Jessica/Max?") | 1 | YES (Phil) |
| 6.1 | Schema (ghl_send_log) + dedup/whitelist helpers | 1 | |
| 6.2 | `sendEmail` raw method on GHLClient + receiver | 1.5 | |
| 6.3 | `createTask` raw method on GHLClient + receiver | 1.5 | |
| 6.4 | `applyTag` typed receiver | 0.5 | |
| 6.5 | Dry-run soak (GHL_DRY_RUN=true, run all Phase 4/5 wiring through receivers) | 3 | |
| 6.6 | Whitelist smoke test (Phil only) | 1 | |
| 6.7 | Production enable + Module 23 rewrite | 1 | |
| 6.8 | Admin send-log dashboard | 1.5 | |

Active engineering: ~10 days. Wall-clock: ~14 days incl Phil interview + soak.

### Open questions for Phil before kickoff

1. **Module 23 truth.** What ARE Jessica and Max? The INDEX advertises them; the file doesn't have them. Are they live agents I should document, or aspirational concepts? Need to know before Module 23 rewrite.
2. **GHL email API quirks.** Have you used GHL's email API before? Any known limits, formatting quirks, deliverability issues?
3. **Task assignee.** When creating staff tasks via `createTask`, who's the default assignee? Round-robin? Patient's primary provider? Specific user?
4. **Whitelist for soak.** Confirm your GHL contact ID for whitelist testing.
5. **Existing 21 callers.** Migrate in this phase, or defer? Recommend defer — they work, and Phase 6 is already large.

---

## Phase 6.5 — Unified Patient Entry Handler

**One-line goal:** every new-patient creation path — and there are ~25 of them per `27-patient-flow-map.md` — funnels through one orchestrator that writes `lead_source`, `source_path`, dedupes against existing patients (by email + phone + DOB + Healthie), creates the GHL contact via the right sub-account, and emits a single audit row per entry.

### Why this phase

`27-patient-flow-map.md` catalogs paths A through W (≥23 distinct entry paths into the patients table). Each path today does its own variant of:
- Insert patient
- Maybe create Healthie client
- Maybe create GHL contact  
- Maybe set status_key
- Rarely capture lead_source

This is where data quality dies. Phase 6.5 adds the orchestrator without rewriting all 23 paths — they call into it.

### Architectural design

#### The orchestrator

```typescript
// lib/patient-entry.ts (NEW)

export interface PatientEntryInput {
  // Identity
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  dob?: string;          // YYYY-MM-DD
  gender?: 'male' | 'female' | 'other' | 'unknown';

  // Source attribution
  sourcePath: SourcePath;  // enum, see below
  leadSource?: LeadSource; // optional; can be inferred from sourcePath
  utm?: Partial<UtmParams>;
  referrer?: string;

  // Routing
  desiredClinic?: 'mens_health' | 'primary_care' | 'longevity' | 'mental_health' | 'abxtac';
  desiredClientType?: string;  // FK to client_type_lookup

  // Provenance (caller passes these for audit)
  initiatedBy: 'patient' | 'staff' | 'system';
  initiatedByUserId?: number;  // staff user id if applicable
  externalRef?: {
    healthieId?: string;
    ghlContactId?: string;
    stripeCustomerId?: string;
  };

  // Optional extras
  notes?: string;
}

export interface PatientEntryResult {
  patientId: string;     // UUID
  created: boolean;       // false if matched existing
  matchedBy?: 'email' | 'phone+dob' | 'healthie_id' | 'ghl_contact_id' | 'manual_review';
  matchConfidence?: 'exact' | 'fuzzy' | 'ambiguous';
  ghlSynced: boolean;
  healthieClientId?: string;
  warnings: string[];
}

export async function handlePatientEntry(input: PatientEntryInput): Promise<PatientEntryResult> {
  // 1. Validate input
  // 2. Check for duplicates (existing patient by exact match → matched_by, return)
  // 3. Spouse check: same email → flag, allow if DOB+gender differ (per shared-email pin)
  // 4. Create patient row (UUID auto-generated)
  // 5. Create Healthie client if not externalRef.healthieId provided
  // 6. Create GHL contact via correct sub-account (uses getGHLClientForPatient)
  // 7. Insert patient_entry_audit row
  // 8. Insert lead_source_audit row (Phase 7 dependency)
  // 9. Emit Telegram alert if matchConfidence === 'ambiguous'
  // 10. Return result
}
```

#### Source path enum

```typescript
type SourcePath =
  | 'website_mens_health_signup'       // nowmenshealth.care intake form
  | 'website_primary_care_signup'      // nowprimary.care intake form  
  | 'website_longevity_signup'         // nowlongevity.care intake form
  | 'website_mental_health_signup'     // nowmentalhealth.care intake form
  | 'website_abxtac_signup'            // abxtac.com (or wherever) signup
  | 'mobile_app_signup'                // mobile-app/ user creates account
  | 'ipad_kiosk_intake'                // iPad in-clinic intake
  | 'staff_create_dashboard'           // staff manually creates via /admin/patients/new
  | 'healthie_webhook_new_client'      // Healthie webhook: new client created externally
  | 'ghl_webhook_new_lead'             // GHL form / webhook → new lead
  | 'ghl_webhook_appointment_booked'   // appointment booked → patient may be new
  | 'qbo_legacy_import'                // one-time QBO migration (Phase 5 input)
  | 'jane_legacy_import'               // one-time Jane CSV import (Phase 5 input)
  | 'manual_script';                   // catch-all for one-off scripts
```

14 source paths, mapped 1:1 to the entry-path catalog in Module 27.

#### Audit table

```sql
CREATE TABLE patient_entry_audit (
  id BIGSERIAL PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(patient_id),
  source_path TEXT NOT NULL,
  was_new BOOLEAN NOT NULL,            -- false if matched existing
  matched_by TEXT,
  match_confidence TEXT,
  ghl_synced BOOLEAN DEFAULT false,
  healthie_client_id TEXT,
  initiated_by TEXT NOT NULL,          -- 'patient' | 'staff' | 'system'
  initiated_by_user_id INTEGER REFERENCES users(id),
  warnings JSONB,
  raw_input JSONB,                     -- full PatientEntryInput for replay/debug
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_patient_entry_audit_patient ON patient_entry_audit(patient_id, created_at DESC);
CREATE INDEX idx_patient_entry_audit_source ON patient_entry_audit(source_path, created_at DESC);
CREATE INDEX idx_patient_entry_audit_warnings ON patient_entry_audit USING gin(warnings)
  WHERE jsonb_array_length(warnings) > 0;
```

#### Migration of existing entry points

23+ existing entry paths. Migration is opportunistic, ordered by traffic:

| Order | Path | Why first |
|---|---|---|
| 1 | `app/api/patients/route.ts` (admin create) | Highest volume; staff visibility |
| 2 | `app/api/webhooks/healthie/clients/*` | Already creates patients; needs dedup |
| 3 | `app/api/abxtac/book/route.ts` | New booking surface |
| 4 | iPad kiosk handlers | Mobile/iPad sync risk |
| 5 | Mobile app signup | Newer code, easier to migrate |
| 6+ | Remaining entry paths | Lower traffic; opportunistic |

Each migration is ~10-20 LOC: replace direct insert with `await handlePatientEntry({...})`.

#### Spouse handling (shared email)

Per `reference_shared_email_patients.md`: spouses can share one email (Janel + Rich Freeman). Don't treat shared email as duplicate by itself.

Dedup logic:
- Email match → check DOB AND gender
- If DOB OR gender differs → NOT a duplicate; new patient with `warning: 'shared_email_with_patient_X'`
- If DOB AND gender both match → likely duplicate; `matchedBy: 'email'`

### Database schema changes

```sql
-- migrations/2026XXXX_patient_entry.sql

CREATE TABLE patient_entry_audit (
  -- (full table above)
);

-- Optional: source_path column on patients (for first-touch attribution at row level)
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS source_path TEXT,
  ADD COLUMN IF NOT EXISTS source_path_set_at TIMESTAMPTZ;
```

UUID throughout.

### Per-path code changes

| File | Change |
|---|---|
| `migrations/2026XXXX_patient_entry.sql` | NEW |
| `lib/patient-entry.ts` | NEW — orchestrator |
| `lib/patient-entry/dedup.ts` | NEW — match logic with spouse handling |
| `lib/patient-entry/route-clinic.ts` | NEW — desiredClinic+clientType → GHL location |
| `app/api/patients/route.ts` | MODIFY — use orchestrator |
| `app/api/webhooks/healthie/clients/created/route.ts` | MODIFY — use orchestrator |
| `app/api/abxtac/book/route.ts` | MODIFY — use orchestrator |
| (other entry-path files) | MODIFY — opportunistic |
| `app/admin/patient-entry-audit/page.tsx` | NEW — staff visibility |

### Won't-touch guarantees

- **Will NOT mass-migrate all 23+ entry paths in Phase 6.5.** Top 5 only; rest opportunistic.
- **Will NOT change GHL contact creation behavior.** Uses existing `getGHLClientForPatient` routing.
- **Will NOT change Healthie client creation API.** Uses existing `lib/healthie.ts:createClient`.
- **Will NOT auto-merge ambiguous matches.** Ambiguous → Telegram alert, manual review.
- **Will NOT block on dedup failures.** If dedup check fails → create new patient with warning; don't block intake.

### Acceptance criteria

1. **Orchestrator works for top 5 paths.** Each path's tests pass after migration.
2. **Spouse handling correct.** Janel + Rich Freeman test case → both patients created, both flagged with shared_email warning, no merge.
3. **Audit row per entry.** `SELECT COUNT(*) FROM patients WHERE created_at > X` matches `SELECT COUNT(*) FROM patient_entry_audit WHERE created_at > X` for migrated paths.
4. **Source path required.** Calling orchestrator without `sourcePath` → typescript error at compile time.
5. **Phase 7 wiring.** `lead_source_audit` (Phase 7) gets a row for every orchestrator call (even when leadSource undefined → `unknown`).
6. **Telegram alert on ambiguous.** Synthetic ambiguous case (similar name + DOB) → Telegram fires within 30s.

### Risk + rollback

**Risks:**
- Migration breaks an entry path silently → patients drop. **Mitigation:** Per-path migration is single PR; CI tests; staging soak.
- Dedup too aggressive → legit new patient blocked. **Mitigation:** Default behavior is "create with warning, never block." Block requires explicit dedup-strict flag.
- Audit table grows fast (~10 rows/day at current intake). **Mitigation:** Negligible; no retention needed.
- Spouse handling misclassifies. **Mitigation:** Janel+Rich test case in CI; spot-check Telegram alerts for first 30 days.

**Rollback plan:**
- Per-path migration is per-PR; revert single PR to back out one path.
- Orchestrator can be feature-flagged off; reverts to per-path direct logic.

### Sub-phases within Phase 6.5

| Sub-phase | Scope | Days |
|---|---|---|
| 6.5.0 | Schema + orchestrator skeleton + dedup helper | 2 |
| 6.5.1 | Migrate `app/api/patients/route.ts` | 1 |
| 6.5.2 | Migrate Healthie webhook handlers | 1 |
| 6.5.3 | Migrate ABXTac booking | 1 |
| 6.5.4 | Migrate iPad kiosk handlers | 1.5 |
| 6.5.5 | Migrate mobile app signup | 1 |
| 6.5.6 | Audit dashboard | 1.5 |

Active engineering: ~9 days. Wall-clock: ~12 days.

### Open questions for Phil before kickoff

1. **Path enumeration completeness.** I have 14 source_path values. Module 27 catalogs A-W. Are there more paths I should know about?
2. **Spouse handling edge cases.** Janel+Rich is the canonical case. Any other shared-email families I should know about?
3. **Dedup strictness.** Default is "create with warning." Any path that should be strict (block on duplicate)? Recommend: none — better to create+warn than block intake.
4. **Migration ordering.** Top 5 confirmed? Or different priority?

---

## Phase 7 — Lead Source Taxonomy + Audit (UUID-corrected)

**One-line goal:** every new patient gets a `lead_source` value from a controlled enum, captured at the entry point (Phase 6.5), backfilled on existing patients where derivable, audit-trailed for changes, and surfaced on the CEO dashboard so marketing-spend attribution becomes possible.

### Why this phase

Marketing today flies blind: there's no way to answer "how many patients came from Google ads vs Facebook vs referral vs walk-in last month?" Every Phase 6.5 entry path either drops attribution or stores it inconsistently.

Phase 7 adds the taxonomy + storage; Phase 6.5 is the writer; existing dashboards consume the data.

### Architectural design

#### Lead source taxonomy (15 values)

```typescript
type LeadSource =
  | 'google_organic'
  | 'google_ads'
  | 'facebook_organic'
  | 'facebook_ads'
  | 'instagram_ads'
  | 'tiktok_ads'
  | 'other_paid_ad'
  | 'patient_referral'      // existing patient referred them
  | 'provider_referral'     // outside provider sent them
  | 'walk_in'
  | 'event_outreach'        // health fair, podcast, etc.
  | 'press_pr'
  | 'partner'               // formal partnership (e.g., gym chain)
  | 'unknown'
  | 'staff_internal';       // staff/family/test patient
```

Lookup table:
```sql
CREATE TABLE lead_source_lookup (
  lead_source TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('paid', 'organic', 'referral', 'other')),
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER
);
```

#### Storage

```sql
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS lead_source TEXT REFERENCES lead_source_lookup(lead_source),
  ADD COLUMN IF NOT EXISTS lead_source_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lead_source_detail JSONB;  -- {utm_source, utm_campaign, referrer, etc}

CREATE INDEX idx_patients_lead_source ON patients(lead_source);
```

Audit table:
```sql
CREATE TABLE lead_source_audit (
  id BIGSERIAL PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(patient_id),
  from_value TEXT,
  to_value TEXT NOT NULL,
  source TEXT NOT NULL,    -- 'patient_entry' | 'admin_override' | 'backfill' | 'utm_parser'
  source_detail JSONB,
  set_by_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_lead_source_audit_patient ON lead_source_audit(patient_id, created_at DESC);
```

UUID throughout (was wrong in v2).

#### UTM parser

```typescript
// lib/lead-source/parse-utm.ts (NEW)

export function parseUtmToLeadSource(utm: Partial<UtmParams>, referrer?: string): {
  leadSource: LeadSource;
  detail: Record<string, any>;
  confidence: 'high' | 'medium' | 'low';
} {
  // Examples:
  // utm_source=google + utm_medium=cpc → google_ads
  // utm_source=facebook + utm_medium=paid → facebook_ads
  // utm_source=google + utm_medium=organic → google_organic
  // referrer=google.com, no utm → google_organic
  // referrer=instagram.com → instagram_ads (assume; flag low confidence)
  // no signal → unknown
}
```

Mapping rules in `lib/lead-source/utm-rules.ts` (data-driven).

#### Source-path → lead-source default mapping

When `Phase 6.5 entry` fires without explicit `leadSource`:

| sourcePath | Default leadSource |
|---|---|
| `website_*_signup` (any) | `parseUtmToLeadSource(utm)` → if confidence high, use; else `unknown` |
| `mobile_app_signup` | `unknown` (no UTM in mobile app) |
| `ipad_kiosk_intake` | `walk_in` |
| `staff_create_dashboard` | `staff_internal` (default; staff overrides at create time) |
| `healthie_webhook_new_client` | `unknown` (no attribution) |
| `ghl_webhook_*` | `unknown` (until GHL form fields capture UTM) |
| `qbo_legacy_import` / `jane_legacy_import` | `unknown` |
| `manual_script` | `unknown` |

#### Backfill

Existing 459 patients get `lead_source='unknown'` by default. Phase 7.X may attempt:
- Patients with `created_at > some_date` AND in GHL with UTM tags → derive
- Patients with `referral_from_patient_id IS NOT NULL` (column may not exist; check) → `patient_referral`

Recommend: backfill is best-effort, tagged `source='backfill_inferred'` in audit. Don't pretend confidence we don't have.

#### Override

Admin endpoint allows changing `lead_source` per patient with reason. Logged in audit.

#### CEO dashboard

```
LEAD SOURCES (last 30 days)
─────────────────────────
New patients: 47
  Google Ads        18  ($X CAC)
  Patient Referral  12  ($0 CAC)
  Facebook Ads       8
  Walk-in            5
  Unknown            4  ⚠
```

CAC requires marketing-spend integration (out of scope for Phase 7; defer).

### Database schema changes

```sql
-- migrations/2026XXXX_lead_source.sql

-- 1. Lookup table
CREATE TABLE lead_source_lookup (
  lead_source TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('paid', 'organic', 'referral', 'other')),
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER
);

INSERT INTO lead_source_lookup (lead_source, display_name, category, sort_order) VALUES
  ('google_organic', 'Google Organic', 'organic', 10),
  ('google_ads', 'Google Ads', 'paid', 20),
  ('facebook_organic', 'Facebook Organic', 'organic', 30),
  ('facebook_ads', 'Facebook Ads', 'paid', 40),
  ('instagram_ads', 'Instagram Ads', 'paid', 50),
  ('tiktok_ads', 'TikTok Ads', 'paid', 60),
  ('other_paid_ad', 'Other Paid Ad', 'paid', 70),
  ('patient_referral', 'Patient Referral', 'referral', 80),
  ('provider_referral', 'Provider Referral', 'referral', 90),
  ('walk_in', 'Walk-in', 'other', 100),
  ('event_outreach', 'Event/Outreach', 'other', 110),
  ('press_pr', 'Press/PR', 'other', 120),
  ('partner', 'Partner', 'referral', 130),
  ('unknown', 'Unknown', 'other', 900),
  ('staff_internal', 'Staff/Internal', 'other', 999);

-- 2. Patient columns
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS lead_source TEXT REFERENCES lead_source_lookup(lead_source),
  ADD COLUMN IF NOT EXISTS lead_source_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lead_source_detail JSONB;
CREATE INDEX idx_patients_lead_source ON patients(lead_source);

-- 3. Audit
CREATE TABLE lead_source_audit (
  id BIGSERIAL PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(patient_id),
  from_value TEXT,
  to_value TEXT NOT NULL REFERENCES lead_source_lookup(lead_source),
  source TEXT NOT NULL CHECK (source IN ('patient_entry', 'admin_override', 'backfill', 'utm_parser')),
  source_detail JSONB,
  set_by_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_lead_source_audit_patient ON lead_source_audit(patient_id, created_at DESC);
```

### Per-path code changes

| File | Change |
|---|---|
| `migrations/2026XXXX_lead_source.sql` | NEW |
| `lib/lead-source/types.ts` | NEW — `LeadSource` union |
| `lib/lead-source/parse-utm.ts` | NEW |
| `lib/lead-source/utm-rules.ts` | NEW (data-driven mapping) |
| `lib/lead-source/source-path-defaults.ts` | NEW |
| `lib/patient-entry.ts` | MODIFY (Phase 6.5) — call into Phase 7 helpers; write audit |
| `app/api/admin/lead-source/[patientId]/route.ts` | NEW — override endpoint |
| `app/api/admin/lead-source-audit/route.ts` | NEW — list |
| `app/admin/marketing/page.tsx` | NEW — lead source breakdown view |
| `components/marketing/LeadSourceChart.tsx` | NEW |
| `public/ipad/app.js` | MODIFY — CEO widget |
| `scripts/lead-source/backfill.ts` | NEW (Phil-runnable) |

### Won't-touch guarantees

- **Will NOT modify `lead_source_lookup` rows after seed.** Phil owns this table.
- **Will NOT auto-overwrite a manually-set lead_source.** Backfill skips patients with non-NULL value.
- **Will NOT block patient creation on lead_source.** If null on create, defaults to `unknown`.
- **Will NOT touch attribution data in external systems** (Google Analytics, Facebook Pixel).

### Acceptance criteria

1. **Schema migrated.** All 459 patients have `lead_source` (defaulted to `unknown` if no inference possible).
2. **UTM parser correct.** Test cases: `utm_source=google&utm_medium=cpc` → `google_ads`. `utm_source=facebook` no medium → `facebook_organic`. Etc.
3. **Phase 6.5 wiring.** New patient via `app/api/patients/route.ts` with UTM params → correct lead_source written + audit row.
4. **Override works.** Admin sets lead_source via endpoint → patient row updated, audit row written.
5. **CEO dashboard.** Last-30-days breakdown matches `SELECT lead_source, COUNT(*) FROM patients WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY lead_source`.
6. **Backfill safe.** Run on production → never overwrites non-NULL lead_source; logs every set.

### Risk + rollback

**Risks:**
- UTM rules misclassify → wrong attribution → wrong marketing decisions. **Mitigation:** Mapping is data-driven and Phil-reviewable; backfill is best-effort; weekly review in early days.
- Audit table grows with every signup. **Mitigation:** ~10 rows/day; negligible.
- Override misuse — staff overrides aggressively, breaks attribution data. **Mitigation:** Admin-only RBAC; audit shows who.

**Rollback plan:**
- Schema additive; ignore columns to disable.
- Backfill is idempotent.

### Sub-phases within Phase 7

| Sub-phase | Scope | Days |
|---|---|---|
| 7.0 | Schema + lookup seed | 0.5 |
| 7.1 | UTM parser + rules | 1 |
| 7.2 | Phase 6.5 integration | 1 |
| 7.3 | Override endpoint + admin UI | 1.5 |
| 7.4 | Backfill script + Phil review | 1 |
| 7.5 | CEO dashboard widget | 1 |

Active engineering: ~6 days. Wall-clock: ~8 days incl Phil review.

### Open questions for Phil before kickoff

1. **Taxonomy completeness.** 15 values — anything missing or to combine?
2. **Patient referral capture.** How does staff capture that today? Need a UI affordance to log referring patient?
3. **Backfill scope.** Best-effort backfill of last 12 months? All time? Recommend last 12 months only.
4. **CAC integration.** Defer to Phase 7.5 (separate marketing-spend integration), or skip?
5. **Override RBAC.** Admin-only or any staff?

---

## Phase 8 — At-Risk Cron + Thresholds (hooks into existing signals)

**One-line goal:** make Stage 7 ("at-risk") an actually tracked cohort by reusing existing signal sources (`payment_issues`, `lab_review_queue`, Healthie sub state, dose cadence) instead of building from scratch — surface risks on a dashboard, nudge patient-actionable risks via Phase 6, escalate the rest to staff.

### Why this phase (corrected from v2)

v2 specced Phase 8 as a from-scratch detection system. Reality (verified 2026-04-24):

**Signals already exist that v2 would have rebuilt:**
- `payment_issues` table — populated by `morning-prep` cron + `daily-payment-check.js`
- `lab_review_queue` table — populated by lab fetch crons
- `staged_doses`, `peptide_dispenses`, `vials` — track dispense activity for dose-cadence checks
- Healthie webhook processor sets `hold_payment_research` on payment failures (Phase 1 audit catches transitions)
- `appointments` (Healthie) — visit cadence
- `prescription_cache` — Rx fill state

**What's missing:**
- A `risk_flags` JSONB column on patients
- A risk-detection cron (or extension) that consolidates signals into typed flags
- Threshold config per care line (clinical input gate)
- Resolution logging
- Patient-nudge governance
- Staff dashboard with severity sorting

Phase 8 builds these — but **the detection logic primarily reads from tables that already exist** rather than re-fetching from external APIs.

### Architectural design

#### Risk taxonomy (10 types, mostly data-already-flowing)

| Risk type | Source signal (already exists) | Patient-actionable? | Default threshold |
|---|---|---|---|
| `lab_overdue` | `prescription_cache` last lab date + Healthie | Yes | 6mo TRT, 12mo PC |
| `followup_overdue` | Healthie appointments last visit | Yes | 6mo TRT, 12mo PC |
| `payment_failed` | `payment_issues` table | Yes | 1 failure |
| `payment_paused` | Healthie subscription state | Yes | immediate |
| `missed_appointment` | Healthie appointments no-show | Yes | 1 no-show |
| `consent_expired` | Healthie form_answer_groups | Yes | 12mo |
| `unfilled_rx` | `prescription_cache` status | Yes | 14d |
| `legacy_billing_stalled` | `legacy_billing_migration.state IN ('link_sent', 'link_clicked') > 14d` (Phase 5) | No | 14d |
| `inactive_payment_active` | `status_key='inactive'` AND active recurring (Phase 1 also catches) | No | immediate |
| `dose_cadence_overdue` | `peptide_dispenses` last dispense + `dose_frequency_days` | Yes | 1.5x cadence |

Each risk type has:
- A detector function that reads from existing tables (NOT external APIs at scan time)
- A resolution detector (auto-clears flag when condition resolves)
- A threshold config per care line
- A patient-actionable flag

#### Care-line derivation (downscoped per healthie_group_id reality)

v2 assumed `patients.healthie_group_id` populated. Reality: only 4/459 patients have it.

Phase 8 derivation cascade:
1. If `healthie_group_id` set → map to care line via existing 6 group IDs (per `reference_healthie_tags_vs_groups.md`)
2. Else if `client_type_key LIKE '%nowmenshealth%'` OR `'%qbo_tcmh%'` OR `'%jane_tcmh%'` → `trt`
3. Else if `client_type_key LIKE '%primecare%'` OR `'%nowprimarycare%'` → `primary_care`
4. Else if `client_type_key LIKE '%abxtac%'` → `abxtac`
5. Else if `client_type_key LIKE '%longevity%'` → `longevity`
6. Else `clinic` column (where set: 130 patients) maps similarly
7. Else → `unknown` (skipped from at-risk scan with warning)

**Phase 8 sub-phase 8.0**: `healthie_group_id` backfill — fetch group membership for all 455 patients without one. Once backfilled, derivation collapses to step 1.

#### Detection cron design

`/api/cron/at-risk-scan/route.ts` runs daily at 4am Mountain (after morning-prep). Could alternatively be a `morning-prep` extension — both options viable. Recommend separate cron because:
- Different cadence later possible (run hourly for high-severity risks)
- Failure isolation (at-risk crash doesn't break morning-prep)
- Larger dataset, longer runtime — keep morning-prep fast

```typescript
async function runAtRiskScan({ dryRun }: { dryRun: boolean }) {
  const patients = await getActivePatientsForScan();  // status_key IN ('active', 'active_pending')

  for (const p of patients) {
    if (p.no_clinical_outreach) continue;  // suppression respected

    const careLine = deriveCareLine(p);
    const thresholds = RISK_THRESHOLDS[careLine];

    const newFlags: RiskFlag[] = [];
    for (const riskType of Object.keys(thresholds)) {
      const detector = RISK_DETECTORS[riskType];
      const result = await detector(p, thresholds[riskType]);
      if (result.flagged) newFlags.push({...});
    }

    const oldFlags = p.risk_flags ?? [];
    const diff = computeDiff(oldFlags, newFlags);

    if (!dryRun) {
      await persistFlags(p, newFlags);
      await logResolutions(p, diff.resolved);
      await maybeQueueNudge(p, diff.added);  // queue, don't send directly
    }
  }
}
```

Nudges are **queued** to a separate cron that respects rate limits + Phase 6 send-log dedup.

#### Risk-flag schema (UUID-corrected)

```sql
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS risk_flags JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS risk_flags_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_clinical_outreach BOOLEAN DEFAULT false,  -- if not already exists
  ADD COLUMN IF NOT EXISTS risk_overrides JSONB DEFAULT '{}'::jsonb;     -- {risk_type: {expires_at, reason}}

CREATE INDEX idx_patients_has_risks ON patients((jsonb_array_length(risk_flags) > 0))
  WHERE jsonb_array_length(risk_flags) > 0;

CREATE TABLE risk_resolution_log (
  id BIGSERIAL PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(patient_id),
  risk_type TEXT NOT NULL,
  flagged_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ DEFAULT NOW(),
  resolution_kind TEXT NOT NULL,
  resolution_detail JSONB
);
CREATE INDEX idx_risk_resolution_patient ON risk_resolution_log(patient_id, resolved_at DESC);

CREATE TABLE risk_nudge_log (
  id BIGSERIAL PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(patient_id),
  risk_type TEXT NOT NULL,
  nudge_kind TEXT NOT NULL,
  ghl_send_log_id BIGINT REFERENCES ghl_send_log(id),  -- Phase 6 dependency
  staff_task_id TEXT,
  nudge_template_id TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  attempt_number INTEGER NOT NULL
);
CREATE INDEX idx_risk_nudge_patient ON risk_nudge_log(patient_id, sent_at DESC);
```

UUID throughout.

#### Nudge governance (Phase 6 dependency)

Same as v2:
- Per-patient: max 1 risk-related nudge per 7 days
- Per-flag: max 3 nudges escalating in tone
- Suppression: `no_clinical_outreach=true` blocks all
- 3rd attempt → staff task instead of patient SMS
- Phil-approved templates required before send

All sends go through Phase 6 receivers — automatic dedup, send log.

#### Staff dashboard

Same as v2 spec — `/at-risk` page with severity/type/care-line/$ filters. iPad CEO widget summary.

### Database schema changes

(Shown above — all UUID.)

### Per-path code changes

| File | Change |
|---|---|
| `migrations/2026XXXX_at_risk.sql` | NEW |
| `lib/risk-thresholds.ts` | NEW (Phil-set values) |
| `lib/risk-detectors/lab-overdue.ts` | NEW |
| `lib/risk-detectors/followup-overdue.ts` | NEW |
| `lib/risk-detectors/payment-failed.ts` | NEW (reads `payment_issues`) |
| `lib/risk-detectors/payment-paused.ts` | NEW |
| `lib/risk-detectors/missed-appointment.ts` | NEW |
| `lib/risk-detectors/consent-expired.ts` | NEW |
| `lib/risk-detectors/unfilled-rx.ts` | NEW |
| `lib/risk-detectors/legacy-billing-stalled.ts` | NEW (reads Phase 5 table) |
| `lib/risk-detectors/inactive-payment-active.ts` | NEW (reads Phase 1 audit) |
| `lib/risk-detectors/dose-cadence-overdue.ts` | NEW |
| `lib/risk-detectors/index.ts` | NEW (registry) |
| `lib/risk-resolution.ts` | NEW |
| `lib/risk-nudge-queue.ts` | NEW (queues; doesn't send) |
| `lib/risk-nudge-templates/*.ts` | NEW (per type, draft) |
| `app/api/cron/at-risk-scan/route.ts` | NEW |
| `app/api/cron/at-risk-nudge-dispatch/route.ts` | NEW (consumes queue, sends via Phase 6) |
| `app/api/at-risk/list/route.ts` | NEW |
| `app/api/at-risk/[patientId]/dismiss/route.ts` | NEW |
| `app/api/at-risk/[patientId]/suppress/route.ts` | NEW |
| `app/at-risk/page.tsx` | NEW |
| `components/at-risk/AtRiskTable.tsx` | NEW |
| `components/at-risk/AtRiskDetailModal.tsx` | NEW |
| `public/ipad/app.js` | MODIFY |
| `crontab` | UPDATE — daily at-risk-scan; hourly nudge-dispatch |
| `scripts/at-risk/dry-run-report.ts` | NEW |
| `scripts/at-risk/calibrate-thresholds.ts` | NEW (sensitivity analysis) |
| `scripts/healthie-group-backfill.ts` | NEW (sub-phase 8.0 prerequisite) |
| `docs/sot-modules/[new]-at-risk-system.md` | NEW |

### Won't-touch guarantees

- **Will NOT auto-flip status_key.** Phase 1 hard rule.
- **Will NOT auto-cancel service.** Staff-only.
- **Will NOT modify clinical records.**
- **Will NOT send patient nudges before Phil approves templates.**
- **Will NOT exceed nudge rate limits.** Hard caps + kill-switch.
- **Will NOT flag `no_clinical_outreach=true` patients.**
- **Will NOT run before Phase 1, Phase 5, Phase 6 are live.** Hard dependencies.
- **Will NOT re-fetch external API data at scan time.** Reads existing tables (refreshed by other crons).

### Acceptance criteria

1. **healthie_group_id backfilled** for ≥95% of active patients (sub-phase 8.0).
2. **Detection accuracy.** Synthetic test fixtures per risk type — 100% pass.
3. **Threshold configurability.** Changing `RISK_THRESHOLDS` value → re-scan → cohort delta matches expectation.
4. **Phil dry-run review.** ≥90% of flagged sample (30 patients) are reasonable flags.
5. **Resolution tracking.** Synthetic patient flagged then resolved → flag clears + log row.
6. **Nudge rate limit.** Patient with 5 active risks → max 1 nudge / 7d, max 3 / flag-type.
7. **Staff dashboard usable.** Phil + staff work the view 30 min, no crashes.
8. **Phase 1 dependency.** Inactive patients NEVER scanned (verified).
9. **Phase 6 dependency.** All nudges flow through `ghl_send_log` (verified).
10. **Resolution rate metric.** 30 days post-launch: % flagged → resolved within 30d is non-zero.
11. **Kill-switch.** `AT_RISK_NUDGES_ENABLED=false` stops all nudges; flags continue.

### Risk + rollback

**Risks:**
- Threshold misconfiguration → flood. **Mitigation:** Sensitivity analysis (8.0) + Phil dry-run before live.
- False positive nudge from stale data. **Mitigation:** Detector re-checks at nudge dispatch time (between scan and send).
- Real positives ignored. **Mitigation:** 3rd attempt → staff task, not silent drop.
- Risk taxonomy bloat. **Mitigation:** Locked to 10 types; new type requires explicit code review.
- Provider-exempt patient flagged repeatedly. **Mitigation:** `risk_overrides` JSONB lets staff exempt per-type.
- Healthie data lag. **Mitigation:** Scan aborts if Healthie sync >12h old.

**Rollback plan:**
- `AT_RISK_SCAN_ENABLED=false` → cron exits.
- Widget feature-flagged off.
- `risk_flags` data preserved.
- `AT_RISK_NUDGES_ENABLED=false` → flags continue, no patient comm.

### Sub-phases within Phase 8

| Sub-phase | Scope | Days | Blocker |
|---|---|---|---|
| 8.0 | `healthie_group_id` backfill (prerequisite) | 1.5 | |
| 8.1 | Threshold sensitivity analysis (Phil + providers) | 2 | YES (clinical input) |
| 8.2 | Schema + thresholds config + risk taxonomy locked | 1 | |
| 8.3 | Risk detectors (10 types, leverages existing tables) | 3 | |
| 8.4 | Resolution detection + log writes | 1 | |
| 8.5 | Nudge queue + dispatcher + Phase 6 wiring | 2 | YES (Phase 6) |
| 8.6 | Phil-approved nudge templates (10 drafts) | 2 | YES (Phil) |
| 8.7 | Cron + dry-run mode + sensitivity report | 1 | |
| 8.8 | Staff dashboard + CEO widget | 2.5 | |
| 8.9 | Phil dry-run review session | 0.5 | YES (Phil) |
| 8.10 | Production rollout (flags-only first, nudges 2 weeks later) | 0.5 | |
| 8.11 | 30-day resolution-rate report + tuning | 1 | |

Active engineering: ~14 days. Wall-clock: ~28 days incl clinical input + template review + 2-week soak.

### Open questions for Phil before kickoff

1. **Threshold values per care line.** Gating question. 1-hour clinical meeting: Phil + Dr. Whitten + GLP-1 prescriber to lock `RISK_THRESHOLDS`.
2. **Risk type completeness.** 10 proposed — anything missing?
3. **Care-line derivation cascade.** Once `healthie_group_id` is backfilled, fall back to `client_type_key` matching (step 2-5)? Or require `healthie_group_id` always (skip patients without it with warning)?
4. **Nudge template approval.** 10 templates — review individually or as bundle?
5. **Provider follow-up flag storage.** Today: chart note? Need a structured field?
6. **Resolution rate target.** 40-60% recommended baseline; tune after 90 days.
7. **Flags-only soak period.** 2 weeks — acceptable?
8. **Staff task assignee for 3rd-attempt escalation.** Default to provider? Queue? Specific staff?

---

## Phase 9 — Weekly Billing Recon Email (uses SES + getClientSubscriptions)

**One-line goal:** Monday 8am, one email to admin@granitemountainhealth.com summarizing MRR, drift between billing systems, Phase 5 migration progress, Phase 8 at-risk pulse, weekly outliers, and a per-patient action-item list. Uses **AWS SES (already wired)** and reads Healthie via **`getClientSubscriptions(clientId)` (the actual API), not `recurringPayments(user_id)`**.

### Why this phase (corrected from v2)

v2 had two material errors:
1. **Inconsistent Healthie query.** v2 spec'd `recurringPayments(user_id)`. The codebase at `lib/healthie.ts:1043` uses a different (also valid) path: `getClientSubscriptions(clientId)` via `billingItems` with embedded `recurring_payment` sub-objects. Both queries return equivalent active-recurring data. Phase 9 uses `getClientSubscriptions` to stay consistent with the rest of the codebase. (The memory pin `feedback_healthie_recurring_query.md` documents the top-level `recurringPayments` query and was Phil-validated 2026-04-24; both paths work.)
2. **Email infrastructure overstated.** v2 said "use existing notifications layer (Postmark/SendGrid)." Reality: AWS SES already wired in two places — `lib/notifications.ts` (inventory alerts) and `lib/messaging.ts` (`SendEmailCommand` for patient broadcast). Phase 9 reuses SES, no new vendor.

Other carry-overs from v2 hold up: 6-section email format, drift detection rules, idempotent recon, dry-run period.

### Architectural design

#### Recon scope (5 sources, corrected query names)

| Source | Query | Authority |
|---|---|---|
| Healthie | `healthie.getClientSubscriptions(clientId)` per active patient — returns `billingItems` with active/cancelled/paused recurring_payment | **SOT** for membership |
| QBO | Existing `lib/quickbooks.ts` recurring invoices | Legacy-during-sunset |
| Jane | `legacy_billing_migration` table (Phase 5 ingestion) | Legacy-during-sunset |
| Stripe Direct | Direct charges last 7d not linked to Healthie invoice | Retail / one-time |
| Dashboard | `patients.client_type_key` (Phase 3 classification) | Derived |

#### 6-section email (same structure as v2)

1. **Totals this week vs last week** — MRR per source + change
2. **Migration progress** — Phase 5 state-machine snapshot
3. **Drift** — cross-system mismatches (5 rules below, severity-flagged)
4. **At-risk pulse** — Phase 8 snapshot if live
5. **Weekly outliers** — biggest new active, biggest cancellation, payment streaks
6. **Action items** — per-patient verbs derived from drift + migration

Plaintext body, HTML version optional, no attachments. Patient IDs hyperlink to dashboard.

#### Drift detection rules (UUID-corrected)

Same 7 rules as v2:

| Rule | Logic | Severity |
|---|---|---|
| `double_billing` | Active recurring in ≥2 of {Healthie, QBO, Jane} | 🔴 CRITICAL |
| `inactive_but_billing` | `status_key='inactive'` AND active recurring anywhere | 🟠 MEDIUM |
| `active_no_billing` | `status_key='active'` AND no active recurring AND `is_pro_bono=false` | 🟡 LOW |
| `orphan_recurring` | Healthie recurring without dashboard patient row | 🟡 LOW |
| `pending_too_long` | `status_key='active_pending'` >7 days (Phase 4 catches) | 🟡 LOW |
| `failed_payment_streak` | Healthie recurring with ≥3 consecutive failures | 🟠 MEDIUM |
| `bumpy_amount` | Same patient's monthly amount changed by >$50 last 30d | 🟡 LOW |

#### Recon engine

```typescript
// lib/billing-recon/compute.ts (NEW)

export async function computeBillingRecon(asOf: Date): Promise<BillingReconReport> {
  const [healthie, qbo, jane, stripe, dashboard] = await Promise.all([
    fetchHealthieRecurring(),     // uses getClientSubscriptions per active patient
    fetchQboRecurring(),           // uses lib/quickbooks.ts
    fetchJaneFromMigrationTable(), // reads legacy_billing_migration
    fetchStripeDirectLast7Days(),
    fetchDashboardClassification(), // patients.client_type_key snapshot
  ]);

  const totals = computeTotals(healthie, qbo, jane, stripe, dashboard);
  const drift = computeDrift(healthie, qbo, jane, dashboard);
  const migration = computeMigrationProgress(asOf);  // reads Phase 5 table
  const atRisk = await computeAtRiskSnapshot(asOf);  // Phase 8 if live
  const outliers = computeOutliers(asOf);
  const actions = buildActionItems(drift, migration, atRisk);

  return { totals, drift, migration, atRisk, outliers, actions, asOf };
}
```

Each `fetch*` returns `Map<patientId UUID, { source, monthlyAmount, product, status }>`.

#### Healthie fetch detail

```typescript
// lib/billing-recon/fetch-healthie.ts (NEW)

import { getHealthieClient } from '@/lib/healthie';

export async function fetchHealthieRecurring(): Promise<Map<string, RecurringRecord>> {
  const client = getHealthieClient();
  const activePatients = await query<PatientRow>(
    `SELECT patient_id, healthie_client_id FROM patients
     WHERE status_key IN ('active', 'active_pending') AND healthie_client_id IS NOT NULL`
  );

  const result = new Map<string, RecurringRecord>();

  for (const p of activePatients) {
    const subs = await client.getClientSubscriptions(p.healthie_client_id);
    const active = subs.filter(s => s.status === 'active');
    if (active.length > 0) {
      result.set(p.patient_id, {
        source: 'healthie',
        monthlyAmount: sumMonthly(active),
        products: active.map(s => s.product),
        status: 'active',
      });
    }
  }

  return result;
}
```

Rate-limited via existing `healthieRateLimiter.acquire()` inside `getClientSubscriptions`.

#### Storage

```sql
CREATE TABLE billing_recon_runs (
  id BIGSERIAL PRIMARY KEY,
  run_at TIMESTAMPTZ DEFAULT NOW(),
  as_of_date DATE NOT NULL UNIQUE,
  totals JSONB NOT NULL,
  drift JSONB NOT NULL,
  migration JSONB,
  at_risk JSONB,
  outliers JSONB,
  actions JSONB NOT NULL,
  email_sent_at TIMESTAMPTZ,
  email_recipient TEXT,
  email_message_id TEXT,
  errors JSONB
);
CREATE INDEX idx_billing_recon_as_of ON billing_recon_runs(as_of_date DESC);
```

`UNIQUE (as_of_date)` enforces idempotency — re-runs UPSERT, never duplicate.

#### Email delivery via SES

```typescript
// lib/notifications/billing-recon-email.ts (NEW)

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const sesClient = new SESClient({ region: process.env.AWS_SES_REGION ?? 'us-east-2' });

export async function sendBillingReconEmail(report: BillingReconReport): Promise<{ messageId: string }> {
  const { plaintext, html } = renderBillingReconEmail(report);
  const recipient = process.env.BILLING_RECON_EMAIL ?? 'admin@granitemountainhealth.com';

  const command = new SendEmailCommand({
    Source: process.env.SES_SENDER ?? 'noreply@granitemountainhealth.com',
    Destination: { ToAddresses: [recipient] },
    Message: {
      Subject: { Data: `GMH Weekly Billing Recon — ${formatDate(report.asOf)}` },
      Body: {
        Text: { Data: plaintext },
        Html: { Data: html },
      },
    },
  });

  const response = await sesClient.send(command);
  return { messageId: response.MessageId! };
}
```

Reuses the SES client setup pattern from `lib/notifications.ts` and `app/api/cron/morning-prep/route.ts`.

#### Cron

`/api/cron/billing-recon-weekly/route.ts` runs Mondays 8am Mountain (15:00 UTC). Crontab:

```
0 15 * * 1 curl -sS -H "x-cron-secret: $CRON_SECRET" https://nowoptimal.com/ops/api/cron/billing-recon-weekly/
```

Idempotent: UPSERT to `billing_recon_runs(as_of_date)`. Re-runs on the same date update existing row, only send email if `email_sent_at IS NULL`.

#### Existing-cron coordination (NEW vs v2)

Phase 9 does NOT duplicate existing reconciliation crons. Instead:
- **Reads from `payment_issues`** (populated by `morning-prep` and `daily-payment-check`) for `failed_payment_streak` rule
- **Reads from `patient_status_audit`** (Phase 1) for `inactive_but_billing` cross-check
- **Reads from `legacy_billing_migration`** (Phase 5) for migration section
- **Reads from `risk_flags`** (Phase 8) for at-risk pulse

The existing `patient-reconciliation` and `healthie-id-audit` crons continue running independently; Phase 9 doesn't touch them.

### Database schema changes

```sql
-- migrations/2026XXXX_billing_recon.sql

CREATE TABLE billing_recon_runs (
  id BIGSERIAL PRIMARY KEY,
  run_at TIMESTAMPTZ DEFAULT NOW(),
  as_of_date DATE NOT NULL,
  totals JSONB NOT NULL,
  drift JSONB NOT NULL,
  migration JSONB,
  at_risk JSONB,
  outliers JSONB,
  actions JSONB NOT NULL,
  email_sent_at TIMESTAMPTZ,
  email_recipient TEXT,
  email_message_id TEXT,
  errors JSONB
);
CREATE INDEX idx_billing_recon_as_of ON billing_recon_runs(as_of_date DESC);
CREATE UNIQUE INDEX idx_billing_recon_as_of_uq ON billing_recon_runs(as_of_date);
```

### Per-path code changes

| File | Change |
|---|---|
| `migrations/2026XXXX_billing_recon.sql` | NEW |
| `lib/billing-recon/fetch-healthie.ts` | NEW (uses `getClientSubscriptions`) |
| `lib/billing-recon/fetch-qbo.ts` | NEW (uses existing `lib/quickbooks.ts`) |
| `lib/billing-recon/fetch-jane.ts` | NEW (reads `legacy_billing_migration`) |
| `lib/billing-recon/fetch-stripe.ts` | NEW |
| `lib/billing-recon/fetch-dashboard.ts` | NEW |
| `lib/billing-recon/compute.ts` | NEW (totals + drift + outliers) |
| `lib/billing-recon/build-actions.ts` | NEW |
| `lib/billing-recon/render-email.ts` | NEW (plaintext + HTML) |
| `lib/notifications/billing-recon-email.ts` | NEW (SES sender — uses existing SES client setup) |
| `app/api/cron/billing-recon-weekly/route.ts` | NEW |
| `app/api/billing-recon/latest/route.ts` | NEW |
| `app/api/billing-recon/[id]/email-html/route.ts` | NEW |
| `app/billing-recon/page.tsx` | NEW |
| `components/billing-recon/MrrTrendChart.tsx` | NEW |
| `components/billing-recon/DriftList.tsx` | NEW |
| `public/ipad/app.js` | MODIFY |
| `crontab` | UPDATE — Mon 8am Mountain |
| `scripts/billing-recon/preview.ts` | NEW (Phil-runnable, no send) |

### Won't-touch guarantees

- **Read-only across all systems.** Never writes to Healthie/QBO/Jane/Stripe.
- **No automatic remediation.** Surfaces drift; never fixes.
- **No patient-facing email.** Recipient is admin@ only (env-overridable).
- **No PHI in body** beyond patient ID + MRR + brief reason. No names, DOBs, medical detail.
- **No new email vendor.** Uses existing AWS SES.
- **Will NOT replace Phase 5's migration tracker.** Reports on it.
- **Will NOT replace Phase 8's at-risk dashboard.** Shows snapshot count.
- **Will NOT alert when nothing changed.** Email goes out (operational rhythm); action items section says "None this week."

### Acceptance criteria

1. **Single email arrives.** First Monday after deploy: one email at admin@. Subject includes date.
2. **Totals accurate.** Healthie MRR matches manual sum of `getClientSubscriptions` results within $50.
3. **Drift items make sense.** ≥90% of items in first email are real drifts per Phil's gut-feel review.
4. **Action items actionable.** Each has patient ID + verb. No vague prompts.
5. **Trend works.** Week 4 shows 4 data points in MRR chart.
6. **No double-send.** Cron idempotent — running twice on same date sends one email max.
7. **Failure-mode visible.** If Healthie/QBO down at 8am, email goes anyway with "data partial" notice.
8. **Read-only verified.** No external writes; logged.
9. **Dashboard widget matches email.** Counts identical.
10. **Phil can preview.** `node scripts/billing-recon/preview.ts` outputs HTML to stdout without sending.
11. **Phase 5 dependency.** Resilient to lag — flags missing data rather than reporting $0.

### Risk + rollback

**Risks:**
- Email recipient typo. **Mitigation:** Phase 9.0 wiring test sends "Phase 9 wiring test" to admin@.
- Drift logic off-by-one. **Mitigation:** Phase 9.5 = 2-week dry-run review.
- QBO API down → totals understated. **Mitigation:** Per-source error reporting in email.
- `getClientSubscriptions` rate limits at 459 patients × weekly. **Mitigation:** Existing `healthieRateLimiter` at 5 req/s = ~90s for full sweep; acceptable.
- Email rendering breaks in Phil's client. **Mitigation:** Plaintext-first; HTML enhancement.
- PHI leak. **Mitigation:** Strict `[Patient ID NNNN]` format; redaction test.
- Healthie sync lag. **Mitigation:** Recon aborts if last sync >24h.

**Rollback plan:**
- `BILLING_RECON_ENABLED=false` → cron exits.
- Schema additive.
- Past runs preserved.
- Widget feature-flagged off.

### Sub-phases within Phase 9

| Sub-phase | Scope | Days |
|---|---|---|
| 9.0 | SES wiring test (confirm delivery to admin@) | 0.5 |
| 9.1 | Schema + per-source fetchers | 2 |
| 9.2 | Compute + drift logic + unit tests | 1.5 |
| 9.3 | Render plaintext + HTML | 1 |
| 9.4 | Cron + send + persist | 1 |
| 9.5 | Dry-run for 2 weeks (compute + persist + preview, NO send) | (calendar) |
| 9.6 | Phil reviews 2 dry-runs → adjustments | 0.5 |
| 9.7 | Enable send → first real email Monday | 0 |
| 9.8 | Dashboard widget + historical view | 1.5 |
| 9.9 | Documentation | 0.5 |

Active engineering: ~7 days. Wall-clock: ~21 days incl 2-week dry-run soak.

### Open questions for Phil before kickoff

1. **SES sender.** Confirm `noreply@granitemountainhealth.com` (or different)? SES domain must be verified.
2. **Recipient list.** admin@ only? CFO? Bookkeeper? Recommend admin@ only initially.
3. **Day + time.** Mon 8am Mountain confirmed?
4. **Dry-run period.** 2 weeks acceptable?
5. **Drift rule additions/drops.** Specifically: should we add a "client_type_key mismatched between dashboard and reality" rule? Phase 3 catches but Phase 9 could double-check.
6. **At-risk integration.** Include Phase 8 pulse in email?
7. **MRR projection.** Include "Projected sunset date: 9 weeks at current pace"? Or premature?
8. **Action-item completion tracking.** Email mentions "Last week: 3 done, 2 carried over"? Adds complexity. Recommend defer.
9. **Email retention.** Keep `billing_recon_runs` indefinitely or 12mo?
10. **Phase ordering.** Could ship Phase 9 earlier (week 2-3) to catch drift during rollout? Only depends on Phase 3 + Phase 5.

---

## Stage → Phase Coverage Matrix

| Stage (per `27-patient-flow-map.md`) | Phase(s) covering it |
|---|---|
| 1 — Lead | 6.5, 7 |
| 2 — Booked | (existing webhooks adequate; Phase 6.5 normalizes entry) |
| 3 — Intake | (existing morning-prep cron) |
| 4 — Evaluated | 4 |
| 5 — Onboarded | 3, 4 |
| 6 — Active | 3, 5, 9 |
| 7 — At-risk | 8, 9 |
| 8 — Off-service | 1, 9 |

Cross-cutting: Phase 2 (GHL graph hygiene), Phase 6 (channel send infra), Module 23 rebuild (Phase 6 prereq).

Every Module 27 stage has at least one phase. Every Module 27 GAP (Stage 1 lead source, Stage 4 NML, Stage 7 at-risk thresholds, Stage 8 inactive without cancel-check, GHL workflow sprawl) maps to a phase that closes it.

---

## What ships first (final sequence)

Concretely scoped:

1. **Week 1:** Phase 1 (Inactive Safety) + Phase 2 (GHL Disable, parallel) + Module 23 rebuild starts
2. **Week 2:** Phase 3 (Auto-Classification) — needs Phase 1 done
3. **Week 3:** Phase 5 (Migration Tracker) + Phase 4 (NML Queue, parallel) — both need Phase 3
4. **Week 4:** Phase 6 (GHL Rebuild) — needs Module 23 + Phase 2 soak complete
5. **Week 5:** Phase 6.5 (Entry Handler) + Phase 7 (Lead Source) — Phase 7 needs 6.5
6. **Week 5–6:** Phase 9 (Billing Recon Email) — could start week 4 if Phase 3+5 stable
7. **Week 6+:** Phase 8 (At-Risk Cron) — last; clinical thresholds gate it

**Active engineering total:** ~5–6 weeks
**Wall-clock total:** ~7–8 weeks (Phil-review gates + soak periods)

Must-haves for "production hardened": Phases 1, 2, 3, 5, 4 (weeks 1–3).
Revenue-unlockers: Phases 6, 7, 9 (weeks 4–5).
Clinical-dependent: Phase 8 (week 6+).

---

## Implementation principles (carry through every phase)

1. **UUID everywhere.** `patient_id` is `uuid`. No exceptions.
2. **No new column when existing one fits.** Phase 3 dropped `billing_source`; same discipline applied throughout.
3. **No new infra when existing infra works.** Phase 9 uses SES; Phase 8 reuses morning-prep signals; Phase 6 wraps existing `lib/ghl.ts` instead of replacing.
4. **Audit everything that mutates state.** Phase 1, 3, 5, 6, 7, 8 all add audit tables. Status, classification, lead source, and risk transitions are all queryable.
5. **Read existing tables before re-fetching from APIs.** Phase 8's at-risk scan reads `payment_issues`, `prescription_cache`, `legacy_billing_migration` rather than re-pulling from Healthie.
6. **Dry-run before live.** Every phase that mutates production data has a dry-run sub-phase + Phil review gate.
7. **Phase 1 hard rule preserved.** `inactive` is human-only. No webhook, cron, or external system can set it. Codified in `lib/status-transitions.ts` and auditable.
8. **One workflow per channel.** Phase 6 receivers + Phase 2 keep-list lock the architecture per `feedback_ghl_workflow_pattern.md`.

---

## Open meta-questions for Phil

1. **Sequence flexibility.** v3 ordering is recommendation. Bias differently if a stakeholder needs a particular phase faster (e.g., marketing wants Phase 7 sooner).
2. **Module 23 rewrite scope.** What is "Jessica/Max"? Need to know before Phase 6.
3. **Healthcare team availability for Phase 8 thresholds.** Calendar dependency — when can clinical meeting happen?
4. **CSV cadence for Phase 5.** How often will Jane CSV exports happen?
5. **Acceptance review style.** Per-phase Phil sign-off, or batched? Recommend per-phase since each has Phil-review gates already.
6. **What's NOT in this plan that should be?** v3 covers Modules 27 stages 1-8 plus cross-cutting. Anything from Modules 22 (brand), 25 (classification), or operational SOPs that needs hardening too?

---

## Document changelog

- **v1** (lost — pre-2026-04-24)
- **v2** drafted 2026-04-24 from `27-patient-flow-map.md` + Phil's 5 answers. All 10 phases at uniform depth.
- **v2 audit** flagged ~half the phases as inaccurate (`28-hardening-plan-v2-audit.md`).
- **v3** drafted 2026-04-24, this document. Verifications:
  - Direct DB queries against production: `\d patients`, `SELECT DISTINCT status_key, count(*)`, `client_type_lookup` enumeration, `clinic` distribution, jane_id/qbo_customer_id population
  - Code-path inventory of 16 `status_key` writers
  - `lib/ghl.ts` + `lib/healthie.ts` shape audit (all exports + callers)
  - Existing reconciliation cron inventory (10 found)
  - Email infrastructure audit (AWS SES already wired in 2 places)
  - SOT module 23 read (mis-titled — content is brand colors, not GHL agent docs)
  - Plan v2 read in full (all 3,162 lines)
- Memory pin `feedback_healthie_recurring_query.md` will be corrected in a separate edit (recurringPayments → getClientSubscriptions via billingItems).

---

*v3 drafted 2026-04-24 by AntiGravity (Claude Opus 4.7) + Phil verification pass. Replaces `28-hardening-plan-v2.md` as canonical operating doc. Awaiting Phil sign-off before kicking off Phase 1.*
