# Hardening Plan v2 — Patient-Flow-Aligned

> **Status:** DRAFT v2, rebuilt 2026-04-24 after the Patient Flow Map (sot-modules/27) and Phil's answers to all 5 open questions.
> **Supersedes:** the original 6-phase hardening plan (decisions captured in `~/.claude/projects/-home-ec2-user/memory/project_hardening_plan_decisions.md`). Phases 1+4 from v1 still ship FIRST; v2 just reframes and adds GHL reset, auto-classification, No Man's Land, and lead-source as their own phases tied to the flow map.

---

## Guiding principles (locked, do not relitigate)

1. **Healthie is SOT for membership and recurring billing.** Dashboard derives classification mechanically; never auto-toggles `status_key`.
2. **GHL workflows are dumb webhook receivers, one per channel.** Branching/protocol logic lives in code (Lambda + dashboard).
3. **Inactive is a human-only state transition.** Always coupled with a Healthie recurring cancel.
4. **No regression to existing patient/Healthie state.** Every phase has a "won't touch" guarantee written into its scope.
5. **Migration is a forcing function.** QBO + Jane are sunsetting ASAP; phases that affect billing should accelerate that, not just observe it.

---

## Phase ordering rationale

Order = (risk reduction) → (eliminate sources of drift) → (revenue unlock) → (visibility/velocity) → (rebuild + new automation).

| Phase | Stage(s) served | What it stops bleeding | Risk | Effort |
|---|---|---|---|---|
| 1 | Stage 8 | Phantom charging after staff marks inactive | LOW | S |
| 2 | All | Stale GHL workflows firing legacy logic | LOW | S |
| 3 | Stage 5 / 6 | Manual misclassification + drift | MED | M |
| 4 | Stage 4→5 | Revenue leak in No Man's Land | MED | M |
| 5 | Stage 6 | Legacy QBO/Jane patients unchanged | LOW | S |
| 6 | All channel sends | Ad-hoc / unmaintained workflow graph | MED | M |
| 7 | Stage 1 | Lost lead-source attribution | LOW | S |
| 8 | Stage 7 | Silent failures, no at-risk visibility | MED | L |
| 9 | All billing | Reconciliation drift across systems | LOW | M |

---

## Phase 1 — Inactive Safety (Stage 8) — DETAILED SPEC

**One-line goal:** make it physically impossible to flip a patient to `status_key='inactive'` while they have an active Healthie recurring or unverified legacy billing — eliminating the phantom-charging risk where a patient is "off" in the dashboard but still being billed in Healthie/QBO/Jane.

### Why this phase exists

From the 2026-04-24 audit: today, when staff marks a patient `inactive`, NOTHING checks whether the Healthie recurring was also canceled. A patient can be flipped to `inactive` and **continue to be charged monthly** until a human notices. This is:

1. **A revenue-trust problem.** Patients getting charged after explicitly being told they're off-service generates refund disputes, chargebacks, and credibility damage.
2. **A reconciliation problem.** Phase 9's billing-recon email surfaces the drift weekly, but only after the damage has already happened. Phase 1 stops the bleed at the source.
3. **A hidden cost during QBO/Jane sunset.** Legacy systems compound the risk because staff has to manually cancel in 2 places (Healthie + legacy) when migrating a patient off, and "marked inactive" is the action that's supposed to verify both happened.

This phase is the smallest, highest-impact safety gate in the entire plan.

---

### Architectural design

#### Two-layer guard

**Layer 1: API-level block (server-side enforcement).** Every code path that can mutate `patients.status_key` runs through a single guard function. The guard is the law — UI-side checks are convenience, not security.

**Layer 2: UI feedback (dashboard, iPad, Patient 360).** Each UI surfaces the block reason inline with a deep-link to the right Healthie page so staff can fix the underlying state. UIs do not allow bypassing the guard.

#### The guard function: `lib/inactive-guard.ts`

A new module exporting one function called by every status-mutation path.

```ts
// lib/inactive-guard.ts (new file)

export interface InactiveGuardInput {
  patientId: number;
  requestedStatusKey: PatientStatusKey;       // any value the API will set
  triggeredBy: { userId: number; reason?: string };
}

export interface InactiveGuardResult {
  allowed: boolean;
  blockReason?: 'active_healthie_recurring'
              | 'unverified_legacy_billing'
              | 'guard_query_failed';
  blockDetails?: {
    healthieRecurringIds?: string[];
    legacyBillingSource?: BillingSource;
    healthieBillingDeepLink?: string;
    suggestedAction: string;        // "Cancel Healthie recurring at <link>, then retry"
  };
}

export async function checkInactiveTransition(
  input: InactiveGuardInput
): Promise<InactiveGuardResult>;
```

The guard is invoked ONLY when `requestedStatusKey === 'inactive'`. All other transitions (active ↔ active_pending ↔ hold_payment_research ↔ hold_patient_research) pass through without any check — they're orthogonal to billing.

#### Internal flow inside `checkInactiveTransition()`

1. **Load the patient** by `patientId` (need `healthie_id` and `billing_source`).
2. **Query Healthie** via `recurringPayments(user_id: <healthie_id>)`. Filter to active states (per `feedback_healthie_recurring_query` pin: use `recurringPayments`, NOT `userPackageSelections`).
3. **If ≥1 active recurring exists**:
   - Return `allowed: false`, `blockReason: 'active_healthie_recurring'`, `blockDetails` populated with:
     - The Healthie recurring IDs
     - A deep link: `https://gmh.gethealthie.com/users/<healthie_id>/billing` (or whichever Healthie URL is the right place to cancel — confirmed during build)
     - `suggestedAction: "Cancel the Healthie recurring at <link>, then re-attempt mark-inactive."`
