# Hardening Plan v2 — Reality Audit

**Date:** 2026-04-24
**Scope:** Every claim in `28-hardening-plan-v2.md` cross-checked against live DB schema, current `lib/`, current `app/api/`, and SOT modules 19–27.
**Reviewer:** AntiGravity (multi-agent verification: schema query, code grep, SOT cross-reference)

---

## TL;DR — what I got wrong, what's still solid

The plan's **architecture and sequencing are mostly right**, but several phases were **specified against an imagined schema** rather than the live one. The biggest miss: I proposed inventing a parallel `billing_source` enum and a `legacy_billing_records` table when **`client_type_key` + `client_type_lookup` already implement exactly that concept**, in production, today, with 18 populated values covering every legacy system. Phase 5 in particular needs a major rewrite — not because the goal is wrong but because the data model already exists.

**Top 3 issues you should know about before any code:**

1. **🔴 Plan invents redundant DB state.** `client_type_key` (FK to `client_type_lookup`) is the de-facto `billing_source`. 18 lookup rows including `qbo_tcmh_180_month`, `jane_tcmh_180_month`, `primecare_elite_100_month`, `ins_supp_60_month`, `approved_disc_pro_bono_pt`. Phase 3/5 were going to create a parallel enum and a parallel `legacy_billing_records` table — that would split state between two systems and drift.
2. **🔴 SOT module 23 (GHL AI Agents) is essentially empty** — 87 lines of brand copy-paste, no Jessica/Max documentation. INDEX.md still points to it as the canonical reference. Phase 6 (GHL rebuild) repeatedly says "UPDATE module 23" but there's nothing to update against — the baseline is undocumented. Disabling 75+ workflows without knowing what Jessica/Max depend on is a real silent-breakage risk.
3. **🔴 Plan undercounts statuses, brands, sub-accounts.** `status_key` has **8 values** in production (active, active_pending, hold_payment_research, hold_service_change, hold_contract_renewal, hold_patient_research, inactive, inactive_payment_research). Plan only reasoned about `inactive` + `active`. `clinic` CHECK constraint includes `nowmentalhealth.care` — Mental Health brand was missing from the plan entirely.

**What's solid:**
- The 9-phase sequencing logic
- Phase 1's two-layer guard concept (API + trigger) — fits cleanly on top of existing `trg_patients_updated`
- Phase 2's GHL keep-list (already locked with Phil)
- Phase 4's "no man's land" queue (orthogonal to existing schema)
- Phase 6's "one workflow per channel" architectural goal (per Phil's direction)
- Phase 6.5's unified entry handler (solves a real gap)
- The won't-touch guarantees, acceptance criteria structure, and risk/rollback sections in every phase

---

## What I verified

| Source | Status |
|---|---|
| Live DB: `\d patients` | ✅ Pulled — 60+ columns, 8 status values, 18 client types, 6 payment methods, 5 brands |
| Live DB: lookup tables (`client_type_lookup`, `patient_status_lookup`, `payment_method_lookup`) | ✅ Pulled — all 3 exist, populated, FK-enforced |
| `lib/ghl.ts` | ✅ Read — 963 lines, class-based `GHLClient` + 5 factory functions per sub-account |
| `lib/healthie.ts` | ✅ Read — 1666 lines, `getClientSubscriptions()` is the recurring-billing wrapper (NOT `recurringPayments(user_id)` as the plan said) |
| `lib/db.ts` | ✅ `query<T>()` signature confirmed |
| `lib/quickbooks.ts` | ✅ Functional, OAuth-backed, DB-loaded tokens |
| `lib/notifications/` | ⚠ Only `chat.ts` (Google Chat). No email infra. |
| `app/api/abxtac/book/route.ts` | ✅ 682 lines, PUBLIC endpoint, all-3-system writer |
| `app/api/patients/route.ts` POST | ✅ 309 lines, staff auth, all-3-system writer (GHL async) |
| `app/api/webhooks/healthie/patient-created/route.ts` | ✅ 277 lines, dashboard-only writer |
| `app/api/cron/*` | ✅ Listed — `morning-prep`, `patient-reconciliation`, others. No `auto-classification` cron. |
| `scripts/apply-classification-batch.js` | ✅ Exists — manual one-off |
| `scripts/generate-classification-audit-v3.js` | ✅ Exists — manual audit |
| `scripts/batch-deactivate-inactive.js` | ✅ Exists — only existing inactive-flip path that ALSO touches Healthie |
| SOT module 22 (brands/groups) | ✅ Read — 6 brands incl. Mental Health |
| SOT module 23 (GHL AI Agents) | ⚠ Broken — 87 lines, no GHL content |
| SOT module 25 (classification policy) | ✅ Read — DRAFT spec; logic exists, cron does not |
| SOT module 26 (classification audit) | ✅ Read — manual report dated 2026-04-16 |
| SOT module 27 (patient flow map) | ✅ Read — 25-path entry catalog |

