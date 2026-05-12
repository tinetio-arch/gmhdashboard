# Patient Classification Policy & Dashboard Design — v1.0 (DRAFT)

**Status:** DRAFT — pending final approval before any code work.
**Last updated:** 2026-04-16
**Author:** Phil Schafer + AntiGravity (Claude Code)
**Purpose:** Make the GMH Dashboard the single source of truth for "who is every patient to us." Eliminate ambiguity, duplicates, and orphaned records. Define intake defaults, classification rules, and dashboard behavior.

---

## 1. Why This Exists

As of 2026-04-16 the `/patients` page shows 31 recently-added patients with empty classification fields, no service-line tags, and the Healthie-link column unpopulated in the UI (though the link exists in the DB). This reflects a deeper problem: there has been no written rule set for how new patients are classified, linked, and surfaced on the dashboard. This document fixes that.

The dashboard's job is to answer, in under 2 seconds per row:

1. **Who is this patient to us?** (Member, Intermittent, Visit)
2. **Are they onboarded?** (intake, consents, app, kiosk paperwork)
3. **Are they on track?** (labs, last visit, dispense)

---

## 2. Core Principles (Non-Negotiable)

1. **The system never mutates existing patient records.** Rules apply only to (a) patients created from the policy effective date forward, and (b) "white rows" — patients missing classification fields. Existing classified patients are grandfathered until a staff member manually edits them.
2. **Only staff can mark a patient Inactive.** No cron, no 180-day rule, no automation. Ever.
3. **Healthie is the source of truth for patient data.** When local DB and Healthie disagree, Healthie wins. Syncing flows Healthie → local, never local → Healthie.
4. **Labs stay untouched by this policy.** `Last Lab` / `Next Lab` are NULL unless real results exist. The existing lab state machine (no-data / current / due-soon / overdue) keeps working exactly as it does today. "Pending" in this system refers **only to labs**.
5. **No automated deduplication.** Duplicate candidates surface in an Exceptions view. Staff decides the merge.
6. **Group stickiness — patients cannot switch care-line groups.** A NowMensHealth.Care patient stays NowMensHealth.Care. A NowPrimary.Care patient stays NowPrimary.Care. The system NEVER auto-migrates a patient between groups based on what they buy or which services they receive. Group changes are a staff-only action.
7. **Highest discount wins; discounts never stack.** When a patient qualifies for multiple discounts (e.g., a care-line courtesy discount AND an ABXTAC tier), apply the highest applicable percentage. Never add or multiply.
8. **App lockout is ABXTAC-only.** A patient blocked from the native iOS / Google Play app because of a payment issue is an **ABXTAC-specific** rule. NowMensHealth.Care, NowPrimary.Care, and Visit patients are **never** locked out of the app for billing reasons — different payment failure playbook applies to those groups (staff follow-up, not access removal).

---

## 3. Patient Classification

### 3.1 The Mechanical Rule

```
Has active Healthie package?             → MEMBER
No package, but recurring service?        → INTERMITTENT
Otherwise (one-time or episodic)?         → VISIT
```

This is checkable directly from Healthie — no judgment calls needed.

### 3.2 Type Definitions

**MEMBER** — has an active Healthie package (recurring billing). Examples: TRT membership (NOWMensHealth.Care), Primary Care membership (NOWPrimary.Care), ABXTAC membership. If a patient holds a membership AND also gets intermittent services (peptides, pelleting), they are a **Member**. Membership wins.

**INTERMITTENT** — no membership, but receives recurring care at a non-monthly cadence. Examples: pelleting patients (every 3–6 months), weight-loss / GLP-1 patients (monthly, no full-care package), peptide-only patients (not on ABXTAC).

**VISIT** — one-time or episodic. Examples: sick visits, consults, walk-ins.

### 3.3 Field Matrix

| Field | Member | Intermittent | Visit |
|---|---|---|---|
| **Type** (`patients.patient_type`) | `member` | `intermittent` *(new value, requires lookup entry)* | `visit` |
| **Group** (`patients.healthie_group_id`) | NOWMensHealth.Care / NOWPrimary.Care / NOWLongevity.Care / NOWMentalHealth.Care per package | Pelleting cross-brand / ABXTAC for peptide-only | `Sick Visit` (77894) |
| **Payment** (`patients.payment_method`) | `Healthie` | `Healthie` (or `Stripe-Direct` for Stripe-only peptides) | `Healthie` or `Cash` |
| **Status** (`patients.status`) | `Active` unless staff sets Hold/Inactive | `Active` unless staff sets Hold/Inactive | `Active` if seen in last 90 days; otherwise staff decides |
| **Regimen** (`patients.regimen`) | Derived from Healthie tags: TRT / Primary Care / Longevity / Mental Health | Derived from Healthie tags: Pelleting / Weight-Loss / Peptide | `Sick` (or whatever brought them in) |

### 3.4 Status Values (Unchanged from Current DB)

- `Active` — engaged patient
- `Hold` — temporarily paused (billing dispute, medical hold, travel)
- `Inactive` — **staff-only action**, no auto-transition
- Existing sub-states (`active_pending`, `hold_payment_research`, etc.) remain unchanged

### 3.5 Payment Methods

- `Healthie` — default for clinical patients (already hardcoded in `AddPatientForm.tsx:69`)
- `Stripe-Direct` — retail/one-off peptide & supplement purchases (MindGravity account)
- `Cash` — cash-pay patients (Healthie tag `85267`)
- `N/A` — dependent minors tied to a paying parent

### 3.6.a Gender & Provider Gating Rules