4. **If `billing_source IN ('qbo_legacy', 'jane_legacy', 'primecare_legacy', 'ins_supp_legacy')`** AND `billing_source` was set within the last 30 days (i.e., the patient was recently flagged as on legacy billing and the migration hasn't completed):
   - Return `allowed: false`, `blockReason: 'unverified_legacy_billing'`, with details:
     - `legacyBillingSource: <enum>`
     - `suggestedAction: "Patient is on legacy <system> billing. Cancel <system> subscription, confirm cancellation, then re-attempt mark-inactive."`
   - Note: this only applies during the QBO/Jane sunset window. Once `billing_source = 'none'` is set (after migration or cancellation), the guard passes.
5. **If Healthie query itself fails** (network, 5xx, auth):
   - Return `allowed: false`, `blockReason: 'guard_query_failed'` — fail closed. Don't allow the inactive flip when we can't verify state.
   - Telegram alert to admin@ (via existing notification infra) so this gets attention quickly.
6. **Otherwise**: return `allowed: true`. Caller proceeds with the status update.

#### Integration points (where the guard is called)

The guard wraps every API path that can mutate `status_key`. Audit shows these candidates — Phase 1 implementation must verify completeness with `grep -rn "status_key" app/`:

| API path | Current behavior | Guard insertion point |
|---|---|---|
| `app/api/patients/[id]/status/route.ts` (PATCH) | Direct status update | Call guard before the UPDATE statement |
| `app/api/patients/[id]/route.ts` (PATCH) | Generic patient update — may include `status_key` | If `body.status_key === 'inactive'`, call guard |
| `app/api/patients/route.ts` (POST) | Patient create | If created with `status_key='inactive'`, call guard (rare but possible) |
| `app/api/cron/patient-reconciliation/route.ts` | NEVER write `inactive` (hard rule from `reference_status_key_semantics`) | Add an assertion: cron is forbidden from setting `inactive`; guard returns `false` for cron callers |
| Direct SQL via psql / migrations | Outside the guard | Add a Postgres trigger as Layer 0 belt-and-suspenders (see below) |

#### Layer 0: Postgres trigger (belt-and-suspenders)

In addition to the API-level guard, add a Postgres trigger that fires on `UPDATE patients` and blocks any transition to `status_key='inactive'` unless a session-level setting `app.inactive_guard_passed = 'true'` is present. The guard function sets this setting after passing its checks.

```sql
-- migrations/2026XXXX_inactive_guard_trigger.sql

CREATE OR REPLACE FUNCTION enforce_inactive_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.status_key = 'inactive' AND OLD.status_key IS DISTINCT FROM 'inactive' THEN
    -- Allow only if session flag is set (set by lib/inactive-guard.ts after passing)
    IF current_setting('app.inactive_guard_passed', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Cannot set status_key=inactive without passing inactive guard. See lib/inactive-guard.ts.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER patients_inactive_guard
  BEFORE UPDATE ON patients
  FOR EACH ROW
  EXECUTE FUNCTION enforce_inactive_guard();
```

This catches:
- Direct psql edits by accident
- New API paths added in the future that forget to call the guard
- Migration scripts that bulk-modify status

The application sets `SET LOCAL app.inactive_guard_passed = 'true';` inside the same transaction immediately after the guard returns `allowed: true`, so legitimate flows pass through.

---

### The inactive notification (the Phase-1-original deliverable)

When the status flip succeeds, fire a notification:

| Channel | Recipient | Payload |
|---|---|---|
| Email | admin@granitemountainhealth.com | Subject: "Patient marked inactive: <name>". Body: who marked them, when, prior status, healthie_id, last activity dates, last billing event |
| Telegram | Phil's bot | Same data, condensed |
| `agent_action_log` row | (audit) | Full structured record |

A new helper in `lib/notifications/inactive-notification.ts`:

```ts
export async function notifyInactiveTransition(input: {
  patient: PatientRow;
  triggeredBy: { userId: number; userEmail: string };
  priorStatus: PatientStatusKey;
  guardResult: InactiveGuardResult;     // even though allowed, log the check that ran
}): Promise<void>;
```

The notification fires **after** the DB commit, never before — if the email/Telegram fails, the status change still stands; failure is logged but doesn't roll back.

---

### Database schema changes

Minimal — Phase 1 is a guard, not a data model change. Two small additions:

```sql
-- migrations/2026XXXX_inactive_guard.sql

-- 1. Trigger (above)

-- 2. Audit columns on patients table
ALTER TABLE patients
  ADD COLUMN inactive_marked_at TIMESTAMPTZ,
  ADD COLUMN inactive_marked_by INTEGER REFERENCES users(user_id),
  ADD COLUMN inactive_reason TEXT,
  ADD COLUMN inactive_guard_snapshot JSONB;  -- record of guard check results at time of flip

-- 3. Constraint: inactive_marked_at must be set when status_key becomes inactive
-- (enforced via the guard, but verify-able by query)
```

The `inactive_guard_snapshot` column stores the JSON output of `checkInactiveTransition()` so we can audit later: "when this patient was marked inactive, what did the guard see in Healthie?"

---

### Per-path code changes

| File | Change |
|---|---|
| `lib/inactive-guard.ts` | NEW — implements `checkInactiveTransition()` |
| `lib/notifications/inactive-notification.ts` | NEW — implements `notifyInactiveTransition()` |
| `lib/healthie.ts` | EXTEND — add `getActiveRecurringPayments(userId: string)` helper if not already present |
| `app/api/patients/[id]/status/route.ts` | MODIFY — wrap the status UPDATE in the guard call; on block, return 409 Conflict with `blockDetails` JSON |
| `app/api/patients/[id]/route.ts` | MODIFY — same as above when `body.status_key === 'inactive'` |
| `app/api/patients/route.ts` | MODIFY — same on POST with inactive |
| `migrations/2026XXXX_inactive_guard.sql` | NEW — trigger + audit columns |
| `public/ipad/app.js` and `public/mobile/app.js` (CEO dashboard) | MODIFY — when API returns 409 with blockReason, show a modal: "Cannot mark inactive — <suggestedAction>". Include deep-link button to Healthie billing page |
| `app/patients/[id]/page.tsx` (Patient 360) | MODIFY — same UX as iPad |
| `docs/sot-modules/27-patient-flow-map.md` | UPDATE — Stage 8 KNOWN GAP block marked resolved with date |
| `docs/sot-modules/25-patient-classification-and-dashboard.md` | UPDATE — Core Principles section noting the guard exists |

---

### UX detail (what staff sees)

**Today** (broken):
- Staff clicks "Mark Inactive" → toggles → status changes silently → patient continues to be charged.

**After Phase 1**:
- Staff clicks "Mark Inactive".
- If patient has active Healthie recurring: red modal appears:
  > **Can't mark inactive — patient still has active billing**
  > 
  > *Healthie recurring: "Men's Health Monthly Membership" ($179/mo)*
  > 
  > Cancel this in Healthie before marking inactive.
  >
  > [Open in Healthie] [Cancel]
- The "Open in Healthie" button opens the deep-link in a new tab.
- After cancellation, staff returns to the dashboard, clicks "Mark Inactive" again. This time the guard re-queries, sees no active recurring, allows the flip.
- Toast: "Patient marked inactive. Notification sent to admin@."

The friction is intentional — the whole point is to make the two facts (status + billing) impossible to disagree.

---

### Won't-touch guarantees

- **NO existing patient `status_key` values change.** The migration is purely additive.
- **NO bulk operations to "fix" current state.** If there are patients today who are `inactive` but still have active Healthie recurring, Phase 1 does not touch them — Phase 9's reconciliation email surfaces them for staff to handle one-by-one.
- **NO auto-cancellation in Healthie.** The guard never modifies Healthie; it only reads.
- **NO changes to other status transitions.** Active ↔ active_pending ↔ hold_* still work exactly as today.
- **NO QBO or Jane API calls.** Legacy billing is checked via `patients.billing_source` enum (set in Phase 3); legacy systems remain out-of-band.

---

### Acceptance criteria

1. **Block test (positive case)**: pick a known active-recurring patient (e.g., one identified by Phase 9's recon report). API call to PATCH `status_key='inactive'` returns HTTP 409 with `blockReason: 'active_healthie_recurring'`. Patient row unchanged.
2. **Allow test (positive case)**: pick a patient with no active recurring (e.g., already canceled). API call returns 200, patient row updated, `inactive_marked_at` set, `agent_action_log` entry created.
3. **Notification fires**: after the allow case, admin@ receives an email and Telegram bot logs the message within 30 seconds.
4. **Trigger backstop**: directly run `UPDATE patients SET status_key='inactive' WHERE patient_id=<X>;` in psql. Statement fails with the trigger's error message.
5. **Cron forbidden**: any code running under cron context that attempts inactive flip fails fast with a clear error.
6. **Healthie outage simulation**: temporarily break Healthie auth in a staging env. Status flip is blocked with `guard_query_failed` and Telegram alert fires. After auth restored, flip succeeds. (Demonstrates fail-closed behavior.)
7. **Existing data integrity**: pre-deploy `SELECT COUNT(*)` of patients where `status_key='inactive'` matches post-deploy count. No patient was changed.
8. **Audit completeness**: every new inactive flip has populated `inactive_marked_at`, `inactive_marked_by`, `inactive_guard_snapshot`. None NULL.
9. **UI matches API behavior**: dashboard, iPad, and Patient 360 all show the modal correctly when API returns 409. None silently swallows the error.

---

### Risk + rollback

**Risks:**
- A bug in the guard could falsely block legitimate inactive flips, blocking staff workflow. Highest blast radius if Healthie's `recurringPayments` query has unexpected edge cases (e.g., paused-not-canceled returning as active).
- Trigger could block a future legitimate migration if not aware of the session-flag pattern.
- Notification spam if many flips happen in a short window.

**Mitigations:**
- Deploy guard in **dry-run mode** first: it runs the check, logs the result, but always returns `allowed: true`. Run for 7 days, observe logs to validate the check correctness against real flips. Then flip to enforcement mode.
- Document the session-flag pattern in `docs/sot-modules/13-development-guidelines.md` and link from the migration file.
- Notification has rate-limit (max 5 per hour per recipient) to prevent storms.

**Rollback plan:**
- Sub-phases are individual PRs. Revert per-PR if regression observed.
- Trigger can be dropped with `DROP TRIGGER patients_inactive_guard ON patients;` — non-destructive.
- Audit columns are additive — leaving them in place during a rollback is harmless (just NULL for new flips).

---

### Sub-phases within Phase 1

| Sub-phase | Scope | Days |
|---|---|---|
| 1.0 | `lib/healthie.ts` add `getActiveRecurringPayments()` helper if missing; unit tests | 0.5 |
| 1.1 | `lib/inactive-guard.ts` implementation + unit tests | 1 |
| 1.2 | `lib/notifications/inactive-notification.ts` implementation; integrate with existing email + Telegram infra | 0.5 |
| 1.3 | Migration: add audit columns + trigger | 0.5 |
| 1.4 | Wire guard into `app/api/patients/[id]/status/route.ts`, `app/api/patients/[id]/route.ts`, `app/api/patients/route.ts` | 1 |
| 1.5 | Deploy in DRY-RUN mode; monitor logs for 7 days | 7 days passive |
| 1.6 | Flip to ENFORCE mode | 0.5 |
| 1.7 | UI changes: 409 handling in dashboard, iPad, Patient 360 modals + deep-links | 1.5 |
| 1.8 | Documentation updates in sot-modules/25 + sot-modules/27 | 0.5 |

Active engineering: ~5.5 days. Plus 7 days passive observation. Total wall-clock: ~12-14 days, the bulk of which is dry-run observation.

---

### Open questions for Phil before kickoff

1. **Confirm dry-run period length.** 7 days proposed — long enough to catch edge cases, short enough not to delay real protection. Acceptable?
2. **Confirm the deep-link target.** What's the exact Healthie URL pattern for "go cancel this person's recurring"? (e.g., `https://gmh.gethealthie.com/users/<id>/billing`) — need to confirm during build.
3. **Confirm notification recipients.** Currently planned: admin@granitemountainhealth.com email + Phil's Telegram bot. Add anyone else (e.g., Lana, Alyssa)?
4. **Legacy billing window.** 30-day "recently flagged" window proposed for the unverified-legacy-billing block. Should it be longer (60 days) given the QBO/Jane sunset is taking time?

---

---

## Phase 2 — GHL Workflow + Pipeline Reset (Pre-clean) — DETAILED SPEC

**One-line goal:** disable every GHL workflow and pipeline that is NOT on the explicit keep-list, eliminating the abandoned automation graph that fires stale logic against patients (especially around QBO/Jane references that no longer reflect reality).

### Why this phase exists

From the GHL inventory pulled 2026-04-24 (`/tmp/ghl-workflow-inventory.json`):

- **82 total workflows** across 4 sub-accounts (Men's Health 69, ABXTac 11, Primary Care 1, Longevity 1 [shared with Primary Care])
- **5 total pipelines** across 4 sub-accounts (Men's Health 1, Primary Care/Longevity 3 shared, ABXTac 1)
- Multiple PUBLISHED workflows still reference QBO and Jane systems that are sunsetting
- Multiple workflows do branching/protocol logic in visual nodes (against the new "one workflow per channel" architecture)
- Phil confirmed: "we no longer keep track of anything in GHL" — so the entire graph is dead weight EXCEPT the keep-list

Leaving these enabled means:
1. **Stale automations could fire** on contact events, sending wrong messages or creating wrong tasks.
2. **Invisible side effects** can corrupt clinical workflows (e.g., a workflow that auto-tags "QuickBooks Customer Created" runs against a patient who is now Healthie-only).
3. **Future clarity is lost** — when Phase 6 builds the new minimal per-channel workflows, they'll be drowned in 80+ legacy entries unless we clean first.

This phase is the cleanup that has to happen before any new automation work.

### Why this phase is BEFORE Phase 6 (rebuild)

Cleanup must come before rebuild because:
- Disabling first surfaces what was actually being relied on (anything that breaks during the 7-day monitor period reveals an unknown dependency).
- Rebuilding while old workflows are still firing creates double-firing scenarios (both old and new workflows trigger on the same event → duplicate messages).
- The `lib/ghl.ts` helper rewrites in Phase 6 assume the field is clear.

---

### The keep-list (locked 2026-04-24)

**Workflows kept (6 total):**

| Sub-account | ID | Name | Why kept | Last updated |
|---|---|---|---|---|
| Men's Health | `e62cdba4` | Dashboard - Capture inbound messages | iPad inbound SMS pipeline | 2026-04-10 |
| Primary Care / Longevity | `29de8628` | Dashboard: Capture Inbound SMS | iPad inbound SMS (shared loc) | 2026-04-10 |
| ABXTac | `4fdd5715` | Dashboard: Capture Inbound SMS | iPad inbound SMS | 2026-04-10 |
| ABXTac | `0d4ca6d7` | Telehealth Consult Automation | Active ABXTac build | 2026-04-20 |
| ABXTac | `f9283be9` | ABXTac - Post Purchase Welcome | Active ABXTac build | 2026-04-02 |
| ABXTac | `c6b70096` | ABXTac - Order Shipped | Active ABXTac build | 2026-04-02 |

**Pipelines kept: ZERO. All 5 pipelines disabled** (Phil's directive 2026-04-24).

| Sub-account | Pipeline ID | Pipeline Name | Stages |
|---|---|---|---|
| Men's Health | `O6pgijzf` | NOW Mens Health - Patient Pipeline | New Lead → Contacted → Qualified → Initial Labs → Onboarding → Won → Active Patient |
| Primary Care / Longevity | `BC3jk4ur` | NOW Longevity - NEW Leads | New Lead → Engaged → Consultation Requested → No Response → Follow Up → Sent to Healthie → Service Completed → Won/NI |
| Primary Care / Longevity | `L4cMNkjU` | NOW Longevity - Premium Members | Interested → Consultation → Sent to Healthie → Enrolled → Won |
| Primary Care / Longevity | `rEmCtoMf` | NOW Longevity - VIP & Founders Circle | Interested → Consultation → Sent to Healthie → Enrolled → Won |
| ABXTac | `QpPhvVuu` | ABXTAC Order Pipeline | New Visitor → Cart Started → Order Placed → Order Shipped → Order Delivered → ReOrder Window → Repeat Customer |

ALL pipelines are DISABLED. None are kept.

---

### Architectural design

#### Disable strategy: API-first, UI-fallback

**Step 1: API attempt.** The GHL workflow API exposes status updates IF the user-token has the right scopes. Try a script-driven bulk disable first.

**Step 2: UI fallback.** If the API rejects the status change (likely — workflow modifications historically require GHL UI access), generate a Phil-runnable checklist of every workflow + pipeline to disable, with direct GHL UI deep-links for each.

The script `scripts/ghl-cleanup/bulk-disable.mjs` handles both:
1. Pulls the latest workflow + pipeline inventory.
2. Attempts API disable for each non-keep-list item.
3. For any 4xx/5xx, emits a markdown checklist row with the GHL UI URL.
4. Writes a final report: `X disabled via API, Y require manual UI action`.

#### Pre-flight verification

Before any disable, run a pre-flight script that:
1. Re-pulls the inventory (in case anything changed since 2026-04-24).
2. Cross-checks the 6 keep-list IDs against the live data — surfaces any changes (renamed, moved, archived).
3. Identifies any workflow that the dashboard's existing code calls by ID (grep for the IDs in `app/api/`, `lib/`, `scripts/`).
4. Aborts if any keep-list workflow is no longer published or any code path depends on a workflow not on the keep-list.

If pre-flight surfaces unknown dependencies, Phil reviews and decides to (a) add them to the keep-list, (b) refactor the dependency, or (c) accept the breakage with documented mitigation.

---

### File and code changes

| File | Change |
|---|---|
| `.tmp/ghl-workflow-inventory.mjs` | EXISTS — re-run to get fresh state |
| `.tmp/ghl-pipeline-inventory.mjs` | EXISTS — re-run to get fresh state |
| `scripts/ghl-cleanup/preflight-check.mjs` | NEW — verifies keep-list integrity + scans for code dependencies |
| `scripts/ghl-cleanup/bulk-disable.mjs` | NEW — attempts API disable; falls back to UI checklist |
| `scripts/ghl-cleanup/post-disable-monitor.mjs` | NEW — re-runs inventory, confirms only keep-list is published, emits diff report |
| `scripts/ghl-cleanup/restore-workflow.mjs` | NEW — emergency restore for a single workflow ID (rollback safety net) |
| `docs/sot-modules/23-ghl-ai-agents.md` | UPDATE — document new state: 6 workflows kept, 0 pipelines kept, with IDs and purpose |
| `docs/sot-modules/27-patient-flow-map.md` | UPDATE — Stage 1 KNOWN GAP block updated to reference the new state |
| `~/.claude/projects/-home-ec2-user/memory/project_ghl_reset_plan.md` | UPDATE — mark "Disabled" with date + count |

No code in `app/` or `lib/` is touched in Phase 2 directly. The disable affects only GHL configuration. Code integration changes belong to Phase 6 (rebuild).

---

### Won't-touch guarantees

- **NO workflows are deleted.** Disabled-only. Disabled workflows remain in GHL UI as a graveyard.
- **NO pipelines are deleted.** Disabled-only. The 5 pipelines stay visible in GHL UI for reference.
- **NO contacts, tags, opportunities, or conversations modified.** Phase 2 is purely about workflow/pipeline status.
- **NO changes to the iPad inbound SMS path.** The 3 keep-list iPad SMS workflows (one per location) remain published; smoke test confirms post-disable.
- **NO changes to ABXTac active development workflows.** The 3 ABXTac workflows beyond iPad SMS remain published.
- **NO changes to GHL contact custom fields, tags, or pipeline-stage-attached data.** Disabling a pipeline does not delete contacts that were in stages — stages just become irrelevant.

---

### Acceptance criteria

1. **Pre-flight passes**: keep-list workflows confirmed published, no code dependencies on non-keep-list workflows surfaced.
2. **Workflow disable executes**: `bulk-disable.mjs` runs to completion. Output report shows `disabled_via_api + requires_manual_ui = 76` (82 total - 6 keep-list).
3. **Pipeline disable executes**: same script handles pipelines; all 5 disabled.
4. **Inventory re-pull confirms**: post-disable run of `ghl-workflow-inventory.mjs` shows ONLY 6 workflows with `status: published`. Pipeline inventory shows all 5 with disabled state (or removed from active list, depending on GHL's representation).
5. **iPad SMS smoke test**: send a test SMS from a Phil-controlled phone to each sub-account's GHL number. Each arrives in the dashboard's GHL message capture (visible at `/admin/ghl-messages`) within 60 seconds. Repeat per sub-account (MH, PC/Longevity, ABXTac).
6. **ABXTac active workflows smoke test**: trigger each of the 3 kept ABXTac workflows via their normal trigger event (in a Phil-approved test contact context — using `philschafer7@gmail.com` per the never-charge-patients pin). Confirm execution.
7. **No SMS/email regressions**: monitor `agent_action_log` and Telegram alerts for 7 days post-disable. Zero "expected automation didn't fire" reports.
8. **Documentation updated**: sot-modules/23 reflects new state; INDEX.md still points to it; memory file updated with completion date.

---

### Risk + rollback

**Risks:**
- An unknown workflow dependency could break (e.g., a niche staff workflow Phil forgot about).
- GHL API disable might leave the workflow in an inconsistent UI state (showing as "Inactive" in API but UI says "Published") — would require manual cleanup.
- A pipeline disable might affect contact searches or filters that staff still use.

**Mitigations:**
- 7-day monitor period after disable. If a real dependency surfaces, use `restore-workflow.mjs <id>` to re-enable that specific workflow within minutes.
- Pre-flight scan checks dashboard code for hardcoded workflow IDs to catch the obvious dependencies.
- Disable in waves: first the obvious-dead workflows (drafts older than 12 months, ones referencing QBO/Jane), monitor 3 days, then disable the remaining published-but-stale workflows.

**Rollback plan:**
- Single workflow restore: `node scripts/ghl-cleanup/restore-workflow.mjs <workflow_id>` re-publishes it.
- Bulk restore: `node scripts/ghl-cleanup/restore-all.mjs` re-publishes everything that was disabled in Phase 2 (uses the report from `bulk-disable.mjs` as input). Effectively undoes Phase 2.
- Pipelines are restorable the same way.
- No data loss possible because nothing was deleted.

---

### Sub-phases within Phase 2

| Sub-phase | Scope | Days |
|---|---|---|
| 2.0 | Re-pull inventories; verify keep-list still accurate | 0.25 |
| 2.1 | Build `preflight-check.mjs` and run it; review surface findings with Phil | 0.5 |
| 2.2 | Build `bulk-disable.mjs` and `restore-workflow.mjs`; test against a single low-risk draft workflow first | 1 |
| 2.3 | Wave 1 disable: all draft workflows older than 12 months + all QBO/Jane-referencing workflows; monitor 3 days | 0.5 + 3 days passive |
| 2.4 | Wave 2 disable: remaining non-keep-list published workflows + all pipelines; monitor 7 days | 0.5 + 7 days passive |
| 2.5 | Smoke tests + acceptance criteria sign-off | 0.5 |
| 2.6 | Documentation updates (sot-modules/23, 27, memory) | 0.5 |

Active engineering: ~3.75 days. Plus 10 days passive observation. Total wall-clock: ~14 days.

---

### Open questions for Phil before kickoff

1. **Wave 1 vs single-shot?** Is a 2-wave disable (low-risk first, then everything else) preferred, or rip the band-aid in one pass? Single-shot is faster; 2-wave is safer.
2. **Smoke-test contacts?** Need a Phil-approved test contact in each sub-account that we can use to trigger the ABXTac workflows for verification. Confirm `philschafer7@gmail.com` is the right one for all 4.
3. **Notification when disable completes?** Telegram alert + email summary report — desired?
4. **GHL UI access.** The bulk-disable script may require manual UI clicks for any item the API rejects. Is a 1–2 hour Phil session acceptable, or should we get a GHL admin user provisioned for the cleanup?

---

**Workflow keep-list (locked 2026-04-24):**

| Sub-account | ID | Name | Why kept |
|---|---|---|---|
| Men's Health | `e62cdba4` | Dashboard - Capture inbound messages | iPad inbound SMS |
| Primary Care / Longevity | `29de8628` | Dashboard: Capture Inbound SMS | iPad inbound SMS (shared loc) |
| ABXTac | `4fdd5715` | Dashboard: Capture Inbound SMS | iPad inbound SMS |
| ABXTac | `0d4ca6d7` | Telehealth Consult Automation | Active ABXTac build |
| ABXTac | `f9283be9` | ABXTac - Post Purchase Welcome | Active ABXTac build |
| ABXTac | `c6b70096` | ABXTac - Order Shipped | Active ABXTac build |

**6 workflows kept. ~75 workflows to disable** (Men's Health 68, ABXTac 7, others 0).

**Pipeline keep-list (locked 2026-04-24):** none. All 5 pipelines disabled.

| Sub-account | ID | Pipeline | Action |
|---|---|---|---|
| Men's Health | `O6pgijzf` | NOW Mens Health - Patient Pipeline | DISABLE |
| Primary Care / Longevity | `BC3jk4ur` | NOW Longevity - NEW Leads | DISABLE |
| Primary Care / Longevity | `L4cMNkjU` | NOW Longevity - Premium Members | DISABLE |
| Primary Care / Longevity | `rEmCtoMf` | NOW Longevity - VIP & Founders Circle | DISABLE |
| ABXTac | `QpPhvVuu` | ABXTAC Order Pipeline | DISABLE |

**Scope:**
- Disable all non-keep-list workflows (set `published: false` or equivalent).
- Disable all 5 pipelines.
- Do NOT delete anything. Disabled workflows + pipelines remain as a graveyard for reference.
- Monitor for 7 days post-disable for any "expected SMS didn't arrive" reports.

**Won't touch:**
- Will NOT delete workflows or pipelines.
- Will NOT modify the 6 keep-list workflows.
- Will NOT touch GHL contacts, tags, opportunities, or conversations.

**Pre-flight check needed:** GHL's REST API may not expose workflow/pipeline disable. If API supports it, we automate the disable; if not, this becomes a manual UI checklist Phil runs (likely the case — workflow status changes typically require the GHL UI).

**Acceptance:**
- Re-run inventory script: only the 6 keep-list workflows show as published; 0 pipelines remain enabled.
- iPad inbound SMS still works end-to-end across MH, PC, ABXTac (smoke test from a patient phone).
- All 3 ABXTac development workflows still trigger correctly on their respective events.
- No "expected automation didn't fire" complaints in week following.

---

## Phase 3 — Auto-Classification (Stages 5/6) — DETAILED SPEC

**One-line goal:** patient classification (`member` / `intermittent` / `visit`) and `billing_source` are derived mechanically from Healthie recurring state every day, never set manually. Eliminates the staff step where someone has to remember "this patient is now a member, mark them in the dashboard."

### Why this phase exists

From sot-modules/25 (Classification Policy) and Phil's 2026-04-24 architectural decision:

> "The source of truth for members is 'are they on Healthie recurring, or not'."

Today, classification is partially manual:
- `patients.patient_type` is set at creation and rarely updated.
- `patients.client_type` carries strings like `QBO TCMH $180/Month` that mix billing system + amount + brand into a single field.
- No automated process syncs classification with Healthie reality, so the dashboard's view of "who is a member" drifts from Healthie's view of "who is paying."

This drift compounds during the QBO/Jane sunset because:
1. As patients migrate from QBO → Healthie, their classification doesn't auto-update.
2. The migration tracker (Phase 5) needs reliable classification data to filter "still on legacy."
3. The billing recon (Phase 9) can't compute drift if it doesn't trust the dashboard's own classification.

Phase 3 makes classification a **derived field**, computed from Healthie state, refreshed daily. After Phase 3, asking "who is a member?" has one mechanical answer.

---

### Architectural design

#### The classification rule (locked, from sot-modules/25)

```
IF patient has ≥1 active Healthie recurringPayments
  → classification = 'member'
  → billing_source = 'healthie_recurring'

ELSE IF patient has explicit pro-bono tag (Healthie or dashboard flag)
  → classification = 'member'
  → billing_source = 'pro_bono'

ELSE IF patient has legacy billing record (QBO active customer | Jane active subscription | PrimeCare | InsSupp)
  → classification = 'member'
  → billing_source = 'qbo_legacy' | 'jane_legacy' | 'primecare_legacy' | 'ins_supp_legacy'

ELSE IF patient has had ≥1 paid Healthie service in last 90 days but no active recurring
  → classification = 'intermittent'
  → billing_source = 'direct_stripe_retail' (if Stripe charge) | 'none'

ELSE
  → classification = 'visit'
  → billing_source = 'none'
```

Pro-bono detection uses an explicit signal — tag in Healthie OR a `patients.is_pro_bono` boolean. Never inferred from absence.

#### The reconciliation cron: `app/api/cron/auto-classification/route.ts`

A new cron route, scheduled daily at 4am MST (before morning-prep at 6am). Steps:

1. Pull all patients with `status_key IN ('active', 'active_pending', 'hold_payment_research', 'hold_patient_research')`. Skip `inactive`/`revoked`/`suspended`.
2. For each patient, **sequentially** (to respect rate limits):
   a. Query Healthie `recurringPayments(user_id)` — filter active states.
   b. Query Healthie tags (for pro-bono check).
   c. Look up legacy billing records in our local data (set during one-time migration audit + Phase 5).
   d. Compute `(classification, billing_source)` per the rule above.
   e. If different from current values: update + log to `agent_action_log` with old/new + reason.
3. Emit a summary at end: `X patients reviewed, Y changed, Z errors`.
4. If errors > threshold (e.g., 10), Telegram alert.

#### One-time backfill: `scripts/auto-classify-backfill.ts`

Runs once before the cron is enabled. Same logic, but operates as a dry-run first (writes proposed changes to a CSV for Phil to review), then applies after sign-off.

```ts
// scripts/auto-classify-backfill.ts (new)

const mode: 'dry-run' | 'apply' = process.argv[2];

const all = await query(`
  SELECT patient_id, healthie_id, status_key, patient_type, classification, billing_source
  FROM patients
  WHERE status_key IN ('active','active_pending','hold_payment_research','hold_patient_research')
`);

const proposed: Array<{patient_id, current, proposed, reason}> = [];

for (const p of all) {
  const computed = await classifyPatient(p);
  if (computed.classification !== p.classification || computed.billing_source !== p.billing_source) {
    proposed.push({ patient_id: p.patient_id, current: p, proposed: computed, reason: computed.reason });
  }
}

if (mode === 'dry-run') {
  writeCSV('/tmp/auto-classify-dryrun.csv', proposed);
  console.log(`Would update ${proposed.length} of ${all.length} patients.`);
} else if (mode === 'apply') {
  for (const p of proposed) {
    await applyClassification(p);
  }
  console.log(`Updated ${proposed.length} patients.`);
}
```

The dry-run CSV has columns: `patient_id, name, current_classification, current_billing_source, proposed_classification, proposed_billing_source, reason, healthie_id`. Phil reviews; corrections fed back into the rule before apply mode.

---

### Database schema changes

```sql
-- migrations/2026XXXX_classification_columns.sql

-- 1. New billing_source enum
CREATE TYPE billing_source_enum AS ENUM (
  'healthie_recurring',
  'qbo_legacy',
  'jane_legacy',
  'primecare_legacy',
  'ins_supp_legacy',
  'pro_bono',
  'direct_stripe_retail',
  'none',
  'unknown'  -- safety default for anyone not yet classified
);

-- 2. Computed classification + billing source columns
ALTER TABLE patients
  ADD COLUMN classification TEXT CHECK (classification IN ('member', 'intermittent', 'visit', 'unknown')),
  ADD COLUMN billing_source billing_source_enum DEFAULT 'unknown',
  ADD COLUMN classification_computed_at TIMESTAMPTZ,
  ADD COLUMN classification_source_evidence JSONB,  -- snapshot of the inputs used (Healthie recurring IDs, tags, etc.)
  ADD COLUMN is_pro_bono BOOLEAN DEFAULT FALSE;     -- explicit flag

-- 3. Indexes for common queries
CREATE INDEX idx_patients_classification ON patients(classification);
CREATE INDEX idx_patients_billing_source ON patients(billing_source);
CREATE INDEX idx_patients_is_pro_bono ON patients(is_pro_bono) WHERE is_pro_bono = true;

-- 4. Legacy billing tracking (for migration tracker in Phase 5)
CREATE TABLE legacy_billing_records (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(patient_id),
  legacy_system TEXT NOT NULL CHECK (legacy_system IN ('qbo', 'jane', 'primecare', 'ins_supp')),
  legacy_external_id TEXT,            -- QBO customer ID, Jane subscription ID, etc.
  monthly_amount_cents INTEGER,
  product_label TEXT,                 -- e.g. "QBO TCMH $180/Month"
  active BOOLEAN DEFAULT TRUE,
  last_charge_at DATE,
  observed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_legacy_billing_active ON legacy_billing_records(active, legacy_system);

-- 5. Keep legacy fields for backwards-compat; new logic doesn't write to them
-- (patient_type, client_type remain readable but aren't authoritative anymore)
```

The legacy `patient_type` and `client_type` columns stay in the schema — too many reports/scripts read them. Phase 3 adds the new computed fields alongside; Phase 11 (future cleanup) could drop them later.

---

### `lib/classify.ts` — the rule implementation

```ts
// lib/classify.ts (new)

export interface ClassificationInputs {
  patientId: number;
  healthieId: string;
  statusKey: PatientStatusKey;
}

export interface ClassificationResult {
  classification: 'member' | 'intermittent' | 'visit';
  billingSource: BillingSource;
  reason: string;
  evidence: {
    activeHealthieRecurring: Array<{id: string; productName: string; amount: number}>;
    healthieTags: string[];
    legacyBillingRecords: LegacyBillingRecord[];
    recentStripeCharges: number;     // count in last 90d
    isProBonoFlag: boolean;
  };
}

export async function classifyPatient(input: ClassificationInputs): Promise<ClassificationResult>;
```

Internal flow:
1. Healthie `recurringPayments(user_id: <healthieId>)` filtered to `status IN ('active', 'on_trial')` per Healthie's lifecycle. Use the helper from `feedback_healthie_recurring_query` pin.
2. Healthie tags via `users(id:).tags`.
3. Legacy billing: SELECT from `legacy_billing_records` WHERE `patient_id` matches AND `active = true`.
4. Recent Stripe activity: COUNT from `payment_transactions` WHERE `patient_id` matches AND `created_at >= NOW() - INTERVAL '90 days'` AND `status = 'succeeded'`.
5. Apply the rule, return the result with full evidence snapshot.

The `evidence` object is stored in `patients.classification_source_evidence` (JSONB) so future debugging can ask "why did the cron classify them as X?" without re-querying everything.

---

### Pro-bono handling (locked decision from 2026-04-24)

Pro-bono is **not** inferred. Two explicit signals:

1. **Healthie tag** named `pro_bono` (or whatever the existing convention is — verify during build).
2. **Dashboard flag** `patients.is_pro_bono = true` (set by staff via Patient 360 UI or a dashboard action).

Either signal makes the patient `classification='member', billing_source='pro_bono'`.

The Patient 360 UI gets a new toggle: "Pro-bono patient (no charge)" with a confirmation modal. Toggling it logs to `agent_action_log` (who, when, why field optional).

The auto-classification cron treats both signals equally — if either is set, classify pro-bono.

---

### Per-path code changes

| File | Change |
|---|---|
| `migrations/2026XXXX_classification_columns.sql` | NEW — schema additions |
| `lib/classify.ts` | NEW — `classifyPatient()` implementation |
| `app/api/cron/auto-classification/route.ts` | NEW — daily cron handler |
| `scripts/auto-classify-backfill.ts` | NEW — one-time backfill (dry-run + apply modes) |
| `scripts/auto-classify-evidence-replay.ts` | NEW — debug helper to re-classify a single patient and show evidence |
| `app/patients/[id]/page.tsx` (Patient 360) | MODIFY — display computed classification + billing_source as read-only fields with a "Recompute" button (calls cron logic for one patient) |
| `app/patients/[id]/page.tsx` (Patient 360) | MODIFY — add "Pro-bono patient" toggle with confirm modal |
| `app/api/patients/[id]/pro-bono/route.ts` | NEW — toggle endpoint with audit logging |
| `lib/healthie.ts` | EXTEND — confirmed `getActiveRecurringPayments()` exists from Phase 1; add `getPatientTags()` if missing |
| `crontab` | UPDATE — add daily 4am invocation of `/api/cron/auto-classification` |
| `docs/sot-modules/25-patient-classification-and-dashboard.md` | UPDATE — mark this phase as the implementation; reference cron route + lib/classify.ts |
| `docs/sot-modules/27-patient-flow-map.md` | UPDATE — Stage 5 transitions reference the auto-classification |

---

### Won't-touch guarantees

- **NO modification of `status_key`.** Classification is orthogonal to status. (Status is human-set per Phase 1; classification is derived.)
- **NO auto-cancellation of any Healthie recurring or external billing.** Read-only.
- **NO bulk update of existing classifications until the dry-run is reviewed.** Apply mode only runs after Phil signs off on the CSV.
- **NO modification of `patient_type` or `client_type`.** Legacy fields are left alone.
- **NO automatic pro-bono assignment.** Always requires explicit signal.

---

### Acceptance criteria

1. **Dry-run report quality**: backfill dry-run CSV is loaded into a spreadsheet. Phil reviews row-by-row (or sample of N=50). Classifications match Phil's expectations OR he calls out exceptions that the rule should handle differently.
2. **Apply preserves member counts**: pre-apply count of patients where (`patient_type='member'` OR similar legacy heuristic) should be CLOSE TO post-apply count of `classification='member'`. Diff explained by:
   - Patients moved to `intermittent` because no recurring (real change, expected)
   - Patients moved to `visit` because no recurring AND no recent service (real change, expected)
   - Net new `member` because rule caught someone the old heuristic missed (positive surprise)
3. **Cron runs daily**: after 7 days of cron runs, every patient has `classification_computed_at` within last 24 hours.
4. **Evidence snapshot present**: random sample of 10 patients — `classification_source_evidence` JSONB is populated and explains the classification.
5. **Pro-bono toggle works**: setting `is_pro_bono=true` via UI re-classifies the patient as `member, pro_bono` on next cron run (or immediately via "Recompute" button).
6. **No legacy-field corruption**: `patient_type`, `client_type` are untouched (compare pre-apply vs post-apply checksums).
7. **Healthie outage tolerance**: cron run with Healthie offline does NOT update any classification; logs error per patient and continues; no false demotions.
8. **Phase 5 unblocked**: migration tracker can query `WHERE billing_source IN ('qbo_legacy', 'jane_legacy', ...)` and get a real list.
9. **Phase 9 unblocked**: billing recon can compute drift between dashboard `billing_source` and live billing-system queries.

---

### Risk + rollback

**Risks:**
- The classification rule could mis-handle an edge case Phil hasn't called out — e.g., a patient who pre-paid annually and shows as "no active recurring" but is still a member.
- Healthie API failures during cron could leave classifications stale (e.g., a patient who canceled overnight isn't re-classified until next run).
- Pro-bono detection depends on the tag name being consistent across Healthie patients. If the tag is misspelled, those patients get downgraded to non-member.
- Bulk apply could change visible classifications for hundreds of patients in one batch, which staff may interpret as data corruption if not communicated.

**Mitigations:**
- Dry-run + Phil-review gate before apply.
- Cron emits classification-change deltas to admin@ via a daily summary email. If the delta is high, staff know to expect changes.
- A `--patient-id` flag on the cron lets ops re-run for a single patient on demand.
- Tag detection allowlist: a config map of "tag values that mean pro-bono" so misspellings can be added without code changes.

**Rollback plan:**
- Database changes are additive. Reverting code leaves the new columns harmless (nothing reads them).
- A `scripts/auto-classify-rollback.ts` script can clear `classification` and `billing_source` columns to their pre-apply values using the `agent_action_log` history.
- Cron can be disabled in crontab without touching anything else.
- Patient 360 UI changes are removable in a single PR revert.

---

### Sub-phases within Phase 3

| Sub-phase | Scope | Days |
|---|---|---|
| 3.0 | Migration: enum + columns + legacy_billing_records table | 0.5 |
| 3.1 | `lib/classify.ts` + unit tests covering all 5 rule branches | 1.5 |
| 3.2 | `scripts/auto-classify-backfill.ts` dry-run mode; produce CSV; Phil reviews | 1 + Phil review wall-time |
| 3.3 | Iterate on rule based on Phil's CSV feedback; re-dry-run | 0.5 (per iteration; budget 2 iterations) |
| 3.4 | Apply mode runs on full population | 0.25 |
| 3.5 | `app/api/cron/auto-classification/route.ts` daily cron + crontab entry | 0.5 |
| 3.6 | Patient 360 UI: read-only classification display + Recompute button + Pro-bono toggle | 1 |
| 3.7 | Daily-summary email of classification changes | 0.5 |
| 3.8 | Documentation updates | 0.5 |

Active engineering: ~6 days. Plus Phil-review wall-time of 1–3 days. Total: ~10 days.

---

### Open questions for Phil before kickoff

1. **Pro-bono tag value(s).** What's the exact tag string in Healthie today for pro-bono patients? Need to verify before cron runs against real data.
2. **Pre-paid annual edge case.** Are there any patients who pre-paid annually (no active monthly recurring but still members)? If so, how do we identify them? Healthie tag? Custom field?
3. **Daily-summary email.** Wanted? If yes, time of day (recommend 5am MST after 4am cron)? Recipients confirmed as admin@ only?
4. **Backfill scope.** Default plan is "all patients with status_key in active/active_pending/hold_*". Want to include `inactive` patients too (to set their `billing_source = 'none'` for completeness), or skip them?
5. **What's the Healthie tag for "active member" vs other tags?** Need a definitive list to avoid misreading other tags as billing signals.

---

---

## Phase 4 — No Man's Land Queue (Stage 4→5) — DETAILED SPEC

**One-line goal:** zero dropped handoffs between the provider visit (Stage 4 Evaluated) and the patient being on a Healthie recurring package (Stage 5 Onboarded). Surface every patient stuck in the gap, automate the chase, measure how long it takes.

### Why this phase exists

Per Phil's 2026-04-24 confirmation:

> "We do not have a good plan for 'no man's land' the time between provider visit and booking into recurring package."

This is the **single highest-leverage automation target** in the whole flow map (memory pin: `project_no_mans_land_handoff.md`). The gap:

1. Provider sees patient → signs chart note with treatment plan in Healthie.
2. Staff is supposed to: read the plan → choose Healthie package → send billing link → patient pays → recurring activates.
3. Today, NOTHING enforces or measures this handoff. Patients fall through silently. Staff has no queue to work from. Provider has no visibility. No nudges are sent.

The cost is real:
- Each lost-in-handoff patient = lost monthly recurring revenue (TRT $180/mo, etc.)
- Patient frustration → potential churn before they ever start
- Staff anxiety from operating on memory rather than from a queue

This phase makes the gap visible AND closes it via automation.

---

### Architectural design

#### The query that defines "in No Man's Land"

```sql
-- "Pending Onboarding" cohort
SELECT p.*, last_appt.scheduled_at AS last_visit_at, last_appt.provider_id
FROM patients p
JOIN (
  SELECT DISTINCT ON (user_id) user_id, scheduled_at, provider_id
  FROM healthie_appointments_cache
  WHERE status = 'completed' AND chart_note_signed_at IS NOT NULL
  ORDER BY user_id, scheduled_at DESC
) last_appt ON last_appt.user_id = p.healthie_id
WHERE
  p.status_key IN ('active', 'active_pending')
  AND p.classification != 'member'                       -- not yet onboarded
  AND last_appt.scheduled_at >= NOW() - INTERVAL '14 days'
  AND p.no_mans_land_state != 'declined'                 -- explicit decline opt-out
  AND p.no_mans_land_state != 'completed';               -- belt-and-suspenders
```

The query relies on:
- `healthie_appointments_cache` — a local cache of Healthie appointments populated by webhook `appointment-updated` (extended in Phase 4).
- `patients.classification` — populated by Phase 3 auto-classification (so Phase 4 depends on Phase 3 being live).
- `patients.no_mans_land_state` — new column.

#### The "Pending Onboarding" tab UX

A new dashboard tab. URL: `/onboarding/pending`. Columns:

| Column | Type | Source |
|---|---|---|
| Patient | name + photo | `patients` |
| Brand / Care Line | tag | derived from Healthie group |
| Provider seen | name | `healthie_appointments_cache.provider_id` |
| Days since visit | int | NOW() - last_visit_at |
| Suggested Healthie package | string + link | derived from chart note structured fields (Phase 4.5; see "Long-term") |
| Last nudge sent | timestamp | new `no_mans_land_nudges` table |
| Assigned staff | dropdown | new `patients.no_mans_land_assignee` column |
| Status | enum | `pending` / `package_offered` / `awaiting_payment` / `declined` / `completed` |
| Actions | buttons | "Send billing link", "Mark declined", "Reassign" |

Default sort: days-since-visit DESC (oldest stuck first). Filter chips: brand, provider, days bucket (0–3, 4–7, 8–14).

Click into a row → modal with: Healthie chart note preview, prior nudges sent, and action buttons.

#### Nudge cadence (automated)

A new cron `app/api/cron/no-mans-land-nudges/route.ts` runs hourly. For each patient in the cohort, decide whether to send a nudge based on `last_nudge_sent_at`:

| Time since visit | Action |
|---|---|
| T+24h, no nudge yet | Send SMS via Phase 6 receiver: "Hi <name>, glad you saw <provider>. Here's your treatment plan link: <link>" |
| T+72h, no progress | Send SMS + email |
| T+7d, no progress | Send SMS + email + create GHL task assigned to clinic staff |
| T+14d | Send SMS "win-back" + transition to `lapsed_post_eval` state, drop from queue |

Each nudge is logged in `no_mans_land_nudges` table with the channel, message, recipient, and outcome (delivered/failed).

The nudge content is parameterized:
- Patient name
- Provider name
- Brand-specific URL (TRTNow billing link, ABXTac link, etc.)
- Treatment-plan summary (from Healthie chart note structured fields, when available)

#### The "Send billing link" action

When staff clicks "Send billing link" on a row, a modal asks:
1. Which Healthie package? (dropdown of brand-appropriate packages — Phase 4.5 may auto-suggest one)
2. Confirm send.

Then the system:
1. Creates the Healthie package selection request (does NOT activate billing yet — patient must accept and pay).
2. Sends an email + SMS via Phase 6 receivers with the package billing link.
3. Updates `patients.no_mans_land_state = 'package_offered'`.
4. Logs to `no_mans_land_nudges`.
5. The next morning, when the auto-classification cron runs, it will see if the patient paid and transition them to `member`. If yes → drop from queue with `state = 'completed'`.

#### Long-term: structured treatment-plan capture (Phase 4.5)

Out of MVP scope but referenced here: a future enhancement where the provider's chart note includes structured fields ("Recommended package: TRT Monthly", "Alternative: TRT Quarterly") that the dashboard auto-extracts to suggest packages. MVP just shows the chart note text and lets staff choose.

---

### Database schema changes

```sql
-- migrations/2026XXXX_no_mans_land.sql

-- 1. Patient state for the queue
ALTER TABLE patients
  ADD COLUMN no_mans_land_state TEXT
    CHECK (no_mans_land_state IN ('pending', 'package_offered', 'awaiting_payment', 'declined', 'completed', 'lapsed_post_eval'))
    DEFAULT 'pending',
  ADD COLUMN no_mans_land_state_updated_at TIMESTAMPTZ,
  ADD COLUMN no_mans_land_assignee INTEGER REFERENCES users(user_id);

-- 2. Nudge log
CREATE TABLE no_mans_land_nudges (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(patient_id),
  nudge_kind TEXT NOT NULL,         -- 't_plus_24h_sms', 't_plus_72h_sms_email', etc.
  channel TEXT NOT NULL,            -- 'sms' | 'email' | 'task'
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  recipient TEXT,                   -- phone or email
  message_excerpt TEXT,
  outcome TEXT,                     -- 'delivered' | 'failed' | 'staff_action'
  outcome_details JSONB
);
CREATE INDEX idx_nml_nudges_patient ON no_mans_land_nudges(patient_id);
CREATE INDEX idx_nml_nudges_recent ON no_mans_land_nudges(sent_at DESC);

-- 3. Healthie appointment cache (if not already exists from prior work)
CREATE TABLE IF NOT EXISTS healthie_appointments_cache (
  id TEXT PRIMARY KEY,                       -- Healthie appointment ID
  user_id TEXT NOT NULL,                     -- Healthie patient ID
  provider_id TEXT,
  scheduled_at TIMESTAMPTZ,
  status TEXT,
  chart_note_signed_at TIMESTAMPTZ,
  raw JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_hac_user ON healthie_appointments_cache(user_id);
CREATE INDEX idx_hac_recent_signed ON healthie_appointments_cache(chart_note_signed_at DESC) WHERE chart_note_signed_at IS NOT NULL;
```

The `healthie_appointments_cache` is populated by the existing `app/api/webhooks/healthie/appointment-updated/route.ts` handler — Phase 4 extends that handler to also write `chart_note_signed_at` (currently it might not).

---

### Per-path code changes

| File | Change |
|---|---|
| `migrations/2026XXXX_no_mans_land.sql` | NEW — schema |
| `lib/no-mans-land.ts` | NEW — cohort query + state transitions |
| `app/api/onboarding/pending/route.ts` | NEW — GET endpoint serving the cohort to the UI |
| `app/api/onboarding/[patientId]/send-billing-link/route.ts` | NEW — POST: triggers Healthie package selection request + nudges |
| `app/api/onboarding/[patientId]/decline/route.ts` | NEW — POST: state = 'declined', re-classify as `visit` |
| `app/api/onboarding/[patientId]/assignee/route.ts` | NEW — PATCH: reassign |
| `app/api/cron/no-mans-land-nudges/route.ts` | NEW — hourly nudge dispatcher |
| `app/onboarding/pending/page.tsx` | NEW — dashboard tab UI |
| `components/onboarding/PendingOnboardingTable.tsx` | NEW — React table component |
| `components/onboarding/SendBillingLinkModal.tsx` | NEW — modal w/ package picker |
| `app/api/webhooks/healthie/appointment-updated/route.ts` | MODIFY — when chart note signed, populate `chart_note_signed_at` in cache + initialize `no_mans_land_state = 'pending'` |
| `lib/healthie.ts` | EXTEND — add helper to send Healthie package selection request to a patient |
| `crontab` | UPDATE — add hourly invocation of `/api/cron/no-mans-land-nudges` |
| `public/ipad/app.js` (CEO widget) | MODIFY — add "X patients in onboarding gap, $Y/mo at risk" widget |
| `docs/sot-modules/27-patient-flow-map.md` | UPDATE — Stage 4 KNOWN GAP marked as resolved |

---

### Won't-touch guarantees

- **NO automatic Healthie package selection.** Staff (or future Phase 4.5) chooses the package; the system never auto-assigns billing.
- **NO modification of provider chart notes.** Read-only.
- **NO automatic decline.** A patient stays in the queue until either (a) staff explicitly marks declined, (b) they pay (auto-detected via classification cron), or (c) T+14 days lapsed (auto-transition to `lapsed_post_eval`).
- **NO double-nudging.** Idempotent: each nudge_kind fires at most once per patient unless explicitly re-triggered.
- **NO forced-assignment of staff.** Assignment is optional; queue defaults to "Unassigned" pool.

---

### Acceptance criteria

1. **Cohort query correctness**: pick 5 patients known to be in the gap from manual inspection. They appear in the Pending Onboarding tab. Pick 5 known-onboarded patients. They do NOT appear.
2. **State transitions correct**:
   - Patient appears in queue T+0 with state=`pending`.
   - After staff sends billing link, state=`package_offered`.
   - After patient pays (next classification cron run), state=`completed`, drops from queue.
   - Staff manually marking declined transitions to `declined`, drops from queue, classification → `visit`.
3. **Nudges send on schedule**: a test patient added to queue Day 0. SMS arrives within 1 hour after T+24h. Etc. for T+72h, T+7d.
4. **Idempotency**: cron run twice in same hour → second run does NOT double-send any nudge.
5. **Metric captured**: a daily-rollup query computes "average days from chart-signed to recurring-active" for patients who completed in last 30 days. After 4 weeks of running, this metric trends DOWN from the pre-Phase-4 baseline.
6. **CEO widget shows live data**: iPad shows current count + revenue at risk.
7. **Assignment persistence**: staff assigns a patient to themselves; refresh; assignment persists.
8. **Decline doesn't auto-undo**: a declined patient does NOT re-enter the queue if they're seen again later (they re-enter with a NEW visit, but the prior decline is logged).

---

### Risk + rollback

**Risks:**
- Cron sending nudges to patients who shouldn't be nudged (e.g., patient is already on a package via a different code path that doesn't update classification fast enough).
- Privacy/compliance: SMS content must not contain PHI beyond patient first name + provider name + generic "treatment plan" wording.
- Staff using "Mark declined" too aggressively, hiding patients from view who could still be saved.

**Mitigations:**
- Pre-nudge re-check: in the cron, before sending each nudge, RE-RUN the cohort query for that patient to confirm they're still in the gap. If not (e.g., classification updated to member overnight), skip the nudge.
- SMS template review: Phil approves each message template before deploy. Templates stored in a config file `config/no-mans-land-messages.json` for easy edits.
- Decline logging: a "Mark declined" requires a reason dropdown + free-text. Audit visible per-patient.

**Rollback plan:**
- Disable cron in crontab.
- Hide the dashboard tab via feature flag `NO_MANS_LAND_ENABLED=false`.
- Revert webhook extension if it causes regression in appointment-updated handling.
- Schema additions are non-destructive — leaving them in place during rollback is safe.

---

### Sub-phases within Phase 4

| Sub-phase | Scope | Days |
|---|---|---|
| 4.0 | Migration: schema + appointment cache extension | 0.5 |
| 4.1 | `lib/no-mans-land.ts` cohort query + state machine; unit tests | 1 |
| 4.2 | `appointment-updated` webhook extension to populate cache | 0.5 |
| 4.3 | API endpoints (cohort GET, send-billing-link, decline, assignee) | 1.5 |
| 4.4 | Dashboard UI: Pending Onboarding tab | 2 |
| 4.5 | Hourly nudge cron + SMS templates | 1 |
| 4.6 | CEO widget integration + metric query | 0.5 |
| 4.7 | Smoke tests, acceptance criteria | 0.5 |
| 4.8 | Documentation updates | 0.5 |

Active engineering: ~7.5 days. Wall-clock: ~10 days assuming no cross-cutting issues.

---

### Open questions for Phil before kickoff

1. **Nudge SMS templates.** I'll draft 4 (T+24h, T+72h, T+7d, T+14d) — review and edit before deploy?
2. **Brand-specific billing link patterns.** What's the URL pattern for sending a Healthie package billing link per brand? (Each brand has its own Healthie group; URL might differ.)
3. **Default unassigned pool.** Who should the system default to when no assignee picked? Maybe the on-call clinic staff per brand?
4. **Decline reason dropdown values.** Suggested: `cost_concern | not_ready | found_alternative | unreachable | other`. Anything to add/remove?
5. **CEO widget threshold for "$ at risk."** Default = sum of typical-monthly-recurring across brands × cohort count. Confirm or override.

---

---

## Phase 5 — Migration Tracker (Stage 6) — DETAILED SPEC

**One-line goal:** make the QBO + Jane → Healthie recurring migration a visible, measurable, accelerated workstream — not a passive observation. Per Phil's hardening-plan decision: "treat as a forcing function, not passive reporting."

### Why this phase exists

QBO and Jane are both fully sunsetting per Phil's 2026-04-24 decision (`project_quickbooks_sunset.md`). Today:

- ~48 patients on QBO recurring (per legacy product names like `QBO TCMH $180/Month`)
- An unknown number on Jane (need to confirm during Phase 5.0)
- Some on PrimeCare or InsSupp legacy
- Each one represents revenue that's currently flowing through legacy infrastructure that Phil wants gone ASAP

Without Phase 5:
- Migration happens ad-hoc, when staff remembers
- No visibility into who's left
- No SLA / urgency
- Phase 9's billing recon flags the drift weekly but doesn't drive action
- The longer the QBO/Jane systems stay live, the more drift accumulates and the more reconciliation work piles up

Phase 5 makes the migration a tracked, prioritized, time-boxed effort with per-patient ownership.

---

### Architectural design

#### The cohort

```sql
-- "Migration cohort"
SELECT p.*, lbr.legacy_system, lbr.product_label, lbr.monthly_amount_cents, lbr.last_charge_at
FROM patients p
JOIN legacy_billing_records lbr ON lbr.patient_id = p.patient_id AND lbr.active = true
WHERE
  p.status_key IN ('active', 'active_pending')
  AND p.billing_source IN ('qbo_legacy', 'jane_legacy', 'primecare_legacy', 'ins_supp_legacy')
  AND p.migration_state != 'completed';
```

`legacy_billing_records` was created in Phase 3. The migration state is tracked in a new column `patients.migration_state`.

#### Migration state machine

```
[in_progress]
   ↓ staff sends Healthie billing link
[link_sent]
   ↓ patient pays in Healthie
[active_in_healthie]
   ↓ staff cancels legacy billing
[legacy_canceled]
   ↓ system verifies cancellation (or staff confirms)
[completed]

Branches:
[in_progress] → [declined]            (patient declines migration)
[link_sent]   → [link_expired]        (no payment after 14 days)
[any]         → [escalated]           (staff manual flag for follow-up)
```

#### The "Migration" dashboard tab UX

URL: `/migration`. Columns:

| Column | Source |
|---|---|
| Patient name + brand | `patients` |
| Current legacy system | `legacy_billing_records.legacy_system` |
| Legacy product | `legacy_billing_records.product_label` |
| $ / month | `legacy_billing_records.monthly_amount_cents` |
| Months on legacy | derived from `service_start_date` |
| Last legacy charge | `legacy_billing_records.last_charge_at` |
| Migration state | enum |
| Days in current state | derived |
| Assigned staff | `patients.migration_assignee` |
| Last contact attempt | most recent `migration_contact_log` entry |
| Actions | buttons per state |

Default sort: months-on-legacy DESC × $-per-month DESC (highest-value oldest patients first). Filter chips: legacy_system, brand, state, $-bucket.

Click into a row → modal with:
- Full patient summary
- Current legacy billing detail (QBO customer ID, Jane subscription ID)
- Migration contact log (who reached out, when, outcome)
- Action buttons per current state
- "Send Healthie billing link" → choose package, send via Phase 6 receivers
- "Mark legacy canceled" → set state, prompt for confirmation method (manual / verified)

#### Verify-on-migrate (trust-but-verify)

When staff marks a patient as migrated to Healthie, the system:
1. Re-queries Healthie `recurringPayments(user_id: <healthie_id>)` immediately.
2. If active recurring found → state = `active_in_healthie`. Banner: "✓ Healthie recurring confirmed: <product>".
3. If no active recurring found → state stays at `link_sent`. Banner: "⚠ No active Healthie recurring found. Did the patient complete payment? Check Healthie billing portal: <link>"
4. The "Mark legacy canceled" button is GREYED OUT until state = `active_in_healthie`. Prevents staff from canceling legacy before Healthie is confirmed live.

#### Auto-state transitions via cron

The auto-classification cron (Phase 3) detects the `qbo_legacy → healthie_recurring` transition and bumps `patients.migration_state` to `active_in_healthie` automatically. Phase 5 extends Phase 3's cron to handle this.

A second cron (`/api/cron/migration-state-monitor`) runs daily and:
- Transitions `link_sent` → `link_expired` after 14 days with no progress, sends staff a follow-up nudge.
- Computes summary stats for the CEO widget.
- Alerts if any patient sits in `link_sent` for >30 days.

#### CEO widget detail

On the iPad Today/CEO tab:

```
LEGACY BILLING MIGRATION
━━━━━━━━━━━━━━━━━━━━━━━━━━
Total patients still on legacy:    47
Total $/mo at risk:                $8,640
By system:
  QBO     38 patients   $6,840/mo
  Jane     7 patients   $1,260/mo
  Other    2 patients     $540/mo

Last 7 days:
  Migrated to Healthie:   5
  Migrations in progress: 12
  Stalled (>14 days):     3 ⚠

[ View Migration Tab ]
```

The widget pulls from the migration query at iPad-load time and updates with the dashboard mapping layer per the `feedback_dashboard_mapping_layer.md` pin (must be added to `loadDashboard()` in `public/ipad/app.js`).

---

### Database schema changes

```sql
-- migrations/2026XXXX_migration_tracker.sql

-- 1. Patient state for the migration tracker
ALTER TABLE patients
  ADD COLUMN migration_state TEXT
    CHECK (migration_state IN ('in_progress', 'link_sent', 'active_in_healthie', 'legacy_canceled', 'completed', 'declined', 'link_expired', 'escalated'))
    DEFAULT 'in_progress',
  ADD COLUMN migration_state_updated_at TIMESTAMPTZ,
  ADD COLUMN migration_assignee INTEGER REFERENCES users(user_id),
  ADD COLUMN migration_target_package TEXT;  -- which Healthie package staff offered

-- 2. Migration contact log (interactions)
CREATE TABLE migration_contact_log (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(patient_id),
  contact_at TIMESTAMPTZ DEFAULT NOW(),
  contact_kind TEXT,          -- 'sms_sent' | 'email_sent' | 'call_attempted' | 'task_created' | 'state_transition'
  contact_by INTEGER REFERENCES users(user_id),
  outcome TEXT,
  details JSONB
);
CREATE INDEX idx_migration_contact_patient ON migration_contact_log(patient_id, contact_at DESC);
```

`legacy_billing_records` was already created in Phase 3.

---

### Per-path code changes

| File | Change |
|---|---|
| `migrations/2026XXXX_migration_tracker.sql` | NEW |
| `lib/migration.ts` | NEW — cohort query + state transitions |
| `app/api/migration/cohort/route.ts` | NEW — GET endpoint |
| `app/api/migration/[patientId]/send-link/route.ts` | NEW — sends Healthie billing link via Phase 6 receivers |
| `app/api/migration/[patientId]/mark-canceled/route.ts` | NEW — marks legacy canceled with verification gate |
| `app/api/migration/[patientId]/decline/route.ts` | NEW — patient declined |
| `app/api/migration/[patientId]/escalate/route.ts` | NEW — flag for manual follow-up |
| `app/api/migration/[patientId]/assignee/route.ts` | NEW — reassign |
| `app/api/cron/migration-state-monitor/route.ts` | NEW — daily monitor |
| `app/api/cron/auto-classification/route.ts` | MODIFY — also bump migration_state when billing_source flips healthie_recurring |
| `app/migration/page.tsx` | NEW — Migration tab UI |
| `components/migration/MigrationTable.tsx` | NEW |
| `components/migration/SendLinkModal.tsx` | NEW |
| `components/migration/MarkCanceledModal.tsx` | NEW (gated on `active_in_healthie`) |
| `public/ipad/app.js` | MODIFY — add CEO widget; add migration data to dashboard mapping layer |
| `crontab` | UPDATE — add daily migration-state-monitor cron |
| `docs/sot-modules/27-patient-flow-map.md` | UPDATE — Stage 6 migration overlay reflects implementation |
| `docs/sot-modules/19-deprecated-systems.md` | UPDATE — QBO/Jane sunset section references the migration tracker as the operational source of truth for the cutover |

---

### One-time data ingestion

Before the tracker shows real data, we need to populate `legacy_billing_records` from QBO + Jane systems. Sub-phase 5.0 covers:

1. **QBO ingestion script** — `scripts/migration/ingest-qbo-customers.ts`. Pulls QBO customers + recurring invoices via QBO API (using `lib/quickbooks.ts`). Maps to dashboard patients by email/name/etc. Writes a row to `legacy_billing_records` per active subscription.
2. **Jane ingestion** — Jane has no public API for subscriptions, so this is a manual CSV export from Jane → import script. (`scripts/migration/import-jane-csv.ts` reads the CSV, matches to patients, populates records.)
3. **PrimeCare / InsSupp** — likely manual CSV or query against existing data.

Each script writes to `legacy_billing_records` and updates `patients.billing_source` to the appropriate enum. Idempotent: re-running matches by external ID.

---

### Won't-touch guarantees

- **NO automatic cancellation of QBO/Jane subscriptions.** Cancellation is staff-driven; system only verifies + tracks.
- **NO modification of `status_key`.** Migration is orthogonal.
- **NO automatic Healthie package selection.** Staff chooses; system sends the link only after staff action.
- **NO auto-decline.** Patients stay in the queue until explicit staff action OR `link_expired` after 14 days (which still keeps them in the tracker for follow-up).
- **NO patient-side surprise.** Migration nudges go through Phil-approved templates only.

---

### Acceptance criteria

1. **Cohort populates**: `legacy_billing_records` populated from QBO + Jane ingestion. Migration tab shows N patients.
2. **State machine works**: walk a test patient through `in_progress → link_sent → active_in_healthie → legacy_canceled → completed`. All transitions logged. UI gates work (Mark Canceled greyed until Healthie verified).
3. **Verify-on-migrate catches drift**: mark a patient migrated who has no Healthie recurring → banner appears, state stays at `link_sent`. State only advances after Healthie shows real recurring.
4. **Auto-transition via Phase 3 cron**: a patient pays in Healthie → next morning, classification cron flips them → migration_state auto-advances to `active_in_healthie`.
5. **Stalled detection**: a patient at `link_sent` for 15 days → state moves to `link_expired`, follow-up nudge sent.
6. **CEO widget accuracy**: widget count matches table count exactly.
7. **Velocity metric**: a daily-rollup query computes "migrations completed per week." Trends UP from baseline.
8. **No double-handling**: a single patient can't be in two migration states at once.
9. **Rollback safe**: disabling Phase 5 (revert + cron disable) leaves all data intact; legacy billing records remain queryable.

---

### Risk + rollback

**Risks:**
- QBO ingestion script could mis-match customers to patients (e.g., name typos), creating phantom legacy records or missing real ones.
- Jane CSV import depends on a hand-curated CSV — error-prone.
- Verify-on-migrate timing: if Healthie's webhook is delayed, staff might think migration didn't work and re-send.
- Patient receives migration link before they're ready (clinical concerns).

**Mitigations:**
- QBO ingestion has a dry-run mode that produces a CSV: "matched X patients, unmatched Y QBO customers, ambiguous Z." Phil reviews before apply.
- Jane CSV template is pre-defined in `docs/sot-modules/migration-csv-format.md`.
- Verify-on-migrate has a "force refresh" button that re-queries Healthie.
- Migration tab respects `patients.no_clinical_outreach` flag (if set by staff). Patient can be excluded from automated nudges while staff handles it manually.

**Rollback plan:**
- Disable cron.
- Hide migration tab via feature flag.
- Schema additions are additive; safe to leave.
- `legacy_billing_records` data stays — useful even if tracker UI is off.

---

### Sub-phases within Phase 5

| Sub-phase | Scope | Days |
|---|---|---|
| 5.0 | Migration: schema + legacy_billing_records ingestion (QBO + Jane) | 2 |
| 5.1 | `lib/migration.ts` cohort + state machine | 1 |
| 5.2 | API endpoints | 1.5 |
| 5.3 | Migration tab UI | 2.5 |
| 5.4 | Daily monitor cron + auto-state-transition extension to Phase 3 cron | 1 |
| 5.5 | CEO widget on iPad Today | 1 |
| 5.6 | Smoke tests + Phil review of full flow | 0.5 |
| 5.7 | Documentation updates | 0.5 |

Active engineering: ~10 days. Wall-clock: 12–14 days.

---

### Open questions for Phil before kickoff

1. **Default migration target package.** When staff sends a billing link, which Healthie package do we offer by default? (Per brand. e.g., TRT default = "TRT Monthly $180".)
2. **QBO API access.** Confirm `lib/quickbooks.ts` is functional today and has the right scopes for customer + invoice list. If broken, we need to fix that as a prereq.
3. **Jane CSV.** Who's exporting the CSV and at what cadence? Daily? One-time?
4. **Stalled threshold.** 14 days proposed for `link_sent → link_expired`. Acceptable?
5. **Patient-side migration messaging.** Approve the SMS/email templates before any nudges send. I'll draft 3–4 templates.

---

---

## Phase 6 — GHL Rebuild (per-channel receivers) — DETAILED SPEC

**One-line goal:** rebuild GHL as a thin send layer — exactly four "dumb" receivers per location (SMS, Email, Task, Tag) — so all branching/protocol logic lives in dashboard code where it can be tested, version-controlled, and changed without GHL UI clicks.

### Why this phase exists

Phil's 2026-04-24 decision (`project_ghl_reset_plan.md`): "I want to disable all workflows and start from scratch.. except the SMS workflows connecting to our iPad system." Phase 2 disabled the dead graph; Phase 6 builds the replacement.

The architecture is locked in `feedback_ghl_workflow_pattern.md`: **one workflow per channel, never per protocol.** GHL becomes a dumb messenger. Why this works:

1. **Branching belongs in code.** GHL has no version control, no test suite, no PR review. Branching logic in visual workflows is invisible, untestable, and silently drifts. Code-side branching gets diffs, code review, and unit tests.
2. **No GHL workflow create/edit API exists** (confirmed April 2026). Every workflow must be hand-built in the GHL UI. Minimizing the set (12 workflows total instead of 80+) means changes can actually be made without UI archaeology.
3. **All other phases depend on this.** Phase 4 (No Man's Land nudges), Phase 5 (Migration Tracker links), Phase 6.5 (Unified Entry attribution), Phase 7 (Lead source tagging), Phase 8 (At-Risk nudges), Phase 9 (Recon emails not sent here, but admin alerts are) — every phase that sends a patient/staff message routes through these receivers. Without Phase 6, every other phase has to invent its own GHL integration and ends up reproducing the same dead-graph problem.
4. **Inbound stays inbound.** The 3 kept iPad SMS-capture workflows are inbound (GHL → Dashboard). Phase 6 adds the outbound (Dashboard → GHL → patient) side. Together they form a clean two-way channel.

Without Phase 6, Phases 4/5/7/8 either send messages directly via raw GHL API calls scattered across the codebase (the current pattern, which is already fragile) or block waiting for ad-hoc GHL workflow builds.

---

### Architectural design

#### The four channels per location

| Channel | Workflow name | Trigger | Action | Payload |
|---|---|---|---|---|
| SMS | `Dashboard Send SMS` | Inbound webhook | Send SMS to contact | `{contactId, message, dryRun?}` |
| Email | `Dashboard Send Email` | Inbound webhook | Send email to contact | `{contactId, templateId, mergeFields, dryRun?}` |
| Task | `Dashboard Create Task` | Inbound webhook | Create GHL task | `{contactId, title, dueDate, assignee?, body?, dryRun?}` |
| Tag | `Dashboard Tag Apply/Remove` | Inbound webhook | Add or remove tag | `{contactId, tag, action: "add"\|"remove"}` |

Each workflow is a single trigger node + a single action node. No branching, no conditions, no waits. If the payload requires conditional behavior, the dashboard splits the call into two separate webhook hits.

#### Locations (3 unique GHL accounts, 12 receivers total)

| Location | Sub-account(s) | Receivers |
|---|---|---|
| Loc-MH | Men's Health | 4 |
| Loc-PCL | Primary Care + Longevity (shared loc) | 4 |
| Loc-ABX | ABXTac | 4 |

Total: **12 outbound receivers** + the **3 kept inbound SMS-capture workflows** + the **3 ABXTac dev workflows** Phil opted to keep = **18 published workflows post-rebuild** (down from 82). All other phases route through the 12 outbound receivers.

#### `lib/ghl.ts` rewrite — the helper layer

The current `lib/ghl.ts` has scattered direct API calls. Phase 6 introduces a single dispatch layer:

```typescript
// lib/ghl.ts (new structure)
type GhlLocation = 'mens_health' | 'primary_care_longevity' | 'abxtac';

interface SendSmsParams {
  location: GhlLocation;
  contactId: string;
  message: string;
  dryRun?: boolean;
}

interface SendEmailParams {
  location: GhlLocation;
  contactId: string;
  templateId: string;          // dashboard-managed template ID, NOT a GHL UI template
  mergeFields: Record<string, string>;
  dryRun?: boolean;
}

interface CreateTaskParams {
  location: GhlLocation;
  contactId: string;
  title: string;
  dueDate: string;             // ISO
  assignee?: string;           // GHL user ID
  body?: string;
  dryRun?: boolean;
}

interface TagParams {
  location: GhlLocation;
  contactId: string;
  tag: string;
  action: 'add' | 'remove';
}

export async function sendSms(p: SendSmsParams): Promise<{ ok: boolean; messageId?: string }> { ... }
export async function sendEmail(p: SendEmailParams): Promise<{ ok: boolean }> { ... }
export async function createTask(p: CreateTaskParams): Promise<{ ok: boolean; taskId?: string }> { ... }
export async function applyTag(p: TagParams): Promise<{ ok: boolean }> { ... }
```

Each function:
1. Looks up the receiver webhook URL from `lib/ghl-receivers.ts` (config map keyed by `location` + `channel`).
2. POSTs the payload to that webhook.
3. Logs the call to `ghl_send_log` (new table) with the response.
4. Returns a structured result (no exceptions for expected failures — caller decides how to handle).

#### Dashboard-managed email templates

A subtle architectural choice: email templates live in **the dashboard**, not in GHL. The receiver workflow accepts a `templateId` + `mergeFields` and renders server-side, not in GHL. Why:

1. **Version-controlled.** Templates live in `lib/email-templates/<id>.html` — get diffs, code review, branch protection.
2. **Brand-aware.** Templates can pull brand colors/logos at render time using the chameleon engine (`reference_chameleon_engine.md`).
3. **GHL becomes a dumb relay.** The receiver workflow's "Send Email" action takes `subject` + `htmlBody` from the webhook payload, populated by the dashboard's render step.
4. **Avoids GHL email-template archaeology.** Today's GHL has dozens of legacy email templates inside the workflow graph. Pulling them out into code makes them reviewable.

Template registry: `lib/email-templates/registry.ts` exports a typed `EmailTemplate` map. Each template has a brand-parameterized variant per the existing `scripts/email-templates/build_brand_emails.py` system.

#### Outbound logging — `ghl_send_log`

Every outbound message gets logged for auditability and dedup. New table:

```sql
CREATE TABLE ghl_send_log (
  id BIGSERIAL PRIMARY KEY,
  location TEXT NOT NULL,
  channel TEXT NOT NULL,                  -- 'sms' | 'email' | 'task' | 'tag'
  contact_id TEXT NOT NULL,               -- GHL contact ID
  patient_id INTEGER REFERENCES patients(patient_id),
  payload_hash TEXT NOT NULL,             -- sha256 of (channel, contactId, message/templateId)
  payload JSONB NOT NULL,
  ghl_response JSONB,
  status TEXT NOT NULL,                   -- 'sent' | 'failed' | 'dry_run'
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  sent_by_module TEXT NOT NULL,           -- 'phase4_nudge' | 'phase5_migration' | 'manual_dashboard' | etc
  sent_by_user INTEGER REFERENCES users(user_id),
  dedup_window_min INTEGER DEFAULT 60     -- duplicate-suppression window
);
CREATE INDEX idx_ghl_send_log_contact ON ghl_send_log(contact_id, sent_at DESC);
CREATE INDEX idx_ghl_send_log_dedup ON ghl_send_log(payload_hash, sent_at DESC);
```

Helper: `wasRecentlySent(payloadHash, windowMinutes)` returns true if the same payload was sent within the window, allowing nudge crons to dedup automatically.

#### Dry-run mode

Every helper accepts `dryRun: true`. When set:
- The webhook is NOT called.
- The log entry is written with `status='dry_run'`.
- The function returns success.

This lets Phases 4/5/7/8 run "what would I send today?" reports without sending actual messages — critical during dry-run rollout windows.

#### Idempotency / duplicate suppression

Each helper, before sending, checks `ghl_send_log` for a matching `payload_hash` within the last 60 minutes (configurable). If found, suppresses the send and returns `{ok: true, suppressed: true}`. Prevents the classic "cron retried, patient got 3 SMS" problem.

#### Webhook URL secret management

Each receiver's webhook URL is a long secret — it's the entire auth model for the receiver. Storage:

```bash
# .env.local
GHL_WEBHOOK_MH_SMS=https://services.leadconnectorhq.com/hooks/...
GHL_WEBHOOK_MH_EMAIL=https://...
GHL_WEBHOOK_MH_TASK=...
GHL_WEBHOOK_MH_TAG=...
GHL_WEBHOOK_PCL_SMS=...
# ... etc 12 total
```

`lib/ghl-receivers.ts` reads these and exposes a typed map. Production secrets stored in EC2 environment variables; local dev uses `.env.local`. Never committed.

#### Test contact whitelist (per never-charge-patients pin)

During Phase 6 development AND any time `process.env.NODE_ENV !== 'production'`, all helpers reject sends to any contact whose email is not in:
- `philschafer7@gmail.com` (Phil's test email per `feedback_never_charge_patients.md`)
- A configured list of staff test contacts in `GHL_TEST_CONTACT_WHITELIST` env var

This prevents accidental sends to real patients during testing. In production, the gate is removed but Phase 6 acceptance requires Phil to flip this flag manually after smoke tests.

---

### Database schema changes

```sql
-- migrations/2026XXXX_ghl_send_log.sql

CREATE TABLE ghl_send_log (
  id BIGSERIAL PRIMARY KEY,
  location TEXT NOT NULL,
  channel TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  patient_id INTEGER REFERENCES patients(patient_id),
  payload_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  ghl_response JSONB,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'dry_run', 'suppressed')),
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  sent_by_module TEXT NOT NULL,
  sent_by_user INTEGER REFERENCES users(user_id),
  dedup_window_min INTEGER DEFAULT 60
);
CREATE INDEX idx_ghl_send_log_contact ON ghl_send_log(contact_id, sent_at DESC);
CREATE INDEX idx_ghl_send_log_dedup ON ghl_send_log(payload_hash, sent_at DESC);
CREATE INDEX idx_ghl_send_log_module ON ghl_send_log(sent_by_module, sent_at DESC);
CREATE INDEX idx_ghl_send_log_patient ON ghl_send_log(patient_id, sent_at DESC) WHERE patient_id IS NOT NULL;

-- Optional: 90-day retention via pg_cron (configurable)
-- DELETE FROM ghl_send_log WHERE sent_at < NOW() - INTERVAL '90 days';
```

No changes to existing tables. Send log is purely additive.

---

### Per-path code changes

| File | Change |
|---|---|
| `migrations/2026XXXX_ghl_send_log.sql` | NEW |
| `lib/ghl.ts` | REWRITE — replace ad-hoc API calls with `sendSms / sendEmail / createTask / applyTag` typed helpers |
| `lib/ghl-receivers.ts` | NEW — typed config map of webhook URLs by location+channel |
| `lib/ghl-send-log.ts` | NEW — logging + dedup + dry-run helpers |
| `lib/email-templates/registry.ts` | NEW — typed EmailTemplate map |
| `lib/email-templates/<template>.html` | NEW — one file per dashboard-managed template |
| `lib/email-templates/render.ts` | NEW — server-side template render with merge fields + brand context |
| `app/api/webhooks/ghl/messages/route.ts` | NO CHANGE (kept inbound workflow drives this; preserved as-is) |
| `app/api/admin/ghl-send-log/route.ts` | NEW — read-only API for the audit UI |
| `app/admin/ghl-send-log/page.tsx` | NEW — staff UI to browse outbound message history |
| `scripts/ghl-rebuild/build-receiver-checklist.mjs` | NEW — generates a per-location checklist Phil can paste into GHL UI for the manual workflow build |
| `scripts/ghl-rebuild/smoke-test-receivers.mjs` | NEW — sends a dry-run + a real send to whitelisted test contact for each of the 12 receivers |
| `scripts/ghl-rebuild/migrate-callers.mjs` | NEW — codemod that rewrites direct `lib/ghl.ts` API calls to the new typed helpers (with manual review) |
| `docs/sot-modules/23-ghl-ai-agents.md` | UPDATE — document the 12 receivers, their webhook URLs (env-var names), payload shapes, and the dashboard-side helper contract |
| `docs/sot-modules/27-patient-flow-map.md` | UPDATE — Stage references to GHL touchpoints now point to the four-channel architecture |
| `docs/sot-modules/19-deprecated-systems.md` | UPDATE — note that the 80+ legacy workflows are graveyarded post-Phase-2 |
| `~/.claude/projects/-home-ec2-user/memory/project_ghl_reset_plan.md` | UPDATE — append "Rebuild done: 12 receivers + 3 inbound + 4 ABXTac dev = 19 total workflows" with the date |

---

### Caller migration (the codebase sweep)

Before the rewrite of `lib/ghl.ts` can land, every existing call site has to be updated. Sub-phase 6.4 handles this:

1. Grep `lib/ghl.ts` for every exported function name in current use.
2. Grep the codebase for those imports — produce a callers list.
3. For each caller, replace the direct API call with the appropriate typed helper (e.g., `ghl.contacts.sms()` → `sendSms({location, contactId, message})`).
4. Mark the legacy functions as deprecated (`@deprecated`) and remove after Phase 6 ships and is stable for 14 days.

Estimated callers (pre-grep): ~25 in `app/api/`, ~10 in `scripts/`, ~5 in `lib/`. Most are SMS/email; few touch tags/tasks.

---

### GHL UI build checklist (Phil-runnable)

Since GHL has no workflow create API, the actual workflow construction is manual UI work. Phase 6 deliverable to Phil: a markdown checklist with one section per receiver:

```markdown
### Receiver: Loc-MH / Send SMS
- [ ] Open GHL → Men's Health → Automation → Workflows → Create
- [ ] Name: "Dashboard Send SMS"
- [ ] Trigger: Inbound webhook
- [ ] Copy webhook URL → paste into .env.local as GHL_WEBHOOK_MH_SMS
- [ ] Action: Send SMS
  - Phone: {{inboundWebhookData.contactPhone}}
  - Message: {{inboundWebhookData.message}}
- [ ] Publish
- [ ] Confirm webhook URL in dashboard env
- [ ] Run smoke test: `node scripts/ghl-rebuild/smoke-test-receivers.mjs --receiver mh_sms`
```

12 sections × ~6 steps each = a Phil-doable hour of GHL UI work. Each section is independent — Phil can pause/resume.

The `scripts/ghl-rebuild/build-receiver-checklist.mjs` generates this automatically from `lib/ghl-receivers.ts` so the checklist is always in sync with the code.

---

### Won't-touch guarantees

- **Will NOT modify the 3 kept inbound SMS-capture workflows.** They remain published, untouched.
- **Will NOT modify the 3 active ABXTac dev workflows** (`Telehealth Consult Automation`, `Post Purchase Welcome`, `Order Shipped`). They're Phil's active build; left alone.
- **Will NOT touch GHL contacts, tags, opportunities, or conversations.** Phase 6 is workflow-layer only.
- **Will NOT auto-create receivers via API.** No GHL workflow create API exists; build is human-driven via the checklist.
- **Will NOT send any messages to non-test contacts during build/test phase.** Test whitelist gate enforced.
- **Will NOT replace the email-template generator system** (`scripts/email-templates/build_brand_emails.py`). The receiver pattern integrates with it; doesn't deprecate it.
- **Will NOT remove legacy `lib/ghl.ts` functions until 14 days post-deploy** with caller-migration verified.

---

### Acceptance criteria

1. **All 12 receivers built + published in GHL.** Phil walks through the checklist; smoke-test script confirms each receiver responds.
2. **`lib/ghl.ts` rewrite passes type-check** (`npx tsc --noEmit`) and `npx next build` succeeds.
3. **All callers migrated.** Grep finds zero remaining direct calls to deprecated functions in `app/`, `lib/`, `scripts/`.
4. **Smoke test green for all 12 receivers.** `node scripts/ghl-rebuild/smoke-test-receivers.mjs --all` sends a dry-run + a real send (to whitelisted contact) for each. All return `{ok: true}` and `ghl_send_log` shows the entries.
5. **Dedup works.** Send the same payload twice within 60min → second send returns `suppressed=true` with no GHL API hit.
6. **Dry-run mode works.** Send with `dryRun: true` → `ghl_send_log.status='dry_run'`, no GHL API hit.
7. **Test-contact gate enforced.** In dev mode, attempting to send to a non-whitelisted contact returns an error and logs nothing to GHL.
8. **Audit UI shows real data.** `/admin/ghl-send-log` displays the last N sends with filterable columns.
9. **Phase 4 Pending Onboarding queue uses Phase 6 helpers.** When Phase 4 ships first, its nudge code calls `sendSms()` / `createTask()` and the audit shows the entries.
10. **Phase 5 migration tracker uses Phase 6 helpers** for the "Send Healthie billing link" button.
11. **Documentation up-to-date.** Module 23 lists every receiver, webhook env-var name, and payload contract.

---

### Risk + rollback

**Risks:**
- A receiver webhook URL leaks → unauthorized party can send messages from our GHL → patient gets phishing/spam appearing to come from GMH brand. **Mitigation:** Webhook URLs in env-only, never logged in plaintext, never in code. `ghl_send_log` redacts the URL portion. Rotate via GHL UI if leak suspected.
- Caller migration introduces regression → an existing flow that sent SMS now fails silently. **Mitigation:** Sub-phase 6.4 migrates callers one path at a time with an integration test for each. Legacy functions kept for 14 days as fallback.
- Email template render bug → wrong merge fields shown to patient. **Mitigation:** Template registry has unit tests for each template; render function has snapshot tests.
- Dedup window too aggressive → legitimate two-message sequences get suppressed. **Mitigation:** Each helper accepts an explicit `dedup_window_min` override; default 60 min, can be 0 for legitimately repeated messages.
- GHL receiver workflow accidentally deleted via UI → all sends to that channel break. **Mitigation:** `scripts/ghl-rebuild/post-build-monitor.mjs` runs daily, alerts admin@ if any expected receiver isn't published.

**Rollback plan:**
- Phase 6 ships behind a feature flag `GHL_REBUILD_ACTIVE`. If the rebuild is broken:
  - Set flag to `false` → callers fall back to legacy `lib/ghl.ts` functions (kept during 14-day overlap window).
- The 12 new GHL receivers remain published (no harm from being unused).
- `ghl_send_log` table is additive; safe to leave.
- Codemod migration is git-revertible.

---

### Sub-phases within Phase 6

| Sub-phase | Scope | Days |
|---|---|---|
| 6.0 | `ghl_send_log` migration + `lib/ghl-send-log.ts` | 0.5 |
| 6.1 | `lib/ghl-receivers.ts` config map + env-var wiring | 0.5 |
| 6.2 | `lib/ghl.ts` rewrite + typed helpers (`sendSms / sendEmail / createTask / applyTag`) | 1.5 |
| 6.3 | `lib/email-templates/` registry + render + brand integration | 1.5 |
| 6.4 | Caller migration codemod + manual review across `app/`, `lib/`, `scripts/` | 2 |
| 6.5 | Phil-runnable GHL UI build checklist generation + Phil's GHL UI build session (12 receivers) | 1 |
| 6.6 | Smoke-test script + run for all 12 receivers | 1 |
| 6.7 | Audit UI (`/admin/ghl-send-log`) | 1 |
| 6.8 | Phase 4 + Phase 5 wiring through Phase 6 helpers (regression-safe) | 1 |
| 6.9 | Documentation updates (module 23, 27, 19) | 0.5 |
| 6.10 | 14-day soak with legacy fallback enabled | (calendar) |
| 6.11 | Remove legacy `lib/ghl.ts` deprecated functions | 0.5 |

Active engineering: ~10 days. Wall-clock: 14 + 14 (soak) = ~28 days end-to-end.

---

### Open questions for Phil before kickoff

1. **GHL UI build session.** When can you set aside ~1 hour to click through the 12-receiver build checklist? Suggest blocking it on the calendar; the rest of Phase 6 can be done by AntiGravity solo, but this step is Phil-only.
2. **Email template inventory.** Which specific email templates need to live in the dashboard registry on day one? (Starting list: welcome, lab-results-ready, appointment-reminder, migration-link, no-mans-land-nudge.) Anything else to seed?
3. **Test-contact whitelist.** Confirm `philschafer7@gmail.com` is the only test contact, OR add specific staff emails for broader test coverage. Worth adding admin@ as a second whitelist entry?
4. **Dedup default window.** 60 minutes proposed. Is that right? Some flows (e.g., back-to-back SMS confirming both an order and a shipment) might need shorter; some (e.g., onboarding nudge) might need longer.
5. **Webhook URL rotation policy.** GHL webhook URLs are static once published — rotation requires manual UI work. Acceptable to leave them in place indefinitely, OR set a rotation cadence (annual)?
6. **Audit retention.** 90-day retention on `ghl_send_log` proposed. Compliance / patient-communication-records concern? HIPAA implications if these are considered medical communications?
7. **Brand chameleon hook.** Email render integrates with the chameleon engine — confirm we want brand-themed emails for ALL outbound, not just patient-facing? (Internal-only emails likely should stay GMH-branded.)

---

## Phase 6.5 — Unified Entry Handler (Stages 1, 2) — DETAILED SPEC

**One-line goal:** every way a patient enters the system runs through ONE orchestrator that creates linked, deduped, source-attributed records in all 3 systems (Dashboard + Healthie + GHL). No more orphans, no more cross-path duplicates, no more scattered source attribution.

### Why this phase exists

From the 2026-04-24 entry-point audit (sot-modules/27 §Entry Point Catalog), only **2 of the ~20 active patient-entry paths** auto-chain all 3 systems today: the ABXTac website booking (`/api/abxtac/book`) and the dashboard staff-create (`POST /api/patients`). Every other path creates an orphan in one or two systems and relies on staff or cron to manually catch it up. This produces:

- **Orphan GHL contacts** that never become Healthie patients (lost leads, lost attribution)
- **Orphan Healthie patients** with no GHL contact (can't be reached by marketing/nurture)
- **Cross-path duplicates** because dashboard's existing duplicate check doesn't query GHL, so the same person can land twice
- **Source attribution scattered** across `patients.source_tag`, GHL custom fields, GHL tags, and Healthie group ID — no canonical column means analytics are unreliable

This phase fixes all four at once with a single orchestrator + a single source-of-truth column.

---

### Architectural design

#### The orchestrator: `lib/patient-entry.ts`

A new module exporting one primary function and a few helpers. Every entry path imports and calls it.

```ts
// lib/patient-entry.ts (new file)

export interface PatientEntryInput {
  // Identity (at least one of email/phone REQUIRED)
  email?: string;
  phone?: string;
  firstName: string;
  lastName: string;
  dob?: string;          // YYYY-MM-DD
  gender?: 'male' | 'female' | 'other' | 'unknown';

  // Source attribution (REQUIRED)
  sourcePath: SourcePath;       // see enum below
  sourceDetail?: string;        // free text, e.g. "Facebook ad: TRT spring promo"
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;

  // Brand / care line
  brand: 'mens_health' | 'primary_care' | 'abxtac' | 'longevity';
  initialCareLine?: string;     // e.g. 'TRT', 'Weight Loss', 'Peptides'

  // Optional: caller already has IDs in one or more systems (idempotent re-entry)
  existingHealthieId?: string;
  existingGhlContactId?: string;
  existingDashboardPatientId?: number;

  // Optional: appointment context (when entry is a booking, not just a lead)
  appointmentContext?: {
    appointmentTypeId: string;
    providerId: string;
    scheduledFor: string;       // ISO timestamp
    locationId: string;
  };

  // Optional: who/what triggered this entry (for audit)
  triggeredBy?: {
    type: 'staff' | 'webhook' | 'cron' | 'patient_self' | 'system';
    userId?: number;
    sourceWebhookId?: string;
  };
}

export interface PatientEntryResult {
  dashboardPatientId: number;
  healthieId: string;
  ghlContactId: string;
  wasNewlyCreated: {
    dashboard: boolean;
    healthie: boolean;
    ghl: boolean;
  };
  duplicatesFound: DuplicateMatch[];
  warnings: string[];
}

export async function enterPatient(input: PatientEntryInput): Promise<PatientEntryResult>;
```

#### Internal flow inside `enterPatient()`

1. **Validate input** — must have at least email OR phone; first/last name required; brand required; sourcePath required.
2. **Cross-system dedup check** (new — this is the GHL-aware extension):
   - Query dashboard `patients` table by email + phone (existing logic).
   - Query Healthie via `users(email:)` and `users(phone:)` filtered to active only (per `feedback_healthie_active_only` pin).
   - **Query GHL** via `searchContacts` against the relevant sub-account by email + phone. (This is the new check.)
   - Cross-reference DOB and gender if provided to handle shared-email spouses (per `reference_shared_email_patients` pin — Janel + Rich Freeman case).
   - Build a `DuplicateMatch[]` array showing matches in each system with confidence scores.
3. **Resolve or create per system**, in this order (dashboard → Healthie → GHL):
   - **Dashboard:** if existing patient found (or `existingDashboardPatientId` passed), use it; else `INSERT` new patient row with `source_path = input.sourcePath`.
   - **Healthie:** if `existingHealthieId` passed OR found via dedup, use it. Otherwise create via `createClient` mutation with appropriate `user_group_id` based on `brand`. Persist the Healthie ID back onto the dashboard row.
   - **GHL:** if `existingGhlContactId` passed OR found via dedup, use it. Otherwise create via `createContact` against the brand-correct sub-account. Persist the GHL contact ID onto the dashboard row.
4. **Apply source attribution** consistently:
   - `patients.source_path` ← `input.sourcePath`
   - `patients.source_detail` ← `input.sourceDetail`
   - `patients.utm_source / utm_medium / utm_campaign` ← UTM fields
   - GHL contact `source` field ← `input.sourcePath` (mapped to GHL's source string format)
   - GHL tags ← brand tag + sourcePath tag
   - Healthie tags (per `reference_healthie_tags_vs_groups` pin) ← brand-appropriate set
5. **Optional: book appointment** if `appointmentContext` provided — use existing Healthie booking helper.
6. **Write audit row** to `agent_action_log`: who, what, when, which systems were created vs. matched, dedup details.
7. **Return** the populated `PatientEntryResult`.

#### Idempotency

All three create operations are idempotent:
- Dashboard: dedup-check-then-insert wrapped in transaction; if a concurrent insert wins, retry the dedup match.
- Healthie: dedup by email first; never use `users[0]` blindly (per `feedback_healthie_active_only` pin) — must filter active and match identity.
- GHL: same pattern — search first, create only on no-match.

Calling `enterPatient()` twice with the same input returns the same `dashboardPatientId / healthieId / ghlContactId` and `wasNewlyCreated` set to false for all three on the second call.

---

### Database schema changes

A migration adds canonical source-attribution columns:

```sql
-- migrations/2026XXXX_patient_source_path.sql

CREATE TYPE patient_source_path AS ENUM (
  'abxtac_web',           -- ABXTac website booking flow
  'brand_form',           -- Lead form on TRTNow / NOW MH / NOW PC / Longevity sites
  'ghl_ad',               -- Captured from GHL ad funnel (FB/Google/TikTok)
  'ghl_sms',              -- Inbound SMS to GHL number
  'ghl_call',             -- Inbound phone call to GHL number
  'ghl_voicemail',        -- Inbound voicemail
  'ghl_manual',           -- Created directly in GHL UI by staff
  'healthie_direct',      -- Created directly in Healthie UI (synced via webhook)
  'ipad_kiosk',           -- iPad kiosk in-clinic intake
  'dashboard_manual',     -- Staff create in dashboard
  'mobile_app',           -- Mobile app self-signup (future capability)
  'partner_referral',     -- Doctor/partner referral
  'utm_link',             -- UTM-tagged inbound web traffic
  'batch_import',         -- Bulk import script
  'unknown'               -- Backfilled rows or pre-Phase-6.5 patients
);

ALTER TABLE patients
  ADD COLUMN source_path patient_source_path DEFAULT 'unknown',
  ADD COLUMN source_detail TEXT,
  ADD COLUMN utm_source TEXT,
  ADD COLUMN utm_medium TEXT,
  ADD COLUMN utm_campaign TEXT,
  ADD COLUMN entry_recorded_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX idx_patients_source_path ON patients(source_path);
CREATE INDEX idx_patients_utm ON patients(utm_source, utm_medium, utm_campaign)
  WHERE utm_source IS NOT NULL;
```

The legacy `source_tag` column is **kept** (not dropped) for backwards-compat with existing reports. Phase 6.5 only writes `source_path`. A separate optional Phase 6.6 backfill could derive `source_path` from existing `source_tag` values if desired.

---

### Per-entry-path migration plan

Every existing entry path is rewritten to call `enterPatient()`. The 6.5 ships when ALL of these are migrated:

| Path (per audit) | Current code | After Phase 6.5 |
|---|---|---|
| **A — ABXTac website booking** | `app/api/abxtac/book/route.ts` does its own 3-system create | Refactor to call `enterPatient({ sourcePath: 'abxtac_web', brand: 'abxtac', appointmentContext: {...} })` |
| **C — Brand website lead form** | Today: GHL contact only, no further sync | New webhook `app/api/webhooks/lead-form/[brand]/route.ts` calls `enterPatient({ sourcePath: 'brand_form', brand: <brand>, ... })` |
| **D — GHL ad funnel** | Today: GHL contact only | Hook into `app/api/webhooks/ghl/contact-created/route.ts` (currently doesn't exist; create it) → calls `enterPatient({ sourcePath: 'ghl_ad' })` |
| **E — GHL inbound SMS** | `app/api/webhooks/ghl/messages/route.ts` (logs message but no patient create) | If contact has no linked dashboard patient: call `enterPatient({ sourcePath: 'ghl_sms' })` then attach the message |
| **F — GHL inbound call** | Same as E | Same handler, `sourcePath: 'ghl_call'` |
| **G — GHL inbound voicemail** | Same as E | Same handler, `sourcePath: 'ghl_voicemail'` |
| **H — Healthie webhook patient created** | `app/api/webhooks/healthie/patient-created/route.ts` syncs to dashboard but skips GHL | Replace with call to `enterPatient({ sourcePath: 'healthie_direct', existingHealthieId: <id> })` — orchestrator now also creates GHL contact |
| **J — iPad kiosk submit** | `app/api/ipad/kiosk/submit/route.ts` creates dashboard + Healthie | Refactor to call `enterPatient({ sourcePath: 'ipad_kiosk' })` — adds GHL contact creation |
| **K — Staff manual create** | `app/api/patients/route.ts` POST | Refactor to call `enterPatient({ sourcePath: 'dashboard_manual', triggeredBy: { type: 'staff', userId: <staff> } })` |
| **M — GHL UI manual create** | Today: silent — no propagation | Either add a GHL webhook handler (preferred) OR a daily reconciliation cron that detects new GHL contacts and calls `enterPatient({ sourcePath: 'ghl_manual' })` |
| **L — Healthie UI manual create** | Same as H | Covered by H's refactor |
| **N — Mobile app login** | `app/api/headless/record-app-login/route.ts` (lookup-only) | NO CHANGE — read-only path remains read-only. Optional future: add a `mobile_app` self-signup flow that calls `enterPatient({ sourcePath: 'mobile_app' })`. |
| **O/P — Referral / UTM link** | Today: lands in GHL via website form | Same as path C — single webhook handler with appropriate `sourcePath` |
| **V — Batch import** | `scripts/backfill-patients-from-healthie.ts`, `scripts/auto-link-healthie.ts` | Scripts call `enterPatient({ sourcePath: 'batch_import' })` per-row instead of doing direct inserts |

After this phase, **every patient creation in the system goes through one function.** New entry paths added in the future just need to call `enterPatient()` with the right `sourcePath`.

---

### Cross-system dedup detail (the GHL-aware piece)

Today's duplicate-check (in `app/api/patients/route.ts`) queries:
- Dashboard `patients` by email and phone
- Healthie `users(email:)` (broken — never trust `users[0]`, per memory pin)

It does NOT query GHL. So a person who filled a brand lead form (path C) and is sitting in GHL can be re-entered via staff dashboard create (path K) with no warning.

The new `findDuplicatesAcrossAllSystems()` helper in `lib/patient-entry.ts`:

```ts
async function findDuplicatesAcrossAllSystems(input: {
  email?: string;
  phone?: string;
  firstName: string;
  lastName: string;
  dob?: string;
  brand: Brand;
}): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];

  // 1. Dashboard
  if (input.email) {
    const rows = await query(
      'SELECT patient_id, healthie_id, ghl_contact_id, dob FROM patients WHERE LOWER(email) = LOWER($1)',
      [input.email],
    );
    for (const row of rows) {
      // DOB cross-check guards against shared-email spouses
      const dobMatches = !input.dob || !row.dob || row.dob === input.dob;
      matches.push({
        system: 'dashboard',
        externalId: String(row.patient_id),
        confidence: dobMatches ? 'high' : 'low',
        reason: dobMatches ? 'email exact + dob match/missing' : 'email matches but DOB differs',
        record: row,
      });
    }
  }
  // ... same for phone

  // 2. Healthie — search by email AND phone, filter active only
  const healthieMatches = await searchHealthieActive({
    email: input.email,
    phone: input.phone,
    brand: input.brand,
  });
  for (const u of healthieMatches) {
    matches.push({
      system: 'healthie',
      externalId: u.id,
      confidence: scoreHealthieMatch(u, input),
      reason: '...',
      record: u,
    });
  }

  // 3. GHL — search by email AND phone in the brand-correct sub-account
  const ghlClient = getGhlClientForBrand(input.brand);
  const ghlMatches = await ghlClient.searchContacts({
    email: input.email,
    phone: input.phone,
  });
  for (const c of ghlMatches) {
    matches.push({
      system: 'ghl',
      externalId: c.id,
      confidence: scoreGhlMatch(c, input),
      reason: '...',
      record: c,
    });
  }

  return matches;
}
```

The orchestrator uses this to decide: link to existing OR create. Confidence scoring:
- `high`: email + DOB match (or email + phone if no DOB)
- `medium`: email match only, no DOB info either way
- `low`: phone match only, OR email match with DOB mismatch (likely shared-email spouse)

`high` → auto-link. `medium` → auto-link with warning. `low` → return as `duplicatesFound[]` and require explicit `forceCreate: true` from caller (mirrors today's dashboard manual-create behavior).

---

### Source attribution: what changes for the user

**Today** the question "how did this patient come in?" requires querying multiple places:
- `patients.source_tag` (free text, inconsistent)
- GHL contact `source` field (sometimes set, sometimes not)
- GHL tags (multiple per contact, brand-mixed)
- Healthie `user_group` (only tells you brand, not source within brand)

**After Phase 6.5:**
- `patients.source_path` is the canonical answer. One enum, every patient has it (defaults to `'unknown'` for legacy rows).
- `patients.source_detail` carries the human-readable nuance ("Facebook ad campaign 'spring TRT promo' creative #4").
- UTM trio captured separately for marketing analytics.

A new **CEO widget** on the iPad Today / CEO tab summarizes this:
```
LEADS THIS MONTH BY SOURCE
  brand_form (web)        42
  ghl_ad (paid)           31
  partner_referral        12
  ipad_kiosk (walk-in)     8
  dashboard_manual         5
```

---

### Won't-touch guarantees

- **No existing `status_key` changes.** Orchestrator only creates rows; never modifies state of existing patients.
- **No package or recurring-billing changes.** Healthie create is identity-only. Recurring billing remains a separate flow (Stage 5).
- **ABXTac path A behavior preserved exactly.** The refactor is internal — same external behavior; the orchestrator wraps the existing 3-system chain.
- **Mobile app stays read-only.** No surprise self-signup behavior introduced.
- **Legacy `source_tag` column kept.** Reports that read it continue to work.

---

### Acceptance criteria

1. `lib/patient-entry.ts` exists with `enterPatient()` exported.
2. All 12 entry paths in the migration table above are routed through it.
3. Migration `2026XXXX_patient_source_path.sql` has been applied; all new patients get a non-`unknown` `source_path`.
4. Cross-system dedup catches a known case: manually create a GHL contact via GHL UI, then attempt to staff-create the same person in dashboard → orchestrator returns `duplicatesFound: [{ system: 'ghl', confidence: 'high' }]` and links to the existing GHL contact.
5. Idempotency test: call `enterPatient()` twice in succession with same input → second call returns same IDs, `wasNewlyCreated` all false.
6. Healthie webhook H (`/api/webhooks/healthie/patient-created`) — when a Healthie patient is created with no GHL contact, the webhook causes a GHL contact to also be created (closes the orphan-Healthie-patient gap).
7. CEO widget shows real source distribution; no rows show `'unknown'` among new entries since deploy.
8. `agent_action_log` shows one entry per `enterPatient()` call with full audit detail (caller, dedup matches, what was created vs. linked).

---

### Risk + rollback

**Risks:**
- Refactoring 12 entry points touches a lot of code. Bugs ripple.
- Dedup-against-GHL adds an API call per create — small latency cost (~200-400ms).
- Healthie + GHL rate limits could become an issue under high lead volume; orchestrator has retry-with-backoff but bursts could throttle.

**Mitigations:**
- Ship the orchestrator + migration FIRST with NO entry-path migrations. Verify the function works end-to-end via a manual test endpoint. THEN migrate one entry path at a time, in low-risk order: V (batch import) → K (dashboard manual) → J (iPad kiosk) → A (ABXTac, since it's the most complete reference) → H (Healthie webhook) → C/D/E/F/G (GHL paths, last because GHL changes are highest blast radius).
- Per-path migration is feature-flagged — `PATIENT_ENTRY_USE_ORCHESTRATOR_FOR_PATH_X = true|false` in env. Flip back on regression.
- Healthie/GHL API calls wrapped in a small in-memory rate limiter; 429s retry with backoff.

**Rollback plan:**
- Each per-path migration is a single PR; revert PR if regression observed.
- Database migration is additive only (new columns, new enum) — no destructive change to existing data. Rolling back the application code leaves columns harmless.

---

### Phasing within Phase 6.5

Even Phase 6.5 itself is split into sub-phases for safety:

| Sub-phase | Scope | Days |
|---|---|---|
| 6.5.0 | Migration + `lib/patient-entry.ts` skeleton + tests | 1-2 |
| 6.5.1 | Migrate path V (batch import) — lowest risk | 1 |
| 6.5.2 | Migrate path K (dashboard manual) — already partly correct | 1 |
| 6.5.3 | Migrate path J (iPad kiosk) | 1 |
| 6.5.4 | Migrate path A (ABXTac) — verify the reference is preserved | 1 |
| 6.5.5 | Migrate path H (Healthie webhook) — closes orphan-Healthie gap | 1-2 |
| 6.5.6 | Add GHL contact-created webhook + migrate paths C/D/E/F/G | 2-3 |
| 6.5.7 | Add CEO widget for source attribution | 1 |
| 6.5.8 | Verify acceptance criteria; document changes in sot-modules | 1 |

Total: ~10–13 days assuming a focused stretch.

---

### Open question for Phil before kickoff

**The GHL-side webhook for "contact created" doesn't exist today.** Options:
- (a) Build a real webhook handler at `/api/webhooks/ghl/contact-created` and configure GHL to call it on every contact create across all 4 sub-accounts. Real-time, but requires GHL UI configuration in 4 places.
- (b) Run a 5-minute reconciliation cron that polls GHL `searchContacts(createdAt > lastRun)` and runs orphans through the orchestrator. Slower (up to 5-min lag) but no GHL UI config.

Recommendation: **(b) first** — gets the gap closed without depending on GHL config. Layer (a) on top later if real-time matters.

---

## Phase 7 — Lead Source Automation (Stage 1) — DETAILED SPEC

**One-line goal:** every patient gets a verified, structured `lead_source` attached at first system touch and carried forward into every downstream system (Dashboard → Healthie tag → CEO reports), so marketing spend can be attributed to revenue without manual staff intervention.

### Why this phase exists

From Phil's 2026-04-24 answer to flow-map question 1: "Does not reliably tag, staff manually converts into healthie tags.. we should automate as much as possible."

Today's lead source data is **broken in 3 ways**:

1. **Capture is inconsistent.** Some GHL forms set a `source` custom field, some don't. Facebook ads use UTM params that may or may not get parsed. Direct phone leads have no source field at all. The Manual Apr-2026 entry-point audit (sot-modules/27 §Entry Point Catalog) found 25+ entry paths and only ~3 have a defined source-tagging mechanism.
2. **Propagation is manual.** When a GHL contact converts to a Healthie patient, staff manually picks a Healthie tag from a dropdown. They forget, pick wrong, or skip it because the dropdown is too long.
3. **No unified attribution.** CEO can't answer "how many active patients came from Facebook ads in 2026 Q1?" without exporting CSVs from 3 systems and joining them in a spreadsheet.

Without Phase 7:
- Marketing decisions made on gut feel, not data
- Refer-a-friend program can't measure itself
- Ad-spend ROI is opaque
- The "leads by source" CEO widget either shows wrong data or stays empty

Phase 7 makes lead source a first-class field with a single source of truth (`patients.lead_source` in the dashboard DB) that propagates from capture → booking → Healthie → reporting.

---

### Architectural design

#### The lead_source taxonomy (locked enum)

```typescript
// lib/lead-source.ts
export const LEAD_SOURCES = {
  // Paid acquisition
  facebook_ad:    { label: 'Facebook Ad',      category: 'paid', healthie_tag_id: '<id>' },
  instagram_ad:   { label: 'Instagram Ad',     category: 'paid', healthie_tag_id: '<id>' },
  google_ad:      { label: 'Google Ad',        category: 'paid', healthie_tag_id: '<id>' },
  google_organic: { label: 'Google Organic',   category: 'organic', healthie_tag_id: '<id>' },
  // Owned channels
  website_form:   { label: 'Website Form',     category: 'organic', healthie_tag_id: '<id>' },
  abxtac_web:     { label: 'ABXTac Website',   category: 'organic', healthie_tag_id: '<id>' },
  ypb_web:        { label: 'YPB Website',      category: 'organic', healthie_tag_id: '<id>' },
  // Word of mouth
  patient_referral:    { label: 'Patient Referral', category: 'referral', healthie_tag_id: '<id>' },
  provider_referral:   { label: 'Provider Referral', category: 'referral', healthie_tag_id: '<id>' },
  staff_recommendation: { label: 'Staff Rec',  category: 'referral', healthie_tag_id: '<id>' },
  // Direct
  walk_in:        { label: 'Walk In',          category: 'direct', healthie_tag_id: '<id>' },
  phone_inbound:  { label: 'Phone Inbound',    category: 'direct', healthie_tag_id: '<id>' },
  email_inbound:  { label: 'Email Inbound',    category: 'direct', healthie_tag_id: '<id>' },
  // Internal
  staff_manual:   { label: 'Staff Created',    category: 'internal', healthie_tag_id: null },
  // Unknown
  unknown:        { label: 'Unknown',          category: 'unknown', healthie_tag_id: null },
} as const;
```

The taxonomy is **flat** (no hierarchy) and **finite**. Every entry path maps to exactly one source. New sources require code changes — no free-text → no drift.

The mapping from source enum → Healthie tag ID lives in this same file, so adding a new source means: (a) add to enum, (b) create matching Healthie tag in UI, (c) wire the tag ID. One PR, three steps.

#### Capture: per-entry-path source attribution

From the entry-point audit (27 §Entry Point Catalog), each path gets a default source:

| Entry path | Default source | Override mechanism |
|---|---|---|
| ABXTac website (`/api/abxtac/book`) | `abxtac_web` | UTM param: `?utm_source=facebook_ad` |
| YPB website | `ypb_web` | UTM param |
| GHL form (Facebook) | `facebook_ad` | UTM param fallback: `instagram_ad`, `google_ad` |
| GHL form (Google) | `google_ad` | UTM param |
| GHL form (organic web) | `website_form` | UTM param |
| Healthie public booking | `website_form` | UTM param via referrer |
| iPad walk-in capture | `walk_in` | Staff override dropdown |
| Phone (staff-created) | `phone_inbound` | Staff override dropdown |
| Dashboard manual create | `staff_manual` | Required field with referral sub-source |
| Healthie staff-created | `staff_manual` | Detected via auto-classification |
| Refund/return/transfer (existing patient) | (preserves prior `lead_source`) | NEVER overwrites |

Each entry-point handler sets `patients.lead_source` at the moment of `INSERT`. This is the **one place** lead_source can be set. Subsequent updates require explicit `lead_source_override` action with audit log.

#### UTM parsing

For web forms, lead source captures from URL params at form load time:

```typescript
// lib/utm-parser.ts
interface UtmContext {
  utm_source?: string;       // 'facebook' | 'google' | 'instagram' | 'newsletter'
  utm_medium?: string;       // 'cpc' | 'organic' | 'email' | 'referral'
  utm_campaign?: string;     // free-text campaign name
  utm_content?: string;      // free-text ad variant
  utm_term?: string;         // search keyword
  referrer?: string;         // document.referrer
}

export function utmToLeadSource(ctx: UtmContext): LeadSource {
  if (ctx.utm_source === 'facebook') return 'facebook_ad';
  if (ctx.utm_source === 'instagram') return 'instagram_ad';
  if (ctx.utm_source === 'google' && ctx.utm_medium === 'cpc') return 'google_ad';
  if (ctx.utm_source === 'google') return 'google_organic';
  if (ctx.referrer?.includes('google.')) return 'google_organic';
  // ... rules continue
  return 'website_form';  // default for unattributed web traffic
}
```

UTM context is captured at form load (front-end), passed to the booking handler, and resolved server-side. `utm_campaign` + `utm_content` are stored separately in `patients.lead_attribution` JSONB so the marketing team can drill down without bloating the enum.

#### Propagation: GHL → Dashboard → Healthie

```
[Web form load]
    ↓ UTM params captured to localStorage
[Form submit] → POST to dashboard
    ↓ utmToLeadSource() resolves
[patients INSERT] with lead_source set
    ↓
[GHL contact create] via Phase 6 sendCreate(...) — lead_source synced as GHL custom field
    ↓
[Healthie patient create] — Phase 6.5 unified entry handler picks the matching tag from LEAD_SOURCES.<source>.healthie_tag_id
    ↓ tag applied via Healthie API
[Dashboard CEO widget] queries patients.lead_source for reporting
```

Phase 6.5 (Unified Entry Handler) handles the actual cross-system writes; Phase 7 supplies the resolution logic and taxonomy.

#### Manual override flow

When staff knows the wrong source was captured (e.g., patient told them "I saw your Instagram ad" but they came in as `unknown`), the dashboard has an override action:

```
Patient profile → Lead Source dropdown → [Override...]
  → Modal: "What did the patient tell you?"
  → Dropdown of LEAD_SOURCES
  → Required: Reason (free text)
  → Save
```

Logged to `lead_source_audit` table. Old + new value + timestamp + user + reason. Healthie tag is updated to match.

#### CEO widget — leads by source

```
LEADS THIS MONTH                  Last 30 days
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total:                                     127

PAID
  Facebook Ad         42  ($X CAC)
  Instagram Ad        18  ($X CAC)
  Google Ad           24  ($X CAC)

ORGANIC
  Google Organic      11
  Website Form         8
  ABXTac Web           6

REFERRAL
  Patient Referral    11   ★ trending
  Provider Referral    3
  Staff Rec            2

DIRECT
  Walk In              1
  Phone Inbound        1
  Unknown              0

[ View Full Attribution Report → ]
```

The "trending" star surfaces when a category's MoM growth >25%. Useful signal that referral programs are working without scrolling through a dashboard.

#### Conversion attribution (Phase 7.5 / future)

A future extension (not part of Phase 7's initial scope) computes lead → active conversion rate per source:

```
Source            Leads (30d)   → Active (90d)   Conv%   $/active
Facebook Ad         42 → 14    33%   $X CAC ÷ 14 = $Y per active
Patient Referral    11 →  9    82%   $0 CAC
```

Phase 7 lays the data foundation. Phase 7.5 (a TBD module) adds the conversion math.

---

### Database schema changes

```sql
-- migrations/2026XXXX_lead_source.sql

-- Lead source enum + override audit
ALTER TABLE patients
  ADD COLUMN lead_source TEXT
    CHECK (lead_source IN (
      'facebook_ad', 'instagram_ad', 'google_ad', 'google_organic',
      'website_form', 'abxtac_web', 'ypb_web',
      'patient_referral', 'provider_referral', 'staff_recommendation',
      'walk_in', 'phone_inbound', 'email_inbound',
      'staff_manual', 'unknown'
    ))
    DEFAULT 'unknown',
  ADD COLUMN lead_source_set_at TIMESTAMPTZ,
  ADD COLUMN lead_attribution JSONB;  -- {utm_campaign, utm_content, utm_term, referrer, raw_query}

CREATE INDEX idx_patients_lead_source ON patients(lead_source) WHERE lead_source != 'unknown';

CREATE TABLE lead_source_audit (
  id BIGSERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(patient_id),
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  changed_by INTEGER REFERENCES users(user_id),
  source TEXT  -- 'utm_capture' | 'staff_override' | 'auto_classification'
);
CREATE INDEX idx_lead_source_audit_patient ON lead_source_audit(patient_id, changed_at DESC);
```

Existing `patients.lead_source` may already exist as TEXT; migration uses `IF NOT EXISTS` and adds the CHECK constraint after a one-time backfill that maps any legacy values to the new enum (or 'unknown').

---

### Per-path code changes

| File | Change |
|---|---|
| `migrations/2026XXXX_lead_source.sql` | NEW |
| `lib/lead-source.ts` | NEW — taxonomy + Healthie tag mapping |
| `lib/utm-parser.ts` | NEW — UTM → lead_source resolver |
| `lib/lead-source-audit.ts` | NEW — write to audit table |
| `app/api/abxtac/book/route.ts` | MODIFY — accept UTM payload, set lead_source |
| `app/api/booking/route.ts` (any web booking handler) | MODIFY — same |
| `app/api/patients/route.ts` (POST staff create) | MODIFY — required `lead_source` field with referral sub-source |
| `app/api/webhooks/ghl/contact-created/route.ts` | NEW or MODIFY — pull GHL custom field `source` and persist |
| `app/api/patients/[patientId]/lead-source/route.ts` | NEW — staff override endpoint, writes audit |
| `components/patient/LeadSourceOverrideModal.tsx` | NEW |
| `lib/patient-entry.ts` (Phase 6.5) | MODIFY — apply Healthie tag from `LEAD_SOURCES.<source>.healthie_tag_id` |
| `public/{ipad,mobile}/web-forms/*` | MODIFY — capture UTM params at form load, pass to booking call |
| `app/(dashboard)/marketing/leads-by-source/page.tsx` | NEW — full attribution report |
| `public/ipad/app.js` | MODIFY — add CEO widget; map lead-source counts in `dashboardData` per the dashboard mapping pin |
| `scripts/lead-source/backfill-from-ghl.ts` | NEW — one-time: pull GHL contact `source` field and apply to existing patients where `lead_source='unknown'` |
| `docs/sot-modules/27-patient-flow-map.md` | UPDATE — Stage 1 KNOWN GAP block resolved with reference to Phase 7 |
| `docs/sot-modules/23-ghl-ai-agents.md` | UPDATE — note GHL contact custom field `source` is now part of the contract |

---

### Won't-touch guarantees

- **Will NOT modify existing `patients.lead_source` if already set to a non-default value.** Backfill only touches `lead_source='unknown'` rows.
- **Will NOT change GHL contact records retroactively** for already-converted leads. Only new contacts get the unified contract.
- **Will NOT remove or rename existing Healthie tags.** New tags created if missing; existing ones reused if matching.
- **Will NOT block booking on lead_source missing.** A failed UTM parse defaults to `unknown` rather than throwing.
- **Will NOT auto-flip a patient's source from one value to another.** Source is set once at patient INSERT; subsequent changes are explicit staff actions logged to audit.
- **Will NOT use lead_source for clinical decisions.** Marketing data only. Clinical workflows stay separated.
- **Will NOT expose patient-identifiable info in the CEO widget.** Counts and aggregates only.

---

### Acceptance criteria

1. **All entry paths set lead_source.** Every entry-path test (one per row in 27 §Entry Point Catalog) creates a patient with a non-`unknown` lead_source.
2. **UTM round-trip works.** Load `/abxtac?utm_source=facebook&utm_medium=cpc&utm_campaign=test` → book → patients row has `lead_source='facebook_ad'` and `lead_attribution.utm_campaign='test'`.
3. **GHL → Dashboard sync.** A test contact created in GHL with `source=patient_referral` custom field, then graduated to a patient → dashboard shows `lead_source='patient_referral'`.
4. **Healthie tag applied.** Same test patient → Healthie record has the Patient Referral tag attached.
5. **Staff override flow.** Override a patient from `unknown` → `instagram_ad` with reason → audit row written, Healthie tag updated.
6. **CEO widget accuracy.** Widget count matches `SELECT lead_source, COUNT(*) FROM patients WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY 1`.
7. **Backfill safe.** Run backfill on staging with a dry-run flag → produces a CSV showing what would change. Run apply → only `unknown` rows updated. Audit shows source=`backfill`.
8. **Conversion-ready data.** A 30-day query joining patients.lead_source × patients.status_key produces sensible cohort numbers.
9. **Trending detection.** Synthetic month-over-month uptick in patient_referral → CEO widget shows the trending star.
10. **Privacy preserved.** No patient PII appears in widgets or admin views; only counts.

---

### Risk + rollback

**Risks:**
- Existing legacy `lead_source` values (free-text from earlier hand-coding) get coerced to `unknown` by the new CHECK constraint. **Mitigation:** Pre-migration audit query produces a value distribution; legacy values get a one-time mapping pass before the CHECK is added.
- UTM params get stripped by intermediate redirects (e.g., GHL forms that re-redirect to a dashboard endpoint). **Mitigation:** UTM context is captured to localStorage on first page load AND passed via hidden form fields, so even if URL params are stripped, the data survives.
- Staff override modal is bypassed (forgotten) → conversion attribution stays inaccurate. **Mitigation:** Required field on staff-create form; weekly recon email surfaces patients with `lead_source='unknown'` >30 days post-create as actionable items.
- Healthie tags out of sync with dashboard enum → tag updates fail silently. **Mitigation:** Phase 7 includes a `scripts/lead-source/verify-tags.ts` that compares the enum's tag IDs against live Healthie tag list, alerts on drift.
- Marketing team starts treating `lead_source` as ground truth before backfill is complete → wrong attribution reports. **Mitigation:** CEO widget shows "Backfill: X% complete" until all unknowns are resolved.

**Rollback plan:**
- Disable UTM parser → entry handlers default to per-path source (still better than `unknown`).
- Revert CEO widget; data still in DB.
- Schema additions are additive (new columns, new audit table, new check constraint with `unknown` default).
- Healthie tags created by Phase 7 stay in Healthie; safe to leave or remove via UI.

---

### Sub-phases within Phase 7

| Sub-phase | Scope | Days |
|---|---|---|
| 7.0 | Schema migration + backfill audit | 0.5 |
| 7.1 | `lib/lead-source.ts` taxonomy + Healthie tag mapping (requires Healthie tag IDs) | 1 |
| 7.2 | `lib/utm-parser.ts` + UTM capture on web forms | 1 |
| 7.3 | Modify all entry handlers (ABXTac, booking, staff-create, etc.) | 2 |
| 7.4 | GHL contact webhook + `source` custom field sync | 1 |
| 7.5 | Phase 6.5 integration: Healthie tag application | 0.5 |
| 7.6 | Staff override UI + audit | 1 |
| 7.7 | Backfill script + dry-run | 0.5 |
| 7.8 | CEO widget + full attribution report page | 1.5 |
| 7.9 | Documentation + verify-tags script | 0.5 |

Active engineering: ~9 days. Wall-clock: ~12 days (UTM end-to-end testing across all entry paths is calendar-heavy).

---

### Open questions for Phil before kickoff

1. **Healthie tag IDs.** Need the existing Healthie tag IDs for each source category (or approval to create them). Some likely already exist (per `reference_healthie_tags_vs_groups.md`). I'll prepare a draft tag list; you approve/adjust.
2. **GHL custom field name.** The new contract is GHL contact has a `source` custom field with the dashboard enum. Confirm the field name (or add it if missing).
3. **Referral sub-source.** Patient referrals — do we capture the referring patient's ID (so we can show "X has referred 3 patients")? Adds a `referred_by_patient_id` column. Worth it?
4. **Marketing UTM convention.** Does the marketing team have a documented UTM naming convention (e.g., `utm_campaign=2026Q1_TRT_funnel_v3`)? If so, we map to it; if not, we lock one as part of Phase 7.
5. **Backfill scope.** Backfill applies to which historical patients? All? Last 12 months? Members only? Recommend: members only, last 12 months — that's the cohort marketing actually uses.
6. **CEO widget detail level.** Does the iPad CEO tab need both counts and CAC ($)? CAC requires marketing-spend integration (separate data source — likely Sheets or manual input). Worth deferring CAC to Phase 7.5?
7. **Staff override RBAC.** Should override be admin-only or any staff? Risk of mis-overrides is low (auditable), but consistency matters.

---

## Phase 8 — At-Risk Cron + Thresholds (Stage 7) — DETAILED SPEC

**One-line goal:** identify every active patient who is drifting toward off-service (lab overdue, follow-up overdue, payment paused, missed visit) BEFORE they churn — surface them on a CEO/staff dashboard with reasons + days-overdue + suggested action, and automate patient-actionable nudges via Phase 6 receivers.

### Why this phase exists

Stage 7 of the patient flow map (`27 §Stages`) is "At-risk" — the window between active membership and off-service. Today this stage is **invisible**:

- No automated check tells staff "Patient X hasn't had labs in 9 months" until a provider notices at the next visit.
- No automated check tells staff "Patient Y's recurring payment failed 3 times in a row."
- The "no inactive cancel-check" gap (Stage 8 GAP from Phil's flow-map answer 4) compounds: nobody catches the slow drift to inactive either.
- Patients churn quietly; revenue evaporates; clinical follow-through is patchy.

Without Phase 8:
- Churn is reactive (patient stops responding), not proactive (system flags before churn).
- CEO has no leading indicator of revenue health.
- Re-engagement campaigns happen by gut feel, not data.
- "At-risk" is a stage that exists conceptually but is not represented anywhere in code or DB.

Phase 8 makes Stage 7 a tracked, queryable, actionable cohort with measurable outcomes (resolved vs. churned).

**Note on blocker.** Phase 8 is the **last phase to ship** because it depends on clinical threshold values that only Phil + providers can set (e.g., "TRT labs overdue at 6 months? 9? 12?"). The engineering work is straightforward; the gating question is clinical policy.

---

### Architectural design

#### The risk taxonomy

Each "risk" is a typed, named, schemaful condition. The system supports ~10 risk types at launch:

| Risk type | Description | Patient-actionable? | Default threshold |
|---|---|---|---|
| `lab_overdue` | Last completed lab > N months ago | Yes (book lab) | 6mo TRT, 12mo PC |
| `followup_overdue` | Last visit > N months ago | Yes (book visit) | 6mo TRT, 12mo PC |
| `recurring_payment_failed` | Healthie recurring failed >= 1 time recently | Yes (update card) | 1 failure |
| `recurring_payment_paused` | Healthie recurring suspended | Yes | immediate |
| `missed_appointment` | No-show in last 30 days, not rescheduled | Yes | 1 no-show |
| `consent_expired` | Annual consent form > 12mo old | Yes (re-sign) | 12mo |
| `unfilled_rx` | Prescription not picked up after N days | Yes (pickup reminder) | 14d |
| `legacy_billing_stalled` | Migration tracker stuck >30d (Phase 5 link_expired) | No (staff action) | 30d |
| `inactive_payment_active` | Patient marked inactive but still has active recurring (Phase 1 only flags) | No | immediate |
| `provider_followup_required` | Manual provider flag (e.g., "see in 3 months") | No | provider-set |

Each type has:
- A detection function (pure: takes patient + Healthie data, returns `{ flagged: boolean, severity, daysOverdue, reason }`)
- A threshold (configurable per care line)
- A patient-actionable flag (governs whether the system can send a nudge or only a staff task)
- A suggested action (text shown to staff, also feeds into the nudge template)
- A resolution detector (function that auto-clears the flag when the underlying condition is fixed)

#### Threshold configuration per care line

```typescript
// lib/risk-thresholds.ts
export const RISK_THRESHOLDS: Record<CareLine, RiskConfig> = {
  trt: {
    lab_overdue: { months: 6, severity: 'high' },
    followup_overdue: { months: 6, severity: 'medium' },
    consent_expired: { months: 12, severity: 'medium' },
    // ...
  },
  glp1: {
    lab_overdue: { months: 3, severity: 'high' },
    followup_overdue: { months: 3, severity: 'high' },
    // ...
  },
  primary_care: {
    lab_overdue: { months: 12, severity: 'medium' },
    followup_overdue: { months: 12, severity: 'low' },
    // ...
  },
  abxtac: { ... },
  longevity: { ... },
};
```

Care line is derived from `patients.healthie_groups` per `reference_healthie_tags_vs_groups.md`. The 6 care-line group IDs in that pin map to the keys of `RISK_THRESHOLDS`.

#### Detection cron design

`/api/cron/at-risk-scan/route.ts` runs daily at ~4am Mountain (after the morning-prep cron seeds the day):

```typescript
// Pseudocode
async function runAtRiskScan({ dryRun }: { dryRun: boolean }) {
  const patients = await getActivePatients();  // status_key IN ('active', 'active_pending')

  for (const p of patients) {
    const careLine = deriveCareLine(p);
    const thresholds = RISK_THRESHOLDS[careLine];
    const newFlags: RiskFlag[] = [];

    for (const riskType of Object.keys(thresholds)) {
      const detector = RISK_DETECTORS[riskType];
      const result = await detector(p, thresholds[riskType]);
      if (result.flagged) {
        newFlags.push({
          type: riskType,
          severity: result.severity,
          daysOverdue: result.daysOverdue,
          reason: result.reason,
          detected_at: NOW(),
        });
      }
    }

    const oldFlags = p.risk_flags ?? [];
    const diff = computeDiff(oldFlags, newFlags);

    if (!dryRun) {
      await persistFlags(p, newFlags, diff);
      await maybeSendNudges(p, diff.added);
      await logResolutions(p, diff.resolved);
    }
  }
}
```

Output:
- For each patient: net flag list persisted to `patients.risk_flags` JSON
- For each new flag: optional nudge via Phase 6 receivers (rate-limited per patient)
- For each resolved flag: log entry showing how it was resolved
- Summary: counts by risk type, by care line, by severity

Dry-run mode produces a CSV report Phil reviews before any flag is persisted.

#### Risk-flag schema

```typescript
interface RiskFlag {
  type: RiskType;              // 'lab_overdue' | etc
  severity: 'low' | 'medium' | 'high' | 'critical';
  daysOverdue: number;
  reason: string;              // human-readable: "Last lab 247 days ago (threshold: 180)"
  detected_at: string;         // ISO
  last_nudge_sent_at?: string; // ISO; null if not yet nudged
  nudge_count: number;         // how many times we've nudged
  suppressed_until?: string;   // staff can mute a flag temporarily
  notes?: string;              // staff annotation
}

// patients.risk_flags is JSONB array of RiskFlag
```

#### Resolution detection

Resolution is detected on the next scan: if a flag was present and the underlying condition no longer holds, the flag is removed and a row is written to `risk_resolution_log`:

```sql
CREATE TABLE risk_resolution_log (
  id BIGSERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(patient_id),
  risk_type TEXT NOT NULL,
  flagged_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ DEFAULT NOW(),
  resolution_kind TEXT,       -- 'condition_met' | 'staff_dismissed' | 'patient_offservice'
  resolution_detail JSONB
);
```

This gives the CEO a measurable outcome: "X% of flagged at-risk patients resolved within 30 days." If a flag doesn't resolve and the patient eventually goes off-service, that's logged too.

#### Nudge governance (rate-limited, dedup-aware)

Patient-actionable risks → automated Phase 6 nudges, but with brakes:

1. **Per-patient rate limit:** max 1 risk-related nudge per 7 days (any type). Prevents nudge bombardment.
2. **Per-flag dedup:** same flag type → max 3 nudges total over the lifetime of the flag, escalating in tone (gentle → firm → escalates to staff task).
3. **Suppression flags respected:** `patients.no_clinical_outreach` (existing) blocks all automated outreach.
4. **Patient communication preferences:** if patient has opted out of marketing/announcements (per `project_push_notifications_marketing_split.md`), at-risk nudges still go out (these are operational, not marketing) but the rate limit tightens to 1 per 30 days.
5. **Phil approval for nudge templates:** Phase 8 ships with a draft template per risk type; nothing sends until Phil approves the templates.

The 3rd nudge → instead of patient SMS, creates a **staff task** in GHL (via Phase 6 createTask) so a human takes over.

#### Staff dashboard widget

URL: `/at-risk` (full view) + iPad CEO widget (summary).

```
AT-RISK PATIENTS                    Last refreshed 4:02 AM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
By severity
  🔴 Critical    3
  🟠 High       18
  🟡 Medium     34
  🟢 Low        12

By type
  Lab Overdue           23
  Followup Overdue      14
  Payment Failed         5
  Consent Expired        9

Top patients (sorted: severity × $monthly DESC)
  Patient name           Type            Days   Action       [view]
  Schafer, Phil          Lab Overdue     247    Send SMS     [→]
  ...

[ Filters ] [ Resolution rate this month ]
```

Filter chips: severity, type, care line, brand, $ bucket, days-overdue range.

Click row → modal:
- Patient summary
- All active flags
- Resolution history
- Nudge log (last N sent, when, response)
- Manual actions: send nudge, create staff task, suppress flag, add note

#### CEO widget on iPad Today

```
AT-RISK ALERT
━━━━━━━━━━━━━━
🔴 3 critical risks need provider action TODAY
🟠 18 high-severity, $X monthly

Top 3 by value:
  Patient A — Lab overdue 8mo — $250/mo
  Patient B — Payment failed — $180/mo
  Patient C — Consent expired — $89/mo

[ View All At-Risk → ]
```

Counts pulled into `loadDashboard()` per the dashboard mapping pin.

---

### Database schema changes

```sql
-- migrations/2026XXXX_at_risk.sql

ALTER TABLE patients
  ADD COLUMN risk_flags JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN risk_flags_updated_at TIMESTAMPTZ;

CREATE INDEX idx_patients_risk_flags_gin ON patients USING gin(risk_flags);
CREATE INDEX idx_patients_has_risks ON patients((jsonb_array_length(risk_flags) > 0))
  WHERE jsonb_array_length(risk_flags) > 0;

CREATE TABLE risk_resolution_log (
  id BIGSERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(patient_id),
  risk_type TEXT NOT NULL,
  flagged_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ DEFAULT NOW(),
  resolution_kind TEXT NOT NULL,
  resolution_detail JSONB
);
CREATE INDEX idx_risk_resolution_patient ON risk_resolution_log(patient_id, resolved_at DESC);

CREATE TABLE risk_nudge_log (
  id BIGSERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(patient_id),
  risk_type TEXT NOT NULL,
  nudge_kind TEXT NOT NULL,        -- 'sms' | 'email' | 'staff_task'
  ghl_send_log_id BIGINT REFERENCES ghl_send_log(id),  -- if patient-facing
  staff_task_id TEXT,              -- if staff_task
  nudge_template_id TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  attempt_number INTEGER NOT NULL  -- 1, 2, 3 escalation
);
CREATE INDEX idx_risk_nudge_patient ON risk_nudge_log(patient_id, sent_at DESC);
```

`patients.risk_flags` is the live state (current flags). `risk_resolution_log` is the historical record (for outcome metrics). `risk_nudge_log` tracks every nudge attempt.

---

### Per-path code changes

| File | Change |
|---|---|
| `migrations/2026XXXX_at_risk.sql` | NEW |
| `lib/risk-thresholds.ts` | NEW — care-line × risk-type config, populated by Phil's clinical input |
| `lib/risk-detectors/<type>.ts` | NEW — one file per risk type with the detection function |
| `lib/risk-detectors/index.ts` | NEW — registry of all detectors |
| `lib/risk-resolution.ts` | NEW — resolution detection + log writes |
| `lib/risk-nudge.ts` | NEW — rate-limited nudge dispatcher (uses Phase 6 helpers) |
| `lib/risk-nudge-templates/<type>.ts` | NEW — template per risk type, Phil-approved |
| `app/api/cron/at-risk-scan/route.ts` | NEW — daily 4am cron |
| `app/api/at-risk/list/route.ts` | NEW — list endpoint, filter/sort |
| `app/api/at-risk/[patientId]/dismiss/route.ts` | NEW — staff dismiss flag |
| `app/api/at-risk/[patientId]/suppress/route.ts` | NEW — staff suppress for N days |
| `app/api/at-risk/[patientId]/manual-nudge/route.ts` | NEW — staff-triggered nudge |
| `app/at-risk/page.tsx` | NEW — full dashboard view |
| `components/at-risk/AtRiskTable.tsx` | NEW |
| `components/at-risk/AtRiskDetailModal.tsx` | NEW |
| `public/ipad/app.js` | MODIFY — CEO widget + dashboard mapping for at-risk counts |
| `crontab` | UPDATE — add daily at-risk-scan at 4:00am Mountain |
| `scripts/at-risk/dry-run-report.ts` | NEW — produces CSV for Phil review |
| `scripts/at-risk/calibrate-thresholds.ts` | NEW — Phil-runnable: tries N threshold combinations and reports cohort sizes |
| `docs/sot-modules/27-patient-flow-map.md` | UPDATE — Stage 7 detail references Phase 8 |
| `docs/sot-modules/[new]-at-risk-system.md` | NEW — module documenting risk types, thresholds, nudge templates, resolution metrics |

---

### Won't-touch guarantees

- **Will NOT auto-flip anyone to inactive.** Per Phase 1's hard rule (`feedback_critical_rules.md`).
- **Will NOT auto-cancel any service.** Service cancellation is staff-only.
- **Will NOT modify clinical records** (lab orders, prescriptions, visit history). Read-only against Healthie.
- **Will NOT send patient nudges before Phil approves the templates.** Templates ship as drafts; sending requires explicit per-template approval.
- **Will NOT exceed nudge rate limits.** Hard caps in code, additionally a dashboard kill-switch (`AT_RISK_NUDGES_ENABLED`).
- **Will NOT flag patients where `no_clinical_outreach=true`.** Suppression respected.
- **Will NOT run before Phase 1 (Inactive Safety) is live.** Inactive-classified patients should never enter the active scan; dependency is hard.
- **Will NOT use marketing-channel logic.** At-risk is operational, not promotional.

---

### Acceptance criteria

1. **Detection accuracy.** Synthetic test cases per risk type — each detector returns the expected flag for known overdue / known on-time patients. 100% pass on test fixtures.
2. **Threshold configurability.** Changing a value in `RISK_THRESHOLDS` and re-running the scan produces the expected cohort size delta.
3. **Phil dry-run review.** Pre-production dry-run produces a CSV. Phil reviews 30 sample flagged patients; confirms ≥ 90% are reasonable flags (no false positives that look insane).
4. **Resolution tracking works.** A patient flagged for `lab_overdue`, then completes a lab → next scan removes the flag, writes to `risk_resolution_log` with `resolution_kind='condition_met'`.
5. **Nudge rate limit holds.** Synthetic patient with 5 active risks → max 1 nudge per 7 days, max 3 nudges per flag type. Logs match.
6. **Staff dashboard usable.** Phil + 1 staff member work through the at-risk view for ~30 minutes. No crashes, sort/filter work, modal actions persist.
7. **CEO widget accuracy.** Widget counts match underlying query exactly.
8. **Phase 1 dependency holds.** Patients with `status_key='inactive'` are NEVER scanned (verified via test).
9. **Phil-approved templates.** Each risk type has at least one Phil-approved nudge template before sending is enabled.
10. **Resolution rate metric.** After 30 days post-launch: a query computes "flagged → resolved within 30d" and the number is non-zero (i.e., the system actually drives action).
11. **Kill-switch verified.** Setting `AT_RISK_NUDGES_ENABLED=false` immediately stops all nudges; flags continue to populate.

---

### Risk + rollback

**Risks:**
- Threshold misconfiguration → 60% of patients flagged → noise floods the dashboard, signal lost. **Mitigation:** Dry-run before any apply. Phase 8.0 produces a sensitivity analysis (cohort size at thresholds X, X+1mo, X+2mo) for Phil to choose from.
- False positive nudge → patient gets "you're overdue" SMS when they're actually fine (e.g., lab data not yet synced from Healthie). **Mitigation:** Detection always re-checks Healthie at nudge time, not just at scan time. Stale-data guard.
- Real positives ignored → patient genuinely overdue but no follow-through → continues to drift. **Mitigation:** 3rd-attempt escalates to staff task, not silent drop.
- Risk taxonomy gets bloated over time → 50 risk types, each with their own detector → maintenance burden. **Mitigation:** Locked to ~10 types at launch. Adding a new type requires a code review explicitly justifying it.
- Provider override missing → patient legitimately exempt (e.g., "Patient X doesn't need labs, see chart note") gets repeatedly flagged. **Mitigation:** `patients.risk_overrides` JSONB lets staff exempt specific risk types per patient with reason + expiration.
- Healthie data lag → flags fire on stale data. **Mitigation:** Phase 8 cron requires Healthie sync to have completed within last 12 hours; aborts otherwise.

**Rollback plan:**
- Set `AT_RISK_SCAN_ENABLED=false` → cron exits early.
- Disable widget via feature flag.
- `risk_flags` data preserved; safe to leave.
- Nudge log preserved.
- If nudges went wrong: `AT_RISK_NUDGES_ENABLED=false` → flags continue, no patient comm.

---

### Sub-phases within Phase 8

| Sub-phase | Scope | Days | Blocker? |
|---|---|---|---|
| 8.0 | Threshold sensitivity analysis (Phil + providers) → locked threshold values | 2 (clinical mtg + analysis) | YES — clinical input |
| 8.1 | Schema + thresholds config + risk taxonomy locked | 1 | |
| 8.2 | Risk detectors (one per type) | 3 | |
| 8.3 | Resolution detection + log writes | 1 | |
| 8.4 | Nudge dispatcher + rate limits + Phil-approved templates | 2 | YES — template approval |
| 8.5 | Cron + dry-run mode + sensitivity report | 1 | |
| 8.6 | Staff dashboard + CEO widget | 2.5 | |
| 8.7 | Phil dry-run review session | 0.5 | YES — Phil time |
| 8.8 | Production rollout (flags-only first, nudges 2 weeks later) | 0.5 | |
| 8.9 | 30-day resolution-rate report + tuning pass | 1 | |

Active engineering: ~12 days. Wall-clock: 21+ days due to clinical-input + template-review + 2-week flags-only soak before nudges enable.

---

### Open questions for Phil before kickoff

1. **Threshold values per care line.** This is the gating question. For each care line × risk type, what's the threshold? Recommend a 1-hour clinical meeting with Phil + Dr. Whitten (TRT/PC) + the GLP-1 prescriber to lock these. Output: a filled-in `RISK_THRESHOLDS` table.
2. **Risk type list completeness.** The 10 proposed risk types — anything missing? (e.g., "BMI not improving on GLP-1 after 90 days"? That would be a clinical KPI risk, narrower scope.)
3. **Care-line derivation.** I'll derive care line from `patients.healthie_groups`. Confirm that's the right signal vs. `patients.brand` or `patients.products_subscribed`.
4. **Nudge template approval flow.** I'll draft 1 template per risk type (10 total). Best way to review — single doc, individual cards, or via dashboard? Approval can be a 2-pass: first draft → Phil edits → final approval.
5. **Provider follow-up "see in 3 months" flag.** Where does this live today? Healthie chart note? A flag in patient record? Need a structured way to set/store/query this so Phase 8 can read it.
6. **Resolution rate target.** What % of flagged patients should resolve within 30 days for the system to be "working"? Suggest 40-60% as a starting baseline; tune after first 90 days.
7. **Flags-only soak period.** 2 weeks of flagging without nudging proposed before turning on patient comm. Acceptable?
8. **Staff task assignment.** When 3rd nudge escalates to staff task, who's the default assignee? Patient's primary care provider? A queue? Specific staff member?

---

## Phase 9 — Weekly Billing Reconciliation Email — DETAILED SPEC

**One-line goal:** every Monday at 8am, Phil receives one email at admin@granitemountainhealth.com that authoritatively answers "is our billing data correct, and where is it drifting?" — pulling from Healthie (SOT), QBO (sunsetting), Jane (sunsetting), Stripe direct, and the dashboard's classification — and flags every divergence with a per-patient action item.

### Why this phase exists

Per Phil's 2026-04-24 hardening decision (`project_hardening_plan_decisions.md`): "recon email to admin@ only." The motivation is that revenue is currently spread across 4 billing systems, the dashboard's classification is a derived view, and there is no single weekly artifact that says "here is what actually happened, here is what's stuck, here is what's wrong."

Today:
- Phil checks revenue numbers across Healthie + QBO manually
- The dashboard's "active members" count is computed from `recurringPayments(user_id)` (per `feedback_healthie_recurring_query.md`) but there's no automated reconciliation against historical Stripe charges
- The QBO sunset progress (Phase 5) needs a regular pulse to know if it's accelerating or stalling
- Drift between systems compounds silently — a patient whose Healthie recurring failed but QBO is still charging gets double-billed (or worse: fully missed)

Without Phase 9:
- Manual recon happens unevenly; some weeks not at all
- Phase 5 migration tracker shows progress but doesn't catch every drift mode
- A patient billing in two systems can persist for weeks before being noticed
- Phil can't tell if revenue is up or down week-over-week without a manual SQL pass

Phase 9 makes the recon a tracked, persistent, single-artifact pulse that Phil can read in 2 minutes every Monday morning and immediately triage.

---

### Architectural design

#### The recon scope (5 sources of truth)

| Source | What we pull | Authority |
|---|---|---|
| Healthie | Active `recurringPayments(user_id)` per active patient, monthly amount, product | **SOT** for membership |
| QBO | Active recurring invoices per customer, monthly amount, product | Legacy-during-sunset |
| Jane | Active recurring memberships (CSV input from Phase 5 ingestion) | Legacy-during-sunset |
| Stripe Direct | Direct charges in last 7 days NOT routed through Healthie/QBO | Retail / one-time |
| Dashboard | `patients.billing_source` from Phase 3 classification | Derived; verifies cross-system consistency |

#### The 6-section email

```
Subject: GMH Weekly Billing Recon — Mon Apr 28 2026

──────────────────────────────────────────────
1. TOTALS THIS WEEK                  vs last week
──────────────────────────────────────────────
Active recurring revenue (MRR)
  Healthie       $52,840    +$420 (+0.8%)
  QBO Legacy      $6,840    -$540 (-7.3%)   ↓ migration progress
  Jane Legacy     $1,260       $0
  Other Legacy      $540       $0
  ─────────────────────────
  Total MRR     $61,480    -$120 (-0.2%)

Direct retail (last 7d)
  Stripe direct   $3,240    +$890

Pro bono active        12 patients (no revenue)

──────────────────────────────────────────────
2. MIGRATION PROGRESS (Phase 5)
──────────────────────────────────────────────
Migrated to Healthie this week:    5 patients ($1,420 MRR moved)
Stalled at link_sent >14d:          3 patients ⚠
Newly added to legacy cohort:       0
Remaining legacy total:            45 patients ($8,640 MRR)
Projected sunset date:              ~9 weeks at current pace

──────────────────────────────────────────────
3. DRIFT (cross-system mismatches)
──────────────────────────────────────────────
🔴 CRITICAL — Double-billing (charged in 2 systems):    1 patient
   • [Patient ID 4823] — active Healthie + active QBO recurring
     → Action: cancel QBO immediately

🟠 MEDIUM — Inactive but billing:                       2 patients
   (Phase 1 monitor flagged — re-confirming)
   • [Patient ID 5102]
   • [Patient ID 5189]

🟡 LOW — Active but not billing:                        7 patients
   (status_key=active, no active recurring in any system)
   → Likely pro-bono not yet flagged. Review.

🟡 LOW — Healthie recurring without dashboard patient:  0 patients

🟡 LOW — Dashboard active_pending >7 days:              4 patients
   → Phase 4 No Man's Land queue handles. Linked.

──────────────────────────────────────────────
4. AT-RISK PULSE (from Phase 8 if live)
──────────────────────────────────────────────
🔴 Critical risks                3 patients ($X MRR)
🟠 High                          18 patients ($X MRR)
   At-risk MRR exposure: $4,820 (8% of total MRR)

──────────────────────────────────────────────
5. WEEKLY OUTLIERS
──────────────────────────────────────────────
• Largest new active patient     [P 5234] — $250/mo TRT
• Largest cancellation           [P 4821] — $180/mo TRT — reason: moved
• Failed payment retry           [P 5189] — 3rd failure, escalating

──────────────────────────────────────────────
6. ACTION ITEMS
──────────────────────────────────────────────
□ Cancel QBO subscription for Patient 4823 (DOUBLE-BILLED)
□ Review 7 active-not-billing patients — pro-bono?
□ Send migration follow-up to 3 stalled link_sent
□ Review Phase 1 inactive-but-billing flags
```

The email is **plaintext markdown-rendered as HTML**. No attachments. Every patient ID is a hyperlink to the dashboard patient page. The "Action Items" section is the most important — Phil reads this first, the rest is supporting detail.

#### The recon engine (`lib/billing-recon.ts`)

Pure functions, no side effects:

```typescript
export async function computeBillingRecon(asOf: Date): Promise<BillingReconReport> {
  const [healthie, qbo, jane, stripe, dashboard] = await Promise.all([
    fetchHealthieRecurring(),
    fetchQboRecurring(),
    fetchJaneFromLegacyTable(),  // populated by Phase 5 ingestion
    fetchStripeDirectLast7Days(),
    fetchDashboardClassification(),
  ]);

  const totals = computeTotals(healthie, qbo, jane, stripe, dashboard);
  const drift = computeDrift(healthie, qbo, jane, dashboard);
  const migration = computeMigrationProgress(asOf);
  const atRisk = await computeAtRiskSnapshot(asOf);  // if Phase 8 live
  const outliers = computeOutliers(asOf);
  const actions = buildActionItems(drift, migration, atRisk);

  return { totals, drift, migration, atRisk, outliers, actions, asOf };
}
```

Each `fetch*` function returns a normalized shape: `Map<patientId, { source, monthlyAmount, product, status }>`. The `computeDrift` function is the core analytical step — it takes the union of patient IDs across sources and identifies mismatches.

#### Drift detection rules

| Rule | Logic | Severity |
|---|---|---|
| `double_billing` | Patient has active recurring in ≥2 of {Healthie, QBO, Jane} | 🔴 CRITICAL |
| `inactive_but_billing` | `status_key='inactive'` AND active recurring anywhere | 🟠 MEDIUM (Phase 1 dual-flagged) |
| `active_no_billing` | `status_key='active'` AND no active recurring AND `billing_source != 'pro_bono'` | 🟡 LOW |
| `orphan_recurring` | Healthie recurring for a Healthie user without a dashboard patient row | 🟡 LOW |
| `pending_too_long` | `status_key='active_pending'` for >7 days | 🟡 LOW (Phase 4 covers) |
| `failed_payment_streak` | Healthie recurring with ≥3 consecutive failures | 🟠 MEDIUM |
| `bumpy_amount` | Same patient's monthly amount changed by >$50 last 30 days | 🟡 LOW (audit signal) |

Each drift item links to its patient + suggests an action. Existing phases handle most actions; recon flags + counts.

#### Storage: `billing_recon_runs`

Each run persists for trend analysis:

```sql
CREATE TABLE billing_recon_runs (
  id BIGSERIAL PRIMARY KEY,
  run_at TIMESTAMPTZ DEFAULT NOW(),
  as_of_date DATE NOT NULL,
  totals JSONB,              -- {healthie_mrr, qbo_mrr, jane_mrr, stripe_7d, ...}
  drift JSONB,               -- array of drift items
  migration JSONB,
  at_risk JSONB,
  outliers JSONB,
  actions JSONB,
  email_sent_at TIMESTAMPTZ,
  email_recipient TEXT
);
CREATE INDEX idx_billing_recon_as_of ON billing_recon_runs(as_of_date DESC);
```

This lets the dashboard widget show "MRR trend over last 12 weeks" without recomputing each time, and provides an audit trail of what was reported when.

#### Email delivery

The email goes through a **simple transactional sender**, NOT through GHL receivers. Reasons:

1. Recipient is internal (admin@) — no GHL contact.
2. Email is operational, not marketing — bypasses the Phase 6 send-log on principle.
3. Direct SMTP / SendGrid / Postmark is more reliable for ops emails.

Implementation: use existing `lib/notifications/` patterns (likely Postmark or SendGrid — verify what's already wired). Add a `lib/notifications/billing-recon-email.ts` that takes the report → renders HTML → sends.

If existing email infra is rough, fall back to Gmail SMTP via `config/google credentials` (already used elsewhere per CLAUDE.md).

#### Dashboard widget on CEO/Today tab

Same data, condensed:

```
WEEKLY BILLING PULSE          As of Mon
━━━━━━━━━━━━━━━━━━━━━━━━━━━
MRR: $61,480  ▼ -0.2% wow
Drift items: 14 (1 critical)
Migration this week: 5 → Healthie
[ View Last Email → ]
```

The "View Last Email" link opens the rendered HTML in a new tab. Staff sees the widget; Phil gets the email. Same data, two surfaces.

---

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
-- One canonical run per date; manual re-runs overwrite via UPSERT
```

---

### Per-path code changes

| File | Change |
|---|---|
| `migrations/2026XXXX_billing_recon.sql` | NEW |
| `lib/billing-recon/fetch-healthie.ts` | NEW — pulls active recurring per active patient |
| `lib/billing-recon/fetch-qbo.ts` | NEW — pulls QBO recurring (uses `lib/quickbooks.ts`) |
| `lib/billing-recon/fetch-jane.ts` | NEW — reads from `legacy_billing_records` (Phase 5) |
| `lib/billing-recon/fetch-stripe.ts` | NEW — last 7 days direct charges |
| `lib/billing-recon/fetch-dashboard.ts` | NEW — joins patients × billing_source |
| `lib/billing-recon/compute.ts` | NEW — totals + drift + outliers logic |
| `lib/billing-recon/build-actions.ts` | NEW — derives action items from drift + migration |
| `lib/billing-recon/render-email.ts` | NEW — HTML template render |
| `lib/notifications/billing-recon-email.ts` | NEW — sends via existing email infra |
| `app/api/cron/billing-recon-weekly/route.ts` | NEW — Mon 8am cron |
| `app/api/billing-recon/latest/route.ts` | NEW — read endpoint for dashboard widget |
| `app/api/billing-recon/[id]/email-html/route.ts` | NEW — re-renders the email HTML for "View Last Email" link |
| `app/billing-recon/page.tsx` | NEW — full historical view with trend chart |
| `components/billing-recon/MrrTrendChart.tsx` | NEW |
| `components/billing-recon/DriftList.tsx` | NEW |
| `public/ipad/app.js` | MODIFY — Weekly Billing Pulse widget + dashboard mapping |
| `crontab` | UPDATE — Mon 8:00am Mountain |
| `scripts/billing-recon/preview.ts` | NEW — manual trigger to preview the email without sending (Phil-runnable) |
| `docs/sot-modules/[new]-billing-reconciliation.md` | NEW — module documenting recon scope, drift rules, action mapping |
| `docs/sot-modules/27-patient-flow-map.md` | UPDATE — Stage 6 + Stage 8 reference Phase 9 as the recon pulse |

---

### Won't-touch guarantees

- **Read-only across all systems.** Phase 9 NEVER writes to Healthie, QBO, Jane, or Stripe.
- **No automatic remediation.** Phase 9 surfaces drift; never fixes it. (Phases 1, 4, 5 do the fixing.)
- **No patient-facing email.** Recipient is admin@ ONLY.
- **No PHI in email body** beyond patient ID + MRR amount + brief reason. No names, DOBs, medical detail.
- **No new email infrastructure** — uses existing notifications layer.
- **Will NOT replace Phase 5's migration tracker.** Phase 9 reports on it; doesn't drive it.
- **Will NOT replace Phase 8's at-risk dashboard.** Phase 9 surfaces a snapshot count; the operational view stays in Phase 8.
- **Will NOT alert when nothing has changed.** If a week is genuinely quiet, the email still goes out (operational rhythm) but action items section says "None this week."

---

### Acceptance criteria

1. **Single email arrives.** First Monday after deploy: one email at admin@. Subject line includes the date.
2. **Totals are accurate.** Healthie MRR matches a manual `SUM(monthly_amount)` over `recurringPayments`. QBO MRR matches a QBO API spot-check. Within $50.
3. **Drift items make sense.** Phil reviews first email's drift section against gut-feel sample. ≥ 90% of items are real drifts (not false positives).
4. **Action items are actionable.** Each action item has a patient ID + a specific verb (cancel, send link, review, etc.) — no vague "investigate" prompts.
5. **Trend works.** Second Monday's email shows wow comparison vs first Monday. By week 4, MRR trend chart in dashboard shows 4 data points.
6. **No double-send.** Cron is idempotent — running twice on a Monday doesn't send two emails. Re-runs UPSERT into `billing_recon_runs`.
7. **Failure-mode visible.** If Healthie or QBO API is down at 8am, the email goes out anyway with a "data partial" notice and the missing source listed in errors.
8. **Read-only verified.** No writes occur to any external system. Logged as part of cron run.
9. **Dashboard widget matches email.** Counts and totals identical (within run timestamp tolerance).
10. **Phil can preview anytime.** `node scripts/billing-recon/preview.ts` produces the email HTML to stdout for review without sending.
11. **Resilient to Phase 5 ingestion lag.** If Jane CSV wasn't ingested this week, recon flags it and excludes Jane from totals (rather than reporting $0 misleadingly).

---

### Risk + rollback

**Risks:**
- Email recipient typo → Phil never sees it. **Mitigation:** Recipient is `process.env.BILLING_RECON_EMAIL` with default `admin@granitemountainhealth.com`. Phase 9.0 includes an explicit pre-flight test that sends a "Phase 9 wiring test" email and confirms receipt.
- Drift logic has off-by-one → reports phantom mismatches every week. **Mitigation:** Phase 9.5 = Phil-reviewed dry-run for 2 weeks before email auto-sends.
- QBO API down → totals understated → Phil makes wrong decision. **Mitigation:** Per-source error reporting in email; "Data partial" warning prominent; missing-source totals omitted.
- Email volume — if Phil decides he wants daily, the system needs to scale. **Mitigation:** Recon engine is decoupled from cron; trivially configurable to daily/weekly. Default weekly per Phil's directive.
- Drift counts include false positives from stale Healthie sync. **Mitigation:** Recon checks Healthie sync timestamp; aborts if last sync >24h old.
- Email rendering breaks in Phil's email client (tables, charts). **Mitigation:** Plaintext-first rendering; HTML version is enhancement; no inline images, no JS.
- PHI leak via patient names. **Mitigation:** Email format strictly uses `[Patient ID NNNN]` — no names. Confirmed by code review + redaction test.

**Rollback plan:**
- Disable cron via `BILLING_RECON_ENABLED=false`.
- Schema is additive; safe to leave.
- Past `billing_recon_runs` data preserved for audit.
- Dashboard widget hidden via feature flag.

---

### Sub-phases within Phase 9

| Sub-phase | Scope | Days |
|---|---|---|
| 9.0 | Email infra wiring test (confirm we can deliver to admin@) | 0.5 |
| 9.1 | Schema + `lib/billing-recon/fetch-*.ts` per-source fetchers | 2 |
| 9.2 | `compute.ts` totals + drift logic + drift rule unit tests | 1.5 |
| 9.3 | `render-email.ts` + plaintext + HTML templates | 1 |
| 9.4 | Cron + send + persist | 1 |
| 9.5 | Dry-run mode for 2 weeks (compute + persist + preview, NO send) | (calendar) |
| 9.6 | Phil reviews 2 dry-runs → adjustments | 0.5 |
| 9.7 | Enable send → first real email Monday | 0 |
| 9.8 | Dashboard widget + `/billing-recon` historical view | 1.5 |
| 9.9 | Documentation | 0.5 |

Active engineering: ~7 days. Wall-clock: ~21 days due to 2-week dry-run soak before first real send.

---

### Open questions for Phil before kickoff

1. **Email infra.** Confirm what's wired today — Postmark? SendGrid? Gmail SMTP? Whichever is most reliable, that's what Phase 9 uses. If nothing wired, propose Postmark (cheapest reliable transactional).
2. **Recipient list.** admin@granitemountainhealth.com confirmed primary. Anyone else? CFO? Bookkeeper? Recommend keeping it admin@-only initially per your hardening decision.
3. **Day + time.** Monday 8am Mountain confirmed?
4. **Dry-run period.** 2 weeks of dry-run review before first real email — acceptable?
5. **Drift rule prioritization.** The 7 drift rules above — any to add? Any to drop? Specifically: do you want a "billing source mismatched between dashboard and reality" rule? Phase 3's classifier handles this, but Phase 9 could double-check.
6. **At-risk integration.** Phase 9 includes Phase 8 at-risk pulse if Phase 8 is live. Confirm that's wanted in the email, OR keep at-risk separate (Phase 8's own report)?
7. **MRR projection logic.** "Projected sunset date: 9 weeks at current pace" requires a simple projection from Phase 5 migration velocity. Worth including, or premature?
8. **Action-item completion tracking.** Should the email include "Last week's action items: 3 done, 2 carried over" — i.e., a closure loop? Adds complexity (needs a per-action tracking table) but increases accountability. Recommend deferring to v2.
9. **Email history retention.** Keep `billing_recon_runs` indefinitely, or 12mo retention? Compliance angle?
10. **Phase ordering.** Phase 9 currently scheduled week 4. Could we ship Phase 9 earlier (week 2-3) so the recon catches drift during the rollout of Phase 1, 3, 5? Probably yes — Phase 9 only depends on Phase 3 (`billing_source` populated) and Phase 5 (`legacy_billing_records` exists). Reconsider sequence?

---

## Stage → Phase Coverage Matrix

| Stage | Phase(s) covering it |
|---|---|
| 1 — Lead | 7 |
| 2 — Booked | (no phase needed; existing webhooks adequate) |
| 3 — Intake | (existing morning-prep cron) |
| 4 — Evaluated | 4 |
| 5 — Onboarded | 3, 4 |
| 6 — Active | 3, 5, 9 |
| 7 — At-risk | 8, 9 |
| 8 — Off-service | 1, 9 |

Every flow-map stage has at least one phase covering it. Cross-cutting concerns (GHL graph hygiene, channel send infra, billing recon) get their own phases (2, 6, 9).

---

## What ships first (recommended sequence)

1. **Phase 1** (Inactive Safety) — week 1. Tiny, high-risk-reducing.
2. **Phase 2** (GHL Disable) — week 1, in parallel. Just disable + monitor.
3. **Phase 3** (Auto-Classification) — week 2. Dry-run review with Phil.
4. **Phase 5** (Migration Tracker) — week 2. Once Phase 3 produces classification data.
5. **Phase 4** (No Man's Land Queue) — week 3.
6. **Phase 6** (GHL Rebuild) — week 3, in parallel. Wires nudges from Phase 4.
7. **Phase 7** (Lead Source) — week 4.
8. **Phase 9** (Billing Recon Email) — week 4.
9. **Phase 8** (At-Risk Cron) — week 5+, blocked on Phil's clinical threshold input.

Total: ~5 weeks if everything goes smoothly; phases 1, 2, 3, 5, 4 are the must-haves. 6, 7, 9 are revenue-unlockers. 8 is the only one with an external dependency (clinical thresholds).

---

*v2 drafted 2026-04-24 from Patient Flow Map (sot-modules/27) + Phil's 5 answers. All 10 phases (1, 2, 3, 4, 5, 6, 6.5, 7, 8, 9) fully specified at uniform depth: Why → Architecture → Schema → Per-path code changes → Won't-touch guarantees → Acceptance criteria → Risk + rollback → Sub-phases → Open questions for Phil. Awaiting review before locking sequence and kicking off Phase 1.*