---

## Phase-by-phase audit

### Phase 1 — Inactive Safety

**Plan claims** | **Reality** | **Action**
---|---|---
"Add `status_key` column" | ❌ Already exists (FK to `patient_status_lookup`) | DROP — column is in production with index `idx_patients_status_key` |
"Inactive guard prevents charges when status_key='inactive'" | ✅ Real gap — no guard exists today | KEEP — but expand to all 4 hold/inactive variants |
"Add `patient_status_activity_log` table" | ❌ Already exists (8 columns: id, patient_id, previous_status, new_status, changed_by_user_id, change_source, change_reason, created_at) | DROP CREATE — INTEGRATE with existing table |
"7 code paths set inactive today, none guard against billing" | ✅ Confirmed via grep across `lib/` (18 files reference status_key) and `scripts/` | KEEP |
"No DB triggers enforce business rules" | ✅ Confirmed — only `trg_patients_updated` (timestamp maintenance) + 9 housekeeping triggers | KEEP |
"`lib/inactive-guard.ts` does not exist" | ✅ Confirmed | KEEP |
"`lib/healthieDemographics.ts:207` already skips inactive for demographic syncs" | ❌ Plan didn't mention this | ADD acknowledgment — plan says "zero guards"; reality is "zero billing guards but one demographic guard" |

**Plan revision needed:**
- Remove the schema migration. Phase 1 is **all code**, not schema.
- Reason about all 8 `status_key` values, not just `active` vs `inactive`. Specifically: what's the policy for `hold_payment_research`, `hold_service_change`, `inactive_payment_research`? Are these also no-charge? Need Phil input.
- Use existing `patient_status_activity_log`. Plan to add a `change_source` value like `inactive_guard_block` to log denied transitions.
- The proposed Postgres trigger should chain BEFORE `trg_patients_updated`, not replace it.

**Verdict: 70% accurate. Needs schema-section deletion + 8-status policy clarification.**

---

### Phase 2 — GHL Workflow + Pipeline Reset

**Plan claims** | **Reality** | **Action**
---|---|---
"82 workflows + 5 pipelines exist across 4 sub-accounts" | ✅ Confirmed via inventory script run | KEEP |
"4 sub-accounts: Men's Health, PC, ABXTac, Longevity" | ⚠ Per `clinic` CHECK constraint, there are **5 brands** including Mental Health (`nowmentalhealth.care`). Plan ignored MH. | INVESTIGATE — does Mental Health have its own GHL sub-account, or share one? |
"Keep-list of 6 workflows + 0 pipelines" | ✅ Already locked with you 2026-04-24 | KEEP |
"Disable everything else via API or UI checklist" | ✅ Approach is sound | KEEP |
"Jessica/Max chatbots may depend on disabled workflows" | ❓ Unverified — module 23 is empty | **BLOCKER** — must audit Jessica/Max workflow deps before bulk disable |

**Plan revision needed:**
- Pre-flight script (`preflight-check.mjs`) should specifically grep for Jessica/Max identifiers in the 82 workflows + bot configs and flag every dependency.
- Add Mental Health to the inventory + keep-list confirmation. If MH has its own sub-account, we need its workflow inventory; if it shares with one of the existing 4, document that.

**Verdict: 85% accurate. Needs Jessica/Max dependency audit + Mental Health enumeration.**

---

### Phase 3 — Auto-Classification