Classification uses biological sex plus provider/visit signals to assign group. These rules apply **only to currently-Unclassified patients** (scope per Core Principle #1). Existing classified patients are never reassigned by the system.

| Signal | Proposed Group | Default Service Tag |
|---|---|---|
| `gender = male` + seen by Dr. Whitten (or has TRT dispense history) | **NOWMensHealth.Care** | — (TRT implied) |
| `gender = female` + hormone-related visit (pelleting tag OR hormone appointment type) | **NOWLongevity.Care** | `pelleting` |
| `gender = male` + pelleting tag, no TRT history | **NOWMensHealth.Care** with pelleting **overlay** (see §3.6.b) | `pelleting` |
| No clear signal | Stays `Unclassified` | — |

**Hard rule — TRT eligibility:** testosterone is **never dispensed to non-male patients**. The TRT refill eligibility system (§8.7) checks `gender` as a gate before the warning/override flow. Staff override is blocked here — this is not a "warn with override" check, it's a hard block. (If a female patient truly needs testosterone for a clinical exception, staff creates a provider-signed override record outside the normal dispense path.)

**Spouse edge case:** A female spouse of a NOWMensHealth.Care patient does **not** inherit MensHealth enrollment or TRT eligibility. See §7.5 below.

### 3.6.b Service-Tag Overlay (Primary Group + Add-On Services)

Per Core Principle #6 (group stickiness), a patient's primary group is mutually exclusive. But **service tags layer on top** and can add clinical lines to any primary group.

**Example — Clint Shafer:** primary group = NOWMensHealth.Care (TRT), service tag = `pelleting`. Regimen displays as `"TRT + Pelleting"`. He does not migrate to NOWLongevity.Care when he starts pelleting — his primary group stays MensHealth; pelleting is an overlay.

| Primary Group | Allowed Overlay Tags | Not Allowed (Would Require Group Switch) |
|---|---|---|
| NOWMensHealth.Care | pelleting, peptides, weight-loss | — |
| NOWPrimary.Care | pelleting, peptides, weight-loss | — |
| NOWLongevity.Care | pelleting (expected), peptides, weight-loss | — |
| Sick Visit / Visit | (any) | — |
| ABXTAC | peptides (core), weight-loss | — |

Staff can add or remove service tags freely; staff cannot change the primary group (group stickiness).

### 3.6 Regimen Derivation

Regimen is **derived from Healthie tags at render time** — it is not stored as a separate authoritative value. This keeps Healthie as the source of truth and prevents drift.

| Healthie Tag | Regimen Label |
|---|---|
| `82887` pelleting | Pelleting |
| `82888` weight-loss | Weight-Loss |
| `82890` peptides | Peptide |
| dispenses table has rows | TRT |
| `82917` primary-care | Primary Care |
| Multiple apply | Concatenated (e.g., "TRT + Peptide") |

---

## 4. Dashboard Redesign

### 4.1 Tab Bar (Top of `/patients` Page)

Current: `All | Members | Visits`

**New:** `All | Members | Intermittent | Visits | Unclassified`

- **Unclassified** — patients missing Type, Group, or Payment. This is the staff backlog queue. Sits at the far right; label turns amber when count > 0 to draw attention without hijacking the primary tabs.
- Tabs filter by `patient_type`. Counts update live.

### 4.2 New Column: Signal Badges

Add a `Signals` column to the patient table showing per-patient onboarding and engagement state as colored badges. Reading left to right answers: "Is this patient fully set up, and are they on track?"

```
Name              Type          Signals                              Regimen
Alana Morrison    Intermittent  📋🟢 ✍️🟡 📱🔴 📝🟢 🔬⚪ 📅🟢        Pelleting
Keaton Lyon       Member        📋🟢 ✍️🟢 📱🟢 📝🟢 🔬🟢 📅🟢        TRT
Elizabeth Douglas Visit         📋🟢 ✍️🟢 📱⚪ 📝🟢 🔬⚪ 📅🟢        Sick
```

Badge legend:
- 🟢 green — complete / current
- 🟡 yellow — attention soon (e.g., expiring, stale)
- 🔴 red — action needed
- ⚪ gray — not applicable for this patient type

### 4.3 Badge Applicability by Type

| Signal | Member | Intermittent | Visit |
|---|---|---|---|
| 📋 Intake (Healthie forms) | ✓ | ✓ | ✓ |
| ✍️ Consents | ✓ | ✓ | ✓ |
| 📱 On App | ✓ | ✓ | — (gray) |
| 📝 Kiosk Paperwork | ✓ | ✓ | ✓ |
| 🔬 Labs | ✓ | TRT/weight-loss only | — (gray) |
| 📅 Last Visit | ✓ | ✓ | ✓ |

### 4.4 Hover/Click Behavior

Hovering any badge shows the underlying data ("Intake: 3/4 forms complete — missing telehealth consent"). Clicking jumps to the patient detail page with that section expanded.

### 4.5 Filters (Below Tabs)

Keep the existing filters:
- Search
- Status dropdown
- Labs Due (within N days)

Add two new filters:
- **Missing signals** — show only patients with at least one 🔴 badge
- **Has tag** — filter by Healthie tag (pelleting, weight-loss, etc.)

---

## 5. Signal Definitions

Every signal has a deterministic source. No heuristics.

### 5.1 📋 Intake (Healthie Forms)

- **Source:** `lib/healthie.ts:1695` `getFormAnswerGroups(userId)` + `any_incomplete_onboarding_steps` flag on the Healthie user
- **Green:** all required onboarding forms submitted (`finished: true`)
- **Yellow:** forms started but not finished (status `locked` or `draft`)
- **Red:** no forms submitted for a Healthie-linked patient who has been active > 7 days
- **Gray:** N/A (new patient < 24h old)

### 5.2 ✍️ Consents

- **Source today:** `pending_peptide_consents` table — peptide consents only
- **Gap:** no HIPAA / telehealth / treatment consent tracking. Requires a new `patient_consents` table to complete this badge properly.
- **Green:** all applicable consents signed
- **Yellow:** pending signature (sent, not yet signed)
- **Red:** applicable consent missing / expired
- **Gray:** N/A (no consents required — rare)

### 5.3 📱 On App

- **Source:** `patients.first_app_login` column, stamped by `app/api/headless/record-app-login/route.ts:20` on first Lambda `get_dashboard_stats` call
- **Green:** `first_app_login` is not null
- **Yellow:** app invite sent > 7 days ago, not yet logged in
- **Red:** Member or Intermittent patient with no app login and no invite sent
- **Gray:** Visit-type patient (not expected to use app)

### 5.4 📝 Kiosk Paperwork

- **Source:** `kiosk_form_sessions` table — status `completed` and `submitted_to_healthie = true`
- **Green:** at least one completed submission linked to this patient
- **Yellow:** in-progress session older than 1 hour (likely abandoned)
- **Red:** patient has been in office but has no kiosk sessions
- **Gray:** not yet seen in person

### 5.5 🔬 Labs

- **Source:** existing `computeLabStatus()` in `lib/patientFormatting.ts:115`
- **Maps directly to the existing 4-state machine:** no-data / current / due-soon / overdue
- No changes to lab logic. This badge just surfaces the existing state in the new layout.

### 5.6 📅 Last Visit

- **Source:** max(`scribe_sessions.created_at`) for this patient, or Healthie appointments if queried
- **Green:** seen in last 90 days
- **Yellow:** seen 90–180 days ago
- **Red:** not seen in 180+ days (Member only — Visit patients expected gap)
- **Gray:** never seen (intake only)

---

## 6. New Intake Defaults (White-Row Patients Only)

When a new patient row is created via any of the 4 intake paths — manual form, Healthie webhook, iPad kiosk, nightly reconciliation cron — and classification fields are missing, the system applies these defaults:

| Field | Default |
|---|---|
| `patient_type` | `visit` |
| `healthie_group_id` | `Sick Visit` (77894) |
| `status` | `Active` (so they appear in active views) |
| `payment_method` | `Healthie` |
| `regimen` | NULL (let tag derivation handle it) |
| `last_lab_date` | NULL |
| `next_lab_date` | NULL |

The row immediately surfaces in the **Unclassified** tab (because it lacks explicit classification work by a human). Staff re-assigns Type/Group when they know what the patient actually is.

**This is the only auto-write the system performs on new rows.** It never changes an existing row.

---

## 7. Deduplication Policy

### 7.1 Detection

Match signals, in priority order:
1. `healthie_client_id` (authoritative if both rows have one)
2. Email (normalized lowercase)
3. Phone (normalized to E.164)
4. Name + DOB exact match

### 7.2 Scoring

When a collision is found, the "keeper" row is the one with the most dependent data:
- Dispenses count
- Scribe sessions count
- Payment transactions count
- QB sales receipts count
- Patient metrics count

### 7.3 Action

**No automated merge.** Candidates appear in an Exceptions view showing keeper vs loser side-by-side with dependency counts. Staff clicks "Merge" to migrate FK references and archive the loser row. The loser is never hard-deleted — it is moved to a `patients_archived` table (requires new migration).

### 7.4 Family Members & Dependents

Patients sharing email or phone but with different DOBs are **not** duplicates. Common pattern: parent and minor child share contact info. The dedup logic must require DOB match for name-based detection.

**Dependent relationship model.** Minors and other dependents get their own `patients` row (each needs their own chart, lab history, and Healthie record). The dependent row links back to the paying/responsible adult via a new `parent_patient_id` column (nullable UUID FK → `patients.patient_id`). This preserves independent charts while making the family tie visible and queryable.

- **Creation:** when staff adds a patient, they can set `parent_patient_id` at intake.
- **Dashboard display:** dependent rows show "Dependent of [Parent Name]" in a small chip; parent rows show a "👨‍👩‍👧 N dependents" badge linking to the children.
- **Billing responsibility:** payment/card on file lives on the parent's record; dependents inherit for ABXTAC-style lockout logic and for receipt routing.
- **De-linking:** when a dependent ages out / becomes their own payer, staff nulls `parent_patient_id`. Never auto-linked or auto-unlinked.
- **Affected current rows:** Leo Aldorasi → Reina Metcalf, Brantley Ross → (parent TBD, appeared on 04-10 intake), Bennett Bunger → Kristen Bunger. These are candidates for relationship set during the one-time audit (§9).

Examples from current data:
- Leo Aldorasi (DOB 2020-10-13) → likely dependent of Reina Metcalf (shares phone `9288309230`)
- Brantley Ross (DOB 2014-06-08) → dependent, parent TBD
- Bennett Bunger (DOB 2018-03-19) → dependent of Kristen Bunger (shares email `kristen@bodyandsoulrd.com`)
- Jaren Lyon → dependent (son) of Keaton Lyon (confirmed 2026-04-16)

### 7.5 Spouses

A new relationship, distinct from dependents. Spouses get their own `patients` row and link via a new `spouse_patient_id` FK (nullable UUID → `patients.patient_id`).

**Critical distinction from §7.4 dependents:**

| | Dependent | Spouse |
|---|---|---|
| Chart | Own chart | Own chart |
| FK column | `parent_patient_id` | `spouse_patient_id` |
| TRT eligibility inheritance | N/A (minors) | **NEVER** — spouse is not auto-enrolled in MensHealth (see §3.6.a) |
| Billing | Parent pays | Each spouse billed separately unless policy explicitly shared |
| Age | Usually minor | Usually adult |

**Why this matters:** When a male NOWMensHealth.Care patient shares contact info (email/phone/GHL contact) with their female spouse, the dedup detector may flag them as duplicates. They are **not duplicates** — they're two distinct patients with one shared GHL contact. Staff links them via `spouse_patient_id` and separates their GHL contacts where possible (one GHL contact per patient is the long-run goal).

**Example — Gannon family (confirmed 2026-04-16):** Greg Gannon (NOWMensHealth.Care, TRT patient) and Keira Gannon (his wife, NOWLongevity.Care if pelleting) share GHL contact `8akTGjkoaHS0vjDbPf4w`. Resolution: (a) link each direction via `spouse_patient_id`, (b) Keira's existing TRT dispenses (2 rows) were data-entry errors — they were given to Greg — and must be **misattribution-corrected** to Greg's chart (§7.6), (c) split the GHL contact so each spouse has their own.

### 7.6 Dispense Misattribution Correction

This is **distinct from duplicate merge**. A duplicate = two rows for one person. A misattribution = a dispense row recorded against the wrong (real) patient.

**Typical case:** data-entry error places a testosterone dispense on a spouse's chart when the pickup was actually the TRT patient's.

**Resolution workflow (admin-only action):**

1. Staff identifies the misattribution (usually flagged by the female-TRT hard block in §3.6.a — "why does Keira have testosterone dispenses?")
2. Admin opens the dispense record, clicks "Reassign Dispense"
3. Modal confirms: original patient, correct patient, **reason required**
4. System re-parents `dispenses.patient_id` to the correct patient
5. Original patient_id logged to a new nullable column `dispenses.corrected_from_patient_id`
6. A corrective entry is written to `dea_transactions` (DEA audit trail integrity)
7. Audit log entry records the admin, timestamp, and reason

**Never automated.** Always admin action with full audit trail. This is a rare operation; it should be prominently distinguished from routine duplicate-merge because the legal/DEA implications of wrongly-attributed controlled-substance dispenses are serious.

---

## 8. Integration Points

### 8.1 Healthie EHR
- Source of truth for all patient demographics, forms, appointments, packages, tags, groups.
- Webhook `app/api/webhooks/healthie/patient-created/route.ts` creates new rows with the defaults in §6.
- Nightly reconciliation cron `app/api/cron/patient-reconciliation/route.ts` catches patients added directly in Healthie.

### 8.2 iPad Kiosk (Staff-Facing)
- In-office patients fill out forms on the iPad.
- `kiosk_form_sessions` records every submission.
- Completion flips the 📝 badge to green.

### 8.3 iOS/Google Play Mobile App (Patient-Facing)
- Patients log in via the Lambda-backed mobile API.
- First login stamps `patients.first_app_login` → flips the 📱 badge to green.
- Mobile app also lets patients sign consents and view forms.

### 8.4 AI Scribe
- `scribe_sessions` records each provider-patient encounter.
- Most recent `created_at` powers the 📅 Last Visit badge.

### 8.5 Stripe / Healthie Billing
- Healthie package presence determines Member status.
- Stripe-Direct is only used for retail/one-off purchases (MindGravity account).

### 8.5.1 Patient Consents (New Table)

A general `patient_consents` table tracks all consent states in one place. Today only `pending_peptide_consents` exists.

Proposed schema:

| Column | Type | Notes |
|---|---|---|
| `consent_id` | uuid PK | |
| `patient_id` | uuid FK → patients | |
| `consent_type` | text (enum) | `hipaa`, `telehealth`, `treatment`, `peptide`, `abxtac_terms` |
| `status` | text (enum) | `pending`, `signed`, `expired`, `withdrawn` |
| `signed_at` | timestamptz nullable | |
| `expires_at` | timestamptz nullable | some consents have term limits |
| `document_id` | text nullable | Healthie doc ID or S3 key for the signed PDF |
| `signed_via` | text | `ipad_kiosk`, `mobile_app`, `web`, `paper_scan` |
| `revoked_at` | timestamptz nullable | |
| `created_at`, `updated_at` | timestamptz | |

**Rules:**
- Consents are **patient-specific** (not family — each dependent signs their own or their legal guardian signs for them)
- For dependents (`parent_patient_id IS NOT NULL` AND patient is a minor), the guardian signs on their behalf → `signed_via = 'ipad_kiosk_guardian'` with a reference to the guardian's consent record
- Expired consents auto-show yellow in the ✍️ badge; never auto-re-signed
- `pending_peptide_consents` migrates to this table; old table archived after backfill

### 8.6 ABXTAC Membership & Auto-Member Discount Policy

ABXTAC is GMH's peptide-and-lab membership program. It has its own Healthie care-line group (`82534`), its own set of Healthie packages, and feeds discount logic used by both the iPad cart and the patient-facing iOS/Google Play app.

#### 8.6.1 ABXTAC Tiers (Authoritative)

Healthie offerings are the source of truth for active tier. Offering IDs are authoritative — do not hard-code tier based on tier name alone.

| Tier | Monthly | Healthie Offering ID | Healthie URL |
|------|---------|---------------------|--------------|
| Heal | $39 | **246743** | https://secure.gethealthie.com/offerings/246743 |
| Optimize | $89 | **246744** | https://secure.gethealthie.com/offerings/246744 |
| Thrive | $179 | **246745** | https://secure.gethealthie.com/offerings/246745 |

All live provider visits are billed **$99 per visit**, separately from the monthly tier. No tier includes live visits.

#### 8.6.2 Unified Discount Matrix

This is the authoritative rule set. Whenever code applies a peptide or lab discount — anywhere, any app, any endpoint — these are the percentages:

| Patient's primary membership | Peptide Discount | Lab Discount |
|------------------------------|------------------:|-------------:|
| None (retail) | 0% | 0% |
| ABXTAC Heal (`246743`) | 10% | 10% |
| ABXTAC Optimize (`246744`) | 20% | 15% |
| **NowPrimary.Care** (any package) | **20% (courtesy)** | **15% (courtesy)** |
| **NowMensHealth.Care** ($140 or $180/mo) | **20% (courtesy)** | **15% (courtesy)** |
| ABXTAC Thrive (`246745`) | 30% | 25% |
| NowLongevity.Care | *TBD — reserved* | *TBD — reserved* |
| NowMentalHealth.Care | *TBD — reserved* | *TBD — reserved* |

**Rules:**
- Highest applicable discount wins (Core Principle #7)
- NowPrimary.Care and NowMensHealth.Care patients receive their courtesy discount **without joining ABXTAC**
- Group stickiness applies (Core Principle #6): a NowMensHealth.Care patient cannot upgrade to ABXTAC Thrive for a higher discount — they remain MensHealth and receive the 20%/15% courtesy rate
- Longevity and MentalHealth are placeholder groups; they receive **0% until pricing is set**

#### 8.6.3 Tier Data Model (Current)

Tiers are stored in the `abxtac_customer_access` table with columns: `email`, `healthie_patient_id`, `tier` (enum: `heal` / `optimize` / `thrive` / `full`), `tier_expires_at` (365-day validity), `provider_verified` (boolean).

Today the tier is assigned *only* via provider-visit verification (`app/api/abxtac/provider-access/route.ts`). There is no link from Healthie package ownership → tier assignment. This is the primary gap this policy fixes.

#### 8.6.4 Auto-Assignment Flow (To Be Built)

```
Healthie package 246743/246744/246745 created for patient
  │
  ├─► Healthie webhook (billing_item.created)
  │      │
  │      ▼
  │   app/api/webhooks/healthie/billing-item-created  [NEW]
  │      │
  │      ▼
  │   Match offering.id → tier (246743=heal, 246744=optimize, 246745=thrive)
  │      │
  │      ▼
  │   UPSERT abxtac_customer_access (email, healthie_patient_id, tier, tier_expires_at = NOW() + 365 days)
  │
  └─► Nightly reconciliation cron [NEW]
         │
         ▼
      Scan Healthie offerings for each patient → catch any webhook misses
```

Tier is never removed automatically. Cancellation/expiration is a staff-reviewed action (same pattern as Inactive status).

#### 8.6.5 Discount Application Surface

The discount must apply in three places. All three must agree.

| Surface | Current State | Required Change |
|---------|--------------|-----------------|
| **iPad cart** (`app/api/ipad/billing/woo-products/route.ts:53` `getPatientDiscount()`) | Applies tier-based discount, but rates are **WRONG** (20/30/40 instead of 10/20/30). Also ignores NowPrimary.Care / NowMensHealth.Care courtesy. | Correct the rates; add care-line courtesy lookup; apply highest-wins rule |
| **Mobile app / Jarvis endpoint** (`app/api/jarvis/peptide-eligibility/route.ts:186`) | Returns `tier` but **does not apply discount** — mobile app shows retail prices | Compute `discount_pct` using the matrix; apply to `availableForShipping[].price`; return `discount_pct` + `member_savings` so UI can show "Your Optimize tier: 20% off" |
| **Checkout** (`app/api/headless/checkout/route.ts:96`) | Charges full retail | Server-side re-validate tier + courtesy, charge discounted amount. **Never trust a client-sent discount value.** |

#### 8.6.6 Known Code Discrepancies Requiring Correction

Flagged during the 2026-04-16 policy design session:

1. **`lib/abxtac-provider-access.ts` `TIER_DISCOUNTS`** — current values `heal: 0.20, optimize: 0.30, thrive: 0.40`. Correct values per this policy: `heal: 0.10, optimize: 0.20, thrive: 0.30`. The iPad cart has been applying inflated peptide discounts. Impact: retroactive revenue reconciliation may be needed — requires a finance review.
2. **`patients.clinic` CHECK constraint** (`migrations/20260108_add_clinic_and_healthie_columns.sql`) — allows only `'nowprimary.care'` and `'nowmenshealth.care'`. Must be broadened to include `'abxtac'`, and ideally `'nowlongevity.care'` / `'nowmentalhealth.care'` for future-proofing.
3. **Mobile app no-discount path** — `app/api/jarvis/peptide-eligibility/route.ts` returns the tier but does not apply it to prices. Patients using the iOS/Google Play app have been charged retail even when entitled to member discounts.
4. **`full` tier ghost** — `lib/abxtac-provider-access.ts` references a `full` tier that is not in the policy. **Remove.** Admin / comp / internal pricing is handled separately via the "admin at-cost %" mechanism and must not pollute the ABXTAC tier enum. After removal, the tier enum is exactly `heal | optimize | thrive` — three values, full stop.

#### 8.6.7 BioBox Lab Inclusion (Thrive Benefit)

Thrive ($179/mo) includes **1 BioBox panel (≤$149) per year**. No implementation exists today. Future work:
- New `abxtac_biobox_entitlements` table: `patient_id`, `granted_at` (= tier_start or anniversary), `redeemed_at` (nullable), `panel_id`
- Jarvis endpoint returns `biobox_available_this_year: boolean`
- Lab-ordering UI shows "Free BioBox — included with your Thrive membership" when available
- Ordering provider: **Dr. Whitten NMD (NPI 1366037806), clinic 22937 Tri-City Men's Health / NOWMensHealth.Care** (per `reference_abxtac_healthie_offerings.md`)

#### 8.6.8 Dashboard Visibility for ABXTAC

Add to the patients page:
- **Tier badge column** — displays `🏷️ Heal` / `🏷️ Optimize` / `🏷️ Thrive` for ABXTAC members, inline near the Regimen column
- **Exceptions view entry:** patients with an active Healthie offering in `(246743, 246744, 246745)` but no `abxtac_customer_access` row — flags webhook misses for staff reconciliation
- **Filter:** "Show ABXTAC members" toggle

#### 8.6.9 ABXTAC Membership Lifecycle & App Lockout

**This is an ABXTAC-only access rule** (Core Principle #8). Other care lines are never locked out of the app for billing reasons.

Extend `abxtac_customer_access` with a `membership_status` column. Allowed values:

| Status | Meaning | App Login | Discount Applied | Set By |
|---|---|---|---|---|
| `active` | Paid and in good standing | ✅ Allowed | ✅ Per tier | Auto on Healthie package activation, OR staff |
| `payment_hold` | Payment failed / card expired / invoice unpaid | 🚫 **BLOCKED** | 🚫 None | Staff (or auto-flag via Stripe/Healthie webhook → staff confirms) |
| `inactive` | Cancelled or staff-removed | ✅ Allowed (read-only, retail prices) | 🚫 None | Staff only |

**Transitions:**

- `active → payment_hold` — triggered by a payment failure event (Stripe subscription failure, Healthie invoice overdue). System **flags** the patient in the Exceptions view; **staff clicks to confirm the hold**. Never automatic — protects against transient gateway errors.
- `payment_hold → active` — staff action after billing resolved.
- `active → inactive` — staff action when patient cancels their ABXTAC package in Healthie.
- No automatic transitions away from `active`. This aligns with Core Principle #2 ("only staff marks Inactive").

**App lockout enforcement:**

The mobile login Lambda must check `abxtac_customer_access.membership_status` before granting a session. If `payment_hold`, return an auth response that triggers the app to show a "Your ABXTAC membership is on billing hold — please contact GMH at [phone]" screen with no further navigation.

Non-ABXTAC patients skip this check entirely — they log in normally regardless of billing state.

**Cancellation flow:**

```
Patient cancels ABXTAC package in Healthie
  │
  ▼
Healthie webhook billing_item.cancelled (or subscription.cancelled) fires
  │
  ▼
System appends row to exceptions_queue: "ABXTAC cancellation — review required"
  │
  ▼
Staff reviews, confirms, sets membership_status = inactive
  │
  ▼
Patient retains app login (can view history, retail prices), loses discount
```

No automatic downgrade. Staff always reviews.

### 8.7 TRT Last-Pickup & Refill Eligibility

Separate from ABXTAC. Applies to **every patient with testosterone dispense history**, regardless of care-line group. The Men's Health mobile app surfaces this to patients directly; the staff dashboard warns before dispensing to an ineligible patient.

#### 8.7.1 Scope

- **Staff warning fires for:** any patient with ≥ 1 prior dispense, when staff attempts a new dispense before they are eligible.
- **Mobile banner shows for:** patients whose Men's Health app dashboard loads (currently the NOWMensHealth.Care app). Non-TRT patients see nothing.
- **First-time dispense:** no warning, no banner. Eligibility only applies after the first pickup.

#### 8.7.2 Eligibility Formula (Volume-Based)

Today's client-side `setMonth(+2)` gets deleted. Replaced with a math-based calculation derived from the actual dispense:

```
days_of_supply   = last_dispense.syringe_count × patient.dose_frequency_days
eligibility_date = last_dispense.dispense_date + days_of_supply
grace_start_date = eligibility_date − 14 days
```

**Worked example** (user-provided):
- 10 mL vial → 16 syringes of 0.5 mL at q4d
- `days_of_supply = 16 × 4 = 64 days`
- Dispensed 2026-02-15 → eligibility_date = 2026-04-20, grace window opens 2026-04-06

**Waste is tracked but not used in this calc** — days-of-supply is determined by doses delivered (syringe_count), not vial volume.

#### 8.7.3 New Patient Field — `dose_frequency_days`

- Column: `patients.dose_frequency_days` (numeric, nullable)
- Typical values: `3.5` (twice weekly — modern default), `7` (weekly), `4` (q4d)
- **Fallback:** if NULL, use system default `3.5`. UI shows an "assumed cadence" subtext so staff knows the calc is estimated.
- Edited by staff on the patient detail page. Entered at intake when provider sets the protocol.

#### 8.7.4 State Machine

| `today` vs. thresholds | State | Mobile Banner | Staff Warning on New Dispense |
|---|---|---|---|
| `today ≥ eligibility_date` | `eligible` | 🟢 "You're eligible for your next pickup" | None |
| `grace_start_date ≤ today < eligibility_date` | `eligible-grace` | 🟢 "Eligible in N days — early pickup OK" | None |
| `today < grace_start_date` | `not-yet` | 🟡 "Last dispense: [date]. Next eligible: [date]" | **Fires** |
| No prior dispense | `first-dispense` | (hidden) | None |

14-day grace window is non-configurable — universal rule.

#### 8.7.5 Staff Warning Modal (Override-Capable)

When `state = 'not-yet'` and staff submits the dispense form, the form intercepts with a modal:

> **⚠ This patient is not yet eligible for a refill.**
>
> Last dispense: 2026-02-15 (37 days ago, 16 syringes @ 0.5 mL q4d)
> Next eligible: 2026-04-20 (24 days from now)
> Grace window opens: 2026-04-06 (10 days from now)
>
> **Reason for early dispense** *(required, pick one):*
> - ☐ Patient traveling / out of town
> - ☐ Running low / accidental spill or loss
> - ☐ Provider dose adjustment
> - ☐ Combined trip — saving patient a drive
> - ☐ Pharmacy supply constraint on next refill window
> - ☐ Other (text required)
>
> [Cancel] [Override and Dispense]

**Override is always permitted.** Staff never hard-blocked — just forced to log why.

Override reason is written to `dispense_history.override_reason` (new column) and also appended to an Exceptions queue: "Early dispense override — [patient] — [reason] — [staff] — [dispense date]" so admin can review patterns.

#### 8.7.6 Mobile App Banner (MensHealth App)

New endpoint: `GET /api/headless/dispense-eligibility?healthieId=X`

Returns:
```json
{
  "applicable": true,
  "state": "not-yet" | "eligible-grace" | "eligible" | "first-dispense",
  "lastDispenseDate": "2026-02-15",
  "nextEligibleDate": "2026-04-20",
  "graceStartDate": "2026-04-06",
  "daysUntilEligible": 10,
  "daysUntilGrace": -4,
  "syringeCount": 16,
  "doseMl": 0.5,
  "cadenceDays": 4
}
```

Banner rendering rules on the MensHealth app home screen:
- **Non-dismissable**, appears near the top of the dashboard
- **Not annoying:** quiet styling, no pulsing, no sound, no red exclamation marks for the yellow state — uses calm medical-grade palette (green `#16a34a` / amber `#d97706`)
- One line primary, one line secondary
- Only rendered if `applicable: true` (non-TRT patients see nothing)

| State | Primary | Secondary |
|---|---|---|
| `eligible` | "You're ready for your next pickup" | (none) |
| `eligible-grace` | "Eligible in N days — early pickup OK" | "You can stop by anytime this week" |
| `not-yet` | "Last dispense: [Mon DD]" | "Next eligible: [Mon DD] (in N days)" |

#### 8.7.7 Refill Signal Badge

Add 💉 to the Signals column (§5), applies regardless of type:

- 🟢 `eligible` or `eligible-grace`
- 🟡 `not-yet` (still inside the pre-grace window)
- 🔴 An override happened in the last 14 days (flag for admin review — indicates under-eligible dispense was approved)
- ⚪ `first-dispense` or non-TRT

#### 8.7.8 Data Model Changes

| Change | Rationale |
|---|---|
| Add `patients.dose_frequency_days NUMERIC` | Need per-patient cadence |
| Add `dispense_history.override_reason TEXT` | Audit trail for early-dispense overrides |
| **Do not add** a separate eligibility cache column | Computed on-the-fly from `dispenses` + `dose_frequency_days`; never stored |
| **Do not modify** the `dispenses` or `dea_transactions` schemas | No changes needed to existing dispense capture |

#### 8.7.9 Code Gaps

See §9 Work Items 33–41 (master list).

---

## 9. Code & Infrastructure Gaps

What already works (no new code needed):

| Item | Where |
|---|---|
| Member/Visit tabs | `PatientTable.tsx:998-1008` |
| Healthie-default payment for new rows | `AddPatientForm.tsx:69` |
| Lookup-driven status/payment/type values | `patient_status_lookup`, `payment_method_lookup`, `client_type_lookup` tables |
| Lab state machine | `lib/patientFormatting.ts:115` |
| `first_app_login` tracking | `app/api/headless/record-app-login/route.ts` |
| Kiosk session tracking | `kiosk_form_sessions` table |
| Healthie forms query | `lib/healthie.ts:1695` |
| Peptide consent tracking | `pending_peptide_consents` table |
| Patient reconciliation cron | `app/api/cron/patient-reconciliation/route.ts` |

What needs new work (in rollout order):

| # | Item | Effort | Blocks |
|---|---|---|---|
| 1 | Add `intermittent` value to `patient_type` + lookup | Tiny (1 SQL) | Tab |
| 2 | Add **Intermittent** tab + **Unclassified** tab | Small | Dashboard UX |
| 3 | Add **Tags** column (read from Healthie) | Small | Visibility |
| 4 | Build `/api/patients/[id]/signals` endpoint aggregating the 6 signals | Medium | Badge column |
| 5 | Add **Signals** column to `PatientTable.tsx` with hover detail | Medium | Badge column |
| 6 | Create `patient_consents` table for HIPAA/telehealth/treatment | Small | ✍️ badge accuracy |
| 7 | Build **Exceptions / Duplicates** view | Medium | Dedup workflow |
| 8 | Add `patients_archived` table + merge action | Medium | Safe merging |
| 9 | Update intake defaults in manual-add + webhook paths | Small | Policy enforcement |
| 10 | Update SOT `INDEX.md` and link this doc | Trivial | Discoverability |
| 11 | **Correct `TIER_DISCOUNTS` in `lib/abxtac-provider-access.ts`** (20/30/40 → 10/20/30) | Tiny | **Revenue correctness** |
| 12 | Broaden `patients.clinic` CHECK constraint to allow `abxtac` + placeholders | Tiny (1 SQL) | ABXTAC filtering |
| 13 | Add care-line-courtesy lookup to `getPatientDiscount()` (NowPC + NowMH = 20%/15%) | Small | Discount correctness |
| 14 | Apply discount + return `discount_pct` in `app/api/jarvis/peptide-eligibility/route.ts` | Small | **Mobile app discount** |
| 15 | Server-side discount re-validation in `app/api/headless/checkout/route.ts` | Small | Checkout correctness |
| 16 | Healthie webhook `billing_item.created` → upsert `abxtac_customer_access` tier | Medium | Auto-assignment |
| 17 | Nightly ABXTAC reconciliation cron (catch webhook misses) | Small | Reliability |
| 18 | Add **Tier badge** column to `/patients` page | Small | ABXTAC visibility |
| 19 | Add Exceptions entry: has ABXTAC offering but no `abxtac_customer_access` row | Small | Data integrity |
| 20 | Remove `full` tier from `lib/abxtac-provider-access.ts` (admin at-cost handles comp pricing separately) | Tiny | Cleanup |
| 21 | **DEFER** — `abxtac_biobox_entitlements` table + redemption UI (Thrive benefit) | Medium | Thrive value delivery |
| 22 | **DEFER** — NowLongevity.Care + NowMentalHealth.Care pricing when product exists | Unknown | New product lines |
| 23 | Create general `patient_consents` table; migrate `pending_peptide_consents` | Small | ✍️ badge accuracy |
| 24 | Add `patients.parent_patient_id` FK (nullable UUID → patients) | Tiny (1 SQL) | Dependent tracking |
| 25 | Dashboard UI for dependent relationships (chip on dependent row, "N dependents" badge on parent) | Small | Family visibility |
| 26 | Add `abxtac_customer_access.membership_status` column + migration default `active` | Tiny | Lockout status |
| 27 | Mobile Lambda login gate — reject login when ABXTAC patient has `membership_status = 'payment_hold'` | Small | **ABXTAC app lockout** |
| 28 | Staff UI: "Put on Payment Hold" / "Cancel ABXTAC" buttons on ABXTAC patient row | Small | Lifecycle mgmt |
| 29 | Healthie webhook `billing_item.cancelled` → queue Exceptions entry for staff review | Small | Cancellation flow |
| 30 | Stripe/Healthie payment-failure webhook → queue Exceptions entry (ABXTAC patients only) | Medium | Payment-hold trigger |
| 31 | Nightly "stale Member" audit cron — flag Members not seen in 90+ days to an Exceptions bucket (flag only, NEVER auto-inactivate) | Small | Data hygiene |
| 32 | One-time classification audit — sweep every patient, populate missing Type/Group/Payment, surface duplicates via existing dedup report | Medium | Launch prerequisite |
| 33 | Create `lib/trtEligibility.ts` — single source of truth for refill eligibility calc | Small | TRT eligibility |
| 34 | Delete client-side `setMonth(+2)` at `PatientTable.tsx:523`; read eligibility from server | Tiny | TRT correctness |
| 35 | Build `/api/headless/dispense-eligibility` endpoint | Small | Mobile banner |
| 36 | Add refill warning modal + override reason picker to `TransactionForm` | Medium | **Staff TRT warning** |
| 37 | Add `dispense_history.override_reason` column migration | Tiny | Audit trail |
| 38 | Add 💉 Refill badge to Signals column | Small | Visibility |
| 39 | Men's Health app banner UI (green/amber, non-dismissable) on dashboard | Medium (app-side) | **Patient TRT banner** |
| 40 | Exceptions view entry for early-dispense overrides | Small | Admin oversight |
| 41 | Add `patients.dose_frequency_days NUMERIC` column + patient edit UI | Small | Per-patient cadence |

---

## 10. Open Decisions Requiring Phil's Call

### Still Open

None. All design questions are resolved. This policy is ready for implementation starting at Phase 1.

### Resolved During 2026-04-16 Session

- ✅ **Member vs Intermittent vs Visit rule** — "If package then Member" (mechanical)
- ✅ **Group stickiness** — patients cannot switch care-line groups (staff-only)
- ✅ **Courtesy discount scope** — NowPrimary.Care + NowMensHealth.Care get 20%/15% automatic; NowLongevity.Care + NowMentalHealth.Care deferred until pricing exists
- ✅ **Discount stacking** — highest wins, never stack
- ✅ **ABXTAC tier discount rates** — Heal 10%/10%, Optimize 20%/15%, Thrive 30%/25% (peptides/labs)
- ✅ **Consent table scope** — build a general `patient_consents` table with types: HIPAA, telehealth, treatment, peptide, abxtac_terms (see §8.5.1)
- ✅ **Dependents handling** — own `patients` row with `parent_patient_id` FK; dashboard shows relationship chips; staff manually links at intake (see §7.4)
- ✅ **90-day stale-member audit** — nightly cron flags stale Members to an Exceptions bucket for staff review. **Flag only — never auto-inactivate** (Core Principle #2)
- ✅ **Tab ordering** — `All | Members | Intermittent | Visits | Unclassified`. Unclassified sits at the far right; count label turns amber when > 0 so it's still visible without hijacking the primary flow
- ✅ **"White row" definition** — (a) any row missing Type / Group / Payment. A **one-time classification audit** is required at policy rollout: sweep every patient, populate missing classification fields where obvious, surface ambiguous cases to staff, re-run the dedup report, resolve duplicates. This is Work Item #32
- ✅ **Historical discount reconciliation** — no retroactive action. Absorb the loss. Historical orders were primarily testing/bug-working. Fix forward only
- ✅ **Cancelled ABXTAC handling** — new `membership_status` column with values `active` / `payment_hold` / `inactive`. Cancellation → staff sets `inactive`. Payment failure → staff sets `payment_hold`. `payment_hold` blocks mobile app login (ABXTAC-only — see Core Principle #8 and §8.6.9)
- ✅ **`full` tier** — **remove from `lib/abxtac-provider-access.ts`.** Admin / comp / internal pricing is handled separately via the "admin at-cost %" mechanism, not through an ABXTAC tier. The `full` string is legacy and should not appear in the tier enum

---

## 11. Rollout Plan (Proposed Sequence)

**Phase 0 — Documentation (this doc).** No code, no mutations. Approved policy is the prerequisite for everything below.

**Phase 1 — Foundation (1–2 hours of work).**
- Add `intermittent` to `patient_type` lookup
- Add `Unclassified` and `Intermittent` tabs to the patients page in order: `All | Members | Intermittent | Visits | Unclassified`
- Add `Tags` column reading from Healthie
- Broaden `patients.clinic` CHECK constraint to allow `abxtac` / `nowlongevity.care` / `nowmentalhealth.care`
- Add `patients.parent_patient_id` FK (nullable) — enables dependent tracking from day one

**Phase 2 — ABXTAC Discount Correctness (HIGH PRIORITY — revenue impact).**
- Correct `TIER_DISCOUNTS` in `lib/abxtac-provider-access.ts` (10/20/30)
- Add care-line-courtesy logic to `getPatientDiscount()` (NowPC + NowMH = 20%/15%)
- Apply highest-wins rule
- **Verify in a staging/test flow before deploying — the current wrong rates have been live**
- Produce a reconciliation report of historical orders affected, hand to Phil for finance review before changing anything customer-facing

**Phase 3 — Mobile App Discount (the user's primary ask).**
- Modify `app/api/jarvis/peptide-eligibility/route.ts` to apply discount + return `discount_pct` + `member_savings`
- Server-side discount re-validation in `app/api/headless/checkout/route.ts`
- Test with a real ABXTAC member account before shipping the app update

**Phase 4 — ABXTAC Tier Auto-Assignment & Lifecycle.**
- Add `abxtac_customer_access.membership_status` column (default `active`)
- Healthie webhook `billing_item.created` → upsert `abxtac_customer_access` (status `active`)
- Healthie webhook `billing_item.cancelled` → queue Exceptions entry (staff sets `inactive`)
- Stripe/Healthie payment-failure webhook → queue Exceptions entry (staff confirms `payment_hold`)
- Mobile Lambda login gate — reject login for `payment_hold` ABXTAC patients (non-ABXTAC patients unaffected)
- Staff UI: "Put on Payment Hold" / "Cancel ABXTAC" buttons on ABXTAC patient rows
- Nightly reconciliation cron (catch webhook misses)

**Phase 5 — Signals API (half day).**
- Build `/api/patients/[id]/signals` endpoint
- Add `/api/patients/signals/bulk` for the table view

**Phase 6 — Signals UI (half day).**
- Add the Signals column + Tier badge column
- Hover/click detail
- "Missing signals" filter

**Phase 7 — Consents & Dependents (new work).**
- `patient_consents` table migration (HIPAA, telehealth, treatment, peptide, abxtac_terms)
- Migrate `pending_peptide_consents` into new unified table
- Consent badge logic powered by unified table
- Dashboard UI for dependent relationships — dependent chip ("Dependent of …"), parent badge ("N dependents")

**Phase 7b — TRT Refill Eligibility.**
- Add `patients.dose_frequency_days` column + `dispense_history.override_reason` column
- Create `lib/trtEligibility.ts` (formula: `syringe_count × dose_frequency_days`, 14-day grace)
- Delete client-side `setMonth(+2)` in `PatientTable.tsx:523`, pipe server computation to UI
- Warning modal + override reason picker in `TransactionForm`
- Build `/api/headless/dispense-eligibility` endpoint
- Men's Health mobile app banner (green/amber, non-dismissable, quiet styling)
- 💉 Refill signal badge
- Exceptions view entry for overrides
- **Verify against real dispense data in staging before deploy** (one bug here = mis-stated eligibility to every TRT patient)

**Phase 8 — Dedup & Stale-Member Hygiene (new work).**
- Exceptions view (covers: dedup candidates, ABXTAC cancellation, ABXTAC payment fail, stale Members, webhook misses)
- `patients_archived` table + merge action
- Nightly "stale Member" audit cron (≥ 90 days without a visit → flag only, never auto-inactivate)

**Phase 9 — One-Time Classification Audit (launch-gate work).**
- Sweep all 398 existing patients
- Populate missing Type / Group / Payment where unambiguous
- Flag ambiguous cases into the Unclassified tab for staff review
- Re-run `patient-dedup-report` and resolve the duplicates already catalogued in `.tmp/patient-dedup-report-2026-04-15.md`
- Set `parent_patient_id` on identified dependents (Leo→Reina, Bennett→Kristen, etc.)

**Phase 10 — Ongoing Classification.**
- Staff works the Unclassified queue as new patients land there
- System never auto-classifies

**Deferred (no timeline):**
- BioBox Thrive entitlement tracking
- NowLongevity.Care / NowMentalHealth.Care pricing (when product exists)

---

## 12. Success Criteria

This policy is successful when:

1. Every new patient appears correctly classified within 24 hours of creation, or in the Unclassified tab.
2. No existing patient's classification changes automatically.
3. Staff can identify "who needs attention" in under 10 seconds per row by scanning the Signals column.
4. Duplicate candidates never auto-merge; they always go through the Exceptions view.
5. The `/patients` page answers "who is this patient to us, and are they on track?" without the staff member opening the patient detail page.

---

## 13. Related Documents

- `docs/sot-modules/22-brand-group-architecture.md` — brand/group canonical IDs
- `reference_healthie_tags_vs_groups.md` (auto-memory) — tag/group mappings
- `reference_abxtac_healthie_offerings.md` (auto-memory) — ABXTAC offering IDs + tier benefits
- `feedback_healthie_source_of_truth.md` (auto-memory) — Healthie-wins rule
- `feedback_test_healthie_fields_first.md` (auto-memory) — verify Healthie queries before deploy
- `feedback_kiosk_submit_gotchas.md` (auto-memory) — UUID / user.user_id / String-vs-ID pitfalls
- `.tmp/patient-dedup-report-2026-04-15.md` — current duplicate inventory
- `.tmp/patient-audit-report.md` — current linking state (5075 Healthie-only, 41 broken links)