**Plan claims** | **Reality** | **Action**
---|---|---
"Add `billing_source` enum (healthie_recurring \| qbo_legacy \| jane_legacy \| primecare_legacy \| ins_supp_legacy \| pro_bono \| direct_stripe_retail \| none \| unknown)" | 🔴 **REDUNDANT** — `client_type_key` already exists with FK to `client_type_lookup`, populated with 18 values that DIRECTLY encode this state (`qbo_tcmh_180_month`, `jane_tcmh_180_month`, `primecare_elite_100_month`, etc.) | **REWRITE** — derive billing_source FROM client_type_key, don't add a parallel column |
"`patient_type` will support 'member', 'visit', 'intermittent'" | 🔧 `patient_type` exists and is indexed; current values per SOT 25 are `member` and `visit`; `intermittent` per SOT is the new draft addition | KEEP — accurate |
"Build auto-classification cron from scratch" | 🔧 PARTIAL — `scripts/apply-classification-batch.js` already implements the rules. The cron schedule is what's missing. | RE-FRAME — "schedule existing batch script + extend rules to derive client_type_key" |
"Daily cron at 4am Mountain" | ✅ Compatible with existing crontab | KEEP |
"Dry-run mode" | ✅ Existing audit script (`generate-classification-audit-v3.js`) is essentially the dry-run | INTEGRATE |

**Plan revision needed (significant):**
- **Drop the `billing_source` schema migration entirely.** Use `client_type_key`. Add a `billing_source` enum at the lib level (`lib/classify.ts`) that's a function-derived view of `client_type_key`:
  ```typescript
  // Derived, not stored
  function deriveBillingSource(p: Patient): BillingSource {
    if (p.client_type_key?.startsWith('qbo_')) return 'qbo_legacy';
    if (p.client_type_key?.startsWith('jane_')) return 'jane_legacy';
    if (p.client_type_key?.startsWith('primecare_')) return 'primecare_legacy';
    if (p.client_type_key === 'ins_supp_60_month') return 'ins_supp_legacy';
    if (p.client_type_key === 'approved_disc_pro_bono_pt') return 'pro_bono';
    if (p.client_type_key && ['nowprimarycare','nowmenshealth','nowlongevity','abxtac','nowmentalhealth'].includes(p.client_type_key)) return 'healthie_recurring';
    if (p.client_type_key === 'sick_visit') return 'direct_stripe_retail';
    return 'unknown';
  }
  ```
- Phase 3 becomes: write `lib/classify.ts` with this derivation + a cron that ENRICHES `client_type_key` from Healthie state when the dashboard guess is `unknown` or stale.
- The 18 client_type values include three weird ones: `mixed_primecare_jane_qbo_tcmh`, `mixed_primcare_jane_qbo_tcmh` (typo duplicate of the first), `mens_health_qbo`, `other`. Phase 3 needs to decide policy for these.

**Verdict: 50% accurate. Major rewrite required — drop schema migration, derive from existing column, integrate existing batch script.**

---

### Phase 4 — No Man's Land Queue

**Plan claims** | **Reality** | **Action**
---|---|---
"Add `status_key='active_pending'` queue view" | ✅ `active_pending` is already a real status_key value | KEEP — no schema change needed |
"Hourly nudge cron" | ✅ Compatible | KEEP |
"`recurringPayments(user_id)` query" | ⚠ Wrong function name — actual wrapper is `getClientSubscriptions(clientId)` which extracts `recurring_payment` sub-objects from `billingItems` | UPDATE all references |
"Pending Onboarding tab" | ✅ Net-new UI | KEEP |
"Unblock when Healthie recurring detected" | ✅ Sound logic | KEEP |

**Plan revision needed:**
- Replace every `recurringPayments(user_id)` reference with `getClientSubscriptions(clientId)` — also pinned in memory but the pin name was misleading; the wrapper is named differently in code.

**Verdict: 90% accurate. Light rename pass + use existing `active_pending` value.**

---

### Phase 5 — Migration Tracker

**Plan claims** | **Reality** | **Action**
---|---|---
"Create `legacy_billing_records` table" | 🔴 **REDUNDANT** — `client_type_key` already segregates legacy: `qbo_*`, `jane_*`, `primecare_*`, `ins_supp_*` | **REWRITE** — use `client_type_key` as the cohort filter |
"Add `migration_state` column" | ✅ Net-new — safe to add | KEEP |
"Add `migration_assignee` column" | ✅ Net-new | KEEP |
"Add `service_start_date` column" | ❌ **Already exists** as a `date` column | DROP add; USE existing |
"Migration tab UI sorted by months-on-legacy" | ✅ Achievable from existing `service_start_date` | KEEP |
"Verify-on-migrate via Healthie recurring re-query" | ✅ Sound logic | KEEP — but use `getClientSubscriptions` not the imagined wrapper |
"QBO ingestion script" | ⚠ Patients ALREADY have `qbo_customer_id` populated for QBO patients | RE-SCOPE — script doesn't need to re-discover; just pull current invoice state for the cohort already identified by client_type_key |
"Jane CSV import" | 🔧 `jane_id` column exists on patients; is it populated? Need to check. If yes, no CSV needed | INVESTIGATE before building |

**Plan revision needed (major):**
- Drop `legacy_billing_records` table creation. Migration cohort = `SELECT * FROM patients WHERE client_type_key IN ('qbo_tcmh_180_month','jane_tcmh_180_month','primecare_elite_100_month','primecare_premier_50_month','ins_supp_60_month','jane_f_f_fr_veteran_140_month','qbo_f_f_fr_veteran_140_month','mens_health_qbo','mixed_primecare_jane_qbo_tcmh')`.
- The lookup table even has `display_name` like "QBO TCMH $180/Month" which contains the monthly amount — parse it OR add a `monthly_amount_cents` column to `client_type_lookup`.
- `migration_state` + `migration_assignee` + `migration_target_package` columns: still net-new and useful.
- `migration_contact_log` table: still useful, no overlap.
- Add `client_type_key` flip as the migration completion signal — not a new "completed" state; just changing client_type_key from `qbo_tcmh_180_month` → `nowmenshealth` (or appropriate Healthie equivalent).
- Verify `jane_id` column is populated before building Jane CSV ingestion. If `jane_id` already exists on most Jane patients, no CSV ingestion is needed.

**Verdict: 40% accurate. Significant rewrite — drop the parallel legacy table, leverage existing client_type_key + client_type_lookup, verify jane_id population first.**

---

### Phase 6 — GHL Rebuild

**Plan claims** | **Reality** | **Action**
---|---|---
"`lib/ghl.ts` rewrite to typed helpers (sendSms, sendEmail, etc.)" | 🔧 Existing file is 963 lines, class-based `GHLClient`. Plan was vague on integration. | REVISE — preserve `GHLClient` class, ADD typed dispatch methods, deprecate scattered direct API calls |
"4 sub-accounts × 4 channels = 12 receivers" | ⚠ Plan said "12 total since PC + Longevity share." But Mental Health was missing entirely. | INVESTIGATE Mental Health sub-account; could be 16 or 12 |
"`lib/email-templates/` directory NEW" | ✅ Confirmed does not exist | KEEP — but acknowledge `scripts/email-templates/build_brand_emails.py` is the existing brand-templating Python script; need to decide TS vs Python boundary |
"`ghl_send_log` table NEW" | ✅ Confirmed does not exist | KEEP |
"GHL has no workflow create/edit API" | ✅ Confirmed | KEEP |
"Plan to update SOT module 23" | 🔴 **CRITICAL** — module 23 is essentially empty (87 lines of brand copy-paste). There's no baseline to update. Updating an empty doc means we're documenting from scratch — but the plan refers to module 23 as if it has real content to extend. | **BLOCKER** — Phase 6 must FIRST reverse-engineer current Jessica/Max architecture into module 23 before disabling anything |

**Plan revision needed:**
- Sub-phase 6.0a (NEW): document current Jessica/Max architecture into module 23. This is a prerequisite, not a "documentation update" at the end.
- `lib/ghl.ts` rewrite spec needs to preserve the existing class shape; the plan's typed dispatch becomes new methods on `GHLClient`, not a parallel module.
- Confirm Mental Health sub-account count before building checklists.

**Verdict: 75% accurate. Architecture is right; module 23 reverse-engineering becomes a hard prereq; integration with existing class needs spec update.**

---

### Phase 6.5 — Unified Entry Handler

**Plan claims** | **Reality** | **Action**
---|---|---
"~25 entry paths, only 2 auto-chain all 3 systems" | ⚠ More accurate: ~3-4 paths *create* patients; rest are read-only. Specifically: `app/api/abxtac/book` (PUBLIC, all-3), `app/api/patients` POST (staff, all-3), `app/api/webhooks/healthie/patient-created` (Dashboard-only upsert from Healthie) | RE-FRAME — distinguish "creates" vs "appears" |
"`app/api/booking/route.ts` is an entry path" | ❌ File doesn't exist. ABXTac booking is at `app/api/abxtac/book/route.ts`. | DELETE reference |
"iPad kiosk submit (`app/api/ipad/kiosk/submit/route.ts`) creates patients" | ❌ Reality: form submission for EXISTING patients, no INSERT | RE-CLASSIFY |
"ABXTac handler is a candidate for unification" | ⚠ ABXTac is PUBLIC (no requireApiUser, CORS to abxtac.com). Plan's unified handler model assumed all entry points are internal. Auth model differs. | **DECISION POINT** — does unified handler accept anonymous public POSTs? Or does ABXTac stay separate? |
"`patient_source_path` enum" | ✅ Net-new | KEEP, but use the right path names |
"Cross-system dedup" | ✅ Real value-add | KEEP |

**Plan revision needed:**
- Replace the 25-entry-path narrative with a precise list of 3 (or 4) paths that actually INSERT. Other paths read-update — they're touchpoints, not creates.
- Auth model: explicitly call out PUBLIC vs internal. ABXTac probably stays its own handler that delegates to the unified library, not a wholesale merge.
- Verify whether kiosk submit was DESIGNED to create and just doesn't, or if it's working as designed.

**Verdict: 60% accurate. The unified-orchestrator concept is sound; the entry-path inventory is wrong; auth model gap needs explicit handling.**

---

### Phase 7 — Lead Source

**Plan claims** | **Reality** | **Action**
---|---|---
"Add `lead_source` column to patients" | ✅ Confirmed does not exist | KEEP |
"Add `lead_attribution` JSONB" | ✅ Net-new | KEEP |
"Add `lead_source_audit` table" | ✅ Net-new | KEEP |
"15-value enum" | ✅ Net-new — no existing taxonomy | KEEP |
"Healthie tag IDs map to lead_source values" | 🔧 Tags exist (per pin `reference_healthie_tags_vs_groups.md`) but for care-line categorization, not lead source. Need NEW lead-source tags in Healthie. | INVESTIGATE — confirm with Phil whether to create lead-source tags in Healthie OR keep lead_source dashboard-only |
"GHL `source` custom field" | 🔧 Need to verify whether such a custom field exists in any of the GHL sub-accounts; plan assumed creation | INVESTIGATE before building |

**Verdict: 80% accurate. Schema is clean. Healthie tag and GHL custom field provisioning needs confirmation.**

---

### Phase 8 — At-Risk Cron

**Plan claims** | **Reality** | **Action**
---|---|---
"Add `risk_flags` JSONB" | ✅ Net-new | KEEP |
"Add `risk_resolution_log` table" | ✅ Net-new | KEEP |
"Add `risk_nudge_log` table" | ✅ Net-new | KEEP |
"Care line derived from `patients.healthie_groups`" | ❌ `healthie_groups` column does not exist. Plan assumed it. | REWRITE — derive from `clinic` + `client_type_key` + Healthie API call to get user_groups |
"5 care lines (TRT, GLP-1, Primary Care, Longevity, ABXTac)" | ⚠ SOT module 22 has 6 brands. Plan conflates brand and clinical specialty. Mental Health missing. TRT/GLP-1 are services within brands, not brands themselves. | RE-SPEC — separate brand thresholds vs service thresholds |
"10 risk types" | ✅ Net-new design space | KEEP, but clinical-input-blocked |
"Phase 8 last to ship — clinical input blocker" | ✅ Sound | KEEP |

**Plan revision needed:**
- Replace `patients.healthie_groups` references with derivation from existing fields. `clinic` is the brand; the lookup table or Healthie API call gives you services/groups.
- Untangle "care line" vs "brand": are thresholds per-brand or per-service? Phil + clinical input.

**Verdict: 70% accurate. Schema additions are clean; brand/care-line distinction needs rethink; one phantom column reference (`healthie_groups`) to delete.**

---

### Phase 9 — Weekly Billing Recon Email

**Plan claims** | **Reality** | **Action**
---|---|---
"Add `billing_recon_runs` table" | ✅ Net-new | KEEP |
"Use existing email infra (`lib/notifications/`)" | 🔴 **FALSE** — `lib/notifications/` only has `chat.ts` (Google Chat). No Postmark/SendGrid/SMTP. | **BLOCKER** — Phase 9 needs to either (a) add email infra (~1-2 days of work) or (b) defer until that infra is built |
"Pull from Healthie + QBO + Jane + Stripe + Dashboard" | ⚠ Pull from Healthie + QBO + (Jane via existing jane_id?) + Stripe + Dashboard. Jane may not need separate ingestion if jane_id is populated. | RE-SCOPE based on jane_id check |
"6-section email body" | ✅ Sound design | KEEP |
"Drift detection rules" | ✅ Achievable from `client_type_key` + Healthie state | KEEP |
"Mon 8am cron, admin@ only" | ✅ Confirmed with Phil | KEEP |

**Plan revision needed:**
- Sub-phase 9.0 ("email infra wiring test") is too lightweight. Reality: there is no email infra. Need to choose Postmark/SendGrid/SES + add `lib/notifications/email.ts` from scratch. Adds ~1-2 days.
- Or use the existing Gmail SMTP + `config/google credentials` route (per CLAUDE.md). Need Phil decision.

**Verdict: 80% accurate. Email infra gap is real; everything else holds.**

---

## SOT cross-reference — what the SOT modules say vs what the plan assumed

| SOT module | Plan assumption | Reality |
|---|---|---|
| Module 22 (brand/group) | Plan named 4 brands | SOT lists 6 brands; `clinic` CHECK has 5 (incl. Mental Health) |
| Module 23 (GHL agents) | Plan said "UPDATE module 23 with new state" | Module 23 is empty/broken — 87 lines of brand copy-paste, no GHL content. Must be rebuilt before Phase 6. |
| Module 25 (classification) | Plan said "build auto-classification" | Logic exists in scripts; cron does not. Re-frame as "schedule existing logic" |
| Module 26 (classification audit) | Plan said "dry-run report" | Audit report dated 2026-04-16 already exists. Re-use, don't recreate. |
| Module 27 (patient flow map) | Plan referenced Stages 1-8 | ✅ Stages match. Entry-path catalog needs correction (path names) |
| INDEX.md | Plan implied modules are coherent | ⚠ INDEX still points to broken module 23. Update INDEX or restore module 23 first. |
| PROJECT_TRACKER.md | Plan presented all phases as greenfield | ⚠ ABX TAC BioBox migration is in-progress; Mobile App verification is broken (0/260). These overlap Phase 6.5/Phase 4 territory. |

---

## In-flight work the plan ignores

Per `PROJECT_TRACKER.md`:

1. **ABX TAC BioBox integration** — IN PROGRESS as of 2026-04-16. Phase 1 items: migration created (not yet run), API endpoints created, build passes. **Overlap risk:** entry-point handling for ABX TAC may be partially built. Phase 6.5 needs to integrate, not parallel.
2. **Mobile app verification flow BROKEN** — 0 of 260 patients verified. **Overlap risk:** Phase 4 (No Man's Land) and Phase 8 (At-Risk) might propose mobile-app-based nudges; if mobile auth is broken, those don't work end-to-end.
3. **Tier discount rate bug** — `lib/abxtac-provider-access.ts` has wrong rates (20/30/40 instead of 10/20/30 per policy). Not a Phase 1-9 item but a known revenue bug. Should be fixed before any phase-1 demo so we don't conflate.

---

## Schema reality table

Quick reference: column-by-column status.

| Plan referenced column | Actually on `patients`? | Notes |
|---|---|---|
| `status_key` | ✅ Yes (FK to patient_status_lookup, 8 values) | Plan can use as-is |
| `client_type_key` | ✅ Yes (FK to client_type_lookup, 18 values) | This IS the billing_source. Plan was inventing a parallel column. |
| `payment_method_key` | ✅ Yes (FK to payment_method_lookup, 6 values) | Plan ignored this; relevant for Phase 3 derivation |
| `patient_type` | ✅ Yes (text, indexed) | Plan referenced; correct |
| `service_start_date` | ✅ Yes (date) | Plan was going to ADD; already exists |
| `clinic` | ✅ Yes (CHECK constraint, 5 values incl. Mental Health) | Plan called this `brand`; rename in spec |
| `parent_patient_id` | ✅ Yes | Plan didn't use; relevant for shared-email pin |
| `spouse_patient_id` | ✅ Yes | Plan didn't use; same |
| `healthie_client_id` | ✅ Yes (indexed UNIQUE WHERE NOT NULL) | Plan called `healthie_id`; rename |
| `qbo_customer_id`, `jane_id`, `clinic_sync_id` | ✅ Yes | Plan ignored; saves needing legacy_billing_records |
| `ghl_contact_id`, `ghl_sync_status`, `ghl_last_synced_at`, `ghl_sync_error`, `ghl_tags` | ✅ Yes | Plan ignored; relevant for Phase 6/7 |
| `prescribing_provider_id` | ✅ Yes | Plan ignored; relevant for at-risk routing in Phase 8 |
| `stripe_customer_id` | ✅ Yes (indexed) | Plan ignored; relevant for Phase 9 reconciliation |
| `lead_source` | ❌ No | Phase 7 add — confirmed |
| `lead_attribution` | ❌ No | Phase 7 add — confirmed |
| `migration_state` | ❌ No | Phase 5 add — confirmed |
| `migration_assignee` | ❌ No | Phase 5 add — confirmed |
| `risk_flags` | ❌ No | Phase 8 add — confirmed |
| `no_clinical_outreach` | ❌ No | Plan referenced as if existed; doesn't. Either drop or add as Phase 1.5. |
| `healthie_groups` | ❌ No | Plan referenced repeatedly; doesn't exist. Derive from API. |
| `brand` | ❌ No (use `clinic`) | Rename in spec |
| `billing_source` | ❌ No (use `client_type_key`-derived) | DROP from plan; derive at lib level |

---

## Recommended plan amendments — concrete next steps

If you want me to proceed, the order is:

### Round 1 — fix the broken specs (no code yet, just docs)

1. **Phase 3 rewrite:** drop `billing_source` column, derive from `client_type_key`. ~30 min edit to plan.
2. **Phase 5 rewrite:** drop `legacy_billing_records` table, use `client_type_key` cohort filter. ~45 min edit.
3. **Phase 1 schema-cleanup:** delete the column-add migration; rewrite as code-only. ~15 min edit.
4. **Phase 8 fix:** remove `healthie_groups` references; derive care line from `clinic` + Healthie API. ~20 min edit.
5. **Phase 6.5 fix:** correct entry-path inventory (3-4 real entries, not 25); explicit auth model decision. ~30 min edit.
6. **Phase 9 fix:** add explicit "build email infra" as sub-phase 9.0. ~15 min edit.
7. **Add Mental Health** to all phase enumerations + clinic CHECK constraint reasoning. ~20 min edit.

### Round 2 — fix the SOT before any code

8. **Reverse-engineer module 23.** Audit Jessica/Max bot config, current 82 GHL workflows, identify all dependencies. ~half-day investigation.
9. **Update INDEX.md** to reflect what 23 actually contains.
10. **Verify `jane_id` and `qbo_customer_id` population** on existing Jane/QBO patients. If populated, Phase 5 ingestion scripts simplify dramatically.

### Round 3 — clarify with you

11. Policy for the 8 status_key values (which are no-charge?)
12. Policy for the 3 weird client_type_keys (`mixed_primecare_jane_qbo_tcmh`, `mens_health_qbo`, `other`)
13. Mental Health sub-account: own GHL location, or shared?
14. Email infra choice (Postmark / SES / Gmail SMTP)
15. ABXTac handler: stays public + delegates to unified lib, or gets folded in?

After these, the plan would be ready to execute. The architecture survives intact; what changes is the data model alignment and a few SOT prereqs.

---

## What this audit didn't catch

I checked schema, libs, API routes, SOT modules, and recent git history. I did NOT verify:
- Current crontab entries (would need `crontab -l` on the server)
- Whether GHL receiver-style workflows are already partially built (would need GHL UI access)
- Mental Health GHL sub-account existence (env var inventory pending)
- Jane API access state
- Whether `lib/email-templates/` ever existed in git history under a different name

These are reasonable next-round investigations.

---

*Audit complete 2026-04-24. Plan is salvageable; the architecture is sound. The schema design and SOT prereqs need to be aligned with reality before any code is written.*
