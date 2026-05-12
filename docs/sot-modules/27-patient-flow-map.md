# Patient Flow Map (Stage-Oriented) — DRAFT v1

> **Status:** DRAFT, awaiting Phil review (2026-04-24)
> **Companion docs:**
> - `docs/PATIENT_WORKFLOWS.md` — care-line view (Men's Health / Weight Loss / Primary Care)
> - `docs/sot-modules/25-patient-classification-and-dashboard.md` — classification rules (member/intermittent/visit)
> - `docs/sot-modules/15-integration-endpoints.md` — system endpoints
>
> **What this is:** the stage-oriented map of a patient's lifecycle from lead to off-service, defining at every stage which system is the source of truth, what GHL is responsible for, what the dashboard is responsible for, what staff does manually, and what moves the patient to the next stage. Every cron, webhook, and UI flow should cite a row in this table.
>
> **What this is not:** a care-line workflow (see PATIENT_WORKFLOWS.md) or a classification policy (see sot-modules/25). Those answer "what happens for TRT vs GLP-1" and "what counts as a member." This answers "where in the patient journey are we, and which system owns what."

---

## Core Architectural Decision (2026-04-24)

**Healthie is the source of truth for membership and recurring billing.** GHL is the send layer (SMS/email/template execution). The dashboard + Lambda are the orchestrators (state machine, branching, audit, staff workspace). QBO and Jane are sunsetting as recurring billing systems — all recurring charges migrate to Healthie.

**GHL workflow design rule:** build **one workflow per channel** (Send SMS, Send Email, Create Task, Add Tag) — each is a dumb webhook receiver that takes a payload and executes one action. Branching, protocol logic, per-patient/per-protocol decisions live in Lambda or dashboard code where they can be version-controlled, tested, and audited. The workflow node graph is a deploy target, not a source of truth. If you ever need many similar workflows (per-patient, per-protocol), build a template once, clone via UI, parameterize through custom values + webhook payloads — never generate workflow graphs.

**Auto-classification rule:** patient classification (member / intermittent / visit) is derived mechanically from Healthie state — never manually toggled in the dashboard. Staff only marks `inactive`; everything else is computed.

| Concern | System | Why |
|---|---|---|
| Membership truth | Healthie `recurringPayments(user_id)` | Drives all member-only logic |
| Patient classification | Dashboard (computed from Healthie) | Derived, not stored canonical |
| Staff workspace / audit | Dashboard | Single pane of glass |
| Lead capture | GHL | Native CRM strength |
| Outbound SMS / email | GHL | Cheap, reliable, deliverability |
| Appointment scheduling | Healthie | Provider calendars are there |
| Recurring billing | Healthie | One destination |
| One-off retail charges | Direct Stripe (MindGravity) | Orthogonal hybrid; stays |
| Pro-bono | Dashboard `billing_source = pro_bono` | Legitimate no-charge category |

---

## Entry Point Catalog (every way a patient enters)

A patient can enter the GMH system through **25+ distinct paths** that fan into Stages 1 (Lead) or 2 (Booked). The path determines which system gets the FIRST record and how much manual translation is needed.

### Entry-point taxonomy

| Path | First-touch system | Brand | Auto-chain to all 3 systems? | Stage of entry |
|---|---|---|---|---|
| **A. ABXTac website booking** (`/api/abxtac/book`) | Healthie + dashboard + GHL all created in one flow | ABXTac | ✅ FULL — only path that does this today | Stage 2 (booked) |
| **B. ABXTac WooCommerce order webhook** | Existing ABXTac patient (links by email) | ABXTac | ✅ Yes (assuming patient exists from path A) | Stage 6 (active member ordering) |
| **C. Brand website lead form** (TRTNow / NOW MH / NOW PC / NOW Longevity) | GHL contact only | Mixed by form | ❌ NO — GHL contact sits in CRM until staff manually creates dashboard + Healthie patient | Stage 1 (lead) |
| **D. GHL ad funnel (FB / Google / TikTok)** | GHL contact only | Mixed by funnel | ❌ NO — same as C | Stage 1 (lead) |
| **E. GHL inbound SMS** (`/api/webhooks/ghl/messages`) | GHL message logged; contact may already exist | All brands | ❌ Partial — message orphans if contact has no dashboard patient | Stage 1 or any later |
| **F. GHL inbound phone call** | GHL contact (call logged) | All brands | ❌ NO — staff must translate | Stage 1 |
| **G. GHL inbound voicemail** | GHL message + transcript | All brands | ❌ NO — staff triage | Stage 1 |
| **H. Healthie webhook: patient created** (`/api/webhooks/healthie/patient-created`) | Healthie → auto-syncs to dashboard | Determined by Healthie group ID | ✅ Healthie+dashboard auto. GHL sync NOT automatic | Stage 2 (if appt also booked) or Stage 1.5 |
| **I. Healthie webhook: appointment updated** | Existing Healthie patient | ABXTac auto-handled; other brands ignored | Partial: only ABXTac gets GHL tag updates | Stage 2 → 3 |
| **J. iPad kiosk new-patient submit** (`/api/ipad/kiosk/submit`) | Dashboard + Healthie | MH / PC clinic | ✅ Dashboard+Healthie auto. GHL NOT touched | Stage 2 (in-clinic walk-up) |
| **K. Staff manual create in dashboard** (`/api/patients` POST) | Dashboard + Healthie + GHL | Any | ✅ Dashboard+Healthie+GHL chain (GHL is fire-and-forget async) | Stage 1 or 2 depending on what staff fills |
| **L. Staff manual create directly in Healthie UI** | Healthie → webhook H syncs to dashboard | Any | ✅ Healthie+dashboard. GHL NOT auto | Stage 1.5 |
| **M. Staff manual create directly in GHL UI** | GHL contact only | Any | ❌ NO — must staff-create downstream too | Stage 1 |
| **N. Mobile app login** (`/api/headless/record-app-login`) | Existing dashboard patient (lookup, no create) | All | N/A — read-only path; assumes patient exists | Any active stage |
| **O. Doctor / partner referral** | Variable — depends on whether partner uses Healthie or sends a contact | Any | ❌ Manual, no consistent path | Stage 1 |
| **P. Referral link / UTM-tagged web form** | GHL contact (UTM stored) | Mixed | ❌ Same as path C | Stage 1 |
| **Q. Email triage system** (`scripts/email-triage/`) | GHL task or email queue | Any | ❌ No patient creation; staff triages | (pre-Stage 1 surface area) |
| **R. Inbound fax** (`fax_pdf_processor.py`) | S3 PDF + staff notification | Any | ❌ No patient creation | (pre-Stage 1) |
| **S. Healthie lab-order webhook** (`/api/webhooks/healthie/lab-order`) | Existing Healthie patient | Any | ✅ Updates existing record only | Stage 6 |
| **T. SimonMed lab results** | Existing Healthie patient | MH/PC | ✅ Pushes to Healthie directly | Stage 6 |
| **U. UPS shipment tracking** | Existing ABXTac patient | ABXTac | ✅ Updates existing record only | Stage 6 |
| **V. Batch import scripts** (`backfill-patients-from-healthie.ts`, `auto-link-healthie.ts`) | Dashboard (bulk upsert) | Any | ❌ No GHL sync; staff/cron catches up later | Pre-existing patients |
| **W. ABXTac password handoff** (subset of path A) | GHL custom field with temp password | ABXTac | N/A — auth flow | Stage 5 (onboarded) |

### Stage-1 / Stage-2 funnel summary

| First-touch system | Paths feeding it | Auto-chain to membership? |
|---|---|---|
| **GHL only** | C, D, E, F, G, M, P | ❌ Manual translation required |
| **Healthie only** | H, L | ❌ GHL not auto-linked |
| **Dashboard only** | V (batch) | ❌ GHL + Healthie sync not always run |
| **All 3 systems together** | A (ABXTac), K (staff create) | ✅ Auto |
| **iPad kiosk → Dashboard + Healthie** | J | Partial (no GHL) |

**Key insight:** **Path A (ABXTac website booking) is the ONLY path that auto-chains all 3 systems.** Every other entry point either creates orphans or requires staff to manually translate the patient across systems.

### Orphan flows + duplicate risks (from this audit)

1. **GHL-only orphans** (paths C/D/M/P): a lead lands in GHL and never makes it to the dashboard or Healthie unless staff manually re-creates them. Lead-source attribution loss + double-data-entry risk.
2. **Healthie-only orphans** (paths H/L): a patient created in Healthie syncs to the dashboard via webhook H but does NOT auto-create a GHL contact. SMS/email marketing then can't reach them.
3. **Dashboard-only orphans** (path V): batch-imported patients don't always get GHL sync; cron eventually catches up but the gap is unmonitored.
4. **GHL-message-without-patient**: inbound SMS/call/voicemail logged in GHL but no linked dashboard patient → message is invisible to clinical staff using the dashboard.
5. **Cross-path duplicates**: same person can enter via path C (lead form → GHL) AND later path K (staff-creates in dashboard) without staff knowing the GHL contact exists. Dashboard's duplicate check looks at dashboard + Healthie but NOT GHL.
6. **Source attribution inconsistency**: source is stored in `patients.source_tag` (column), GHL custom fields (per-contact), Healthie group ID (per-care-line), and tags. No single field is canonical.
7. **NOW Longevity has no dedicated entry path**: it shares Primary Care's GHL location and routes through PC's forms. Brand attribution depends entirely on form config + tags, both fragile.
8. **Mobile app is read-only**: a patient who downloads the app but isn't already in the dashboard hits a dead end. No self-signup flow.

These 8 gaps directly inform the hardening plan: lead-source automation (Phase 7), unified entry-point handler (new candidate phase), GHL-side duplicate check (extension to Phase 1), and source-attribution column standardization (Phase 3 dependency).

---

## The 8 Stages

| # | Stage | One-Line Definition |
|---|---|---|
| 1 | **Lead** | Captured contact, not yet booked an evaluation |
| 2 | **Booked** | Has a scheduled evaluation/appointment in Healthie |
| 3 | **Intake** | Booked + forms/labs/payment pending before visit |
| 4 | **Evaluated** | Provider has seen them; treatment decision made |
| 5 | **Onboarded** | Placed on Healthie recurring (or pro-bono) — first charge cleared |
| 6 | **Active** | Paying member receiving recurring services |
| 7 | **At-risk** | Active but flagged: payment failed, lab overdue, missed visit, drift |
| 8 | **Off-service** | Staff-marked inactive — Healthie recurring canceled, no further billing |

A patient can also be **Intermittent** (visit-only, no recurring) or **Visit** (single encounter) — those are classification states, not flow stages. They live "outside" the active member loop and are handled per sot-modules/25.

---

## Per-Stage Map

### Stage 1 — Lead
- **Entry trigger:** GHL form submission, ad funnel capture, manual contact add, referral
- **SOT system:** GHL (contact record)
- **GHL role:** Capture, tag with care line, run nurture sequence (drip SMS/email), book-an-eval CTAs
- **Dashboard role:** None today (read-only view of lead pipeline if surfaced)
- **Staff actions:** Respond to inbound, qualify, push to book
- **Healthie state:** Does not exist yet
- **Exit criteria:** Patient books an evaluation in Healthie → Stage 2
- **🔴 KNOWN GAP (confirmed Phil 2026-04-24):** GHL does NOT reliably tag lead source (ad / referral / form). Staff manually re-tags into Healthie at booking time. **Automation candidate:** capture source on the GHL contact at lead-creation time, persist on the dashboard `patients` row when the contact graduates to Stage 2, and propagate to Healthie via `patient.tags` automatically.

---

### Stage 2 — Booked
- **Entry trigger:** Healthie appointment created (via Healthie scheduler, dashboard intake form, or staff manually)
- **SOT system:** Healthie (appointment), Dashboard (patient row created/linked)
- **GHL role:** Receives webhook → tag patient `booked` → confirm-and-prep sequence
- **Dashboard role:** Create/link `patients` row, set `status_key='active_pending'`, ensure `healthie_id` populated, send appointment reminders cron
- **Staff actions:** Confirm insurance/payment expectations, send intake forms via Healthie
- **Healthie state:** Patient exists, appointment scheduled, no recurring package
- **Exit criteria:** Forms returned + payment-on-file + labs ordered (where required) → Stage 3
- **Risk flags:** No-show, no forms, no payment 24h before visit

---

### Stage 3 — Intake
- **Entry trigger:** Patient is Booked AND eval is in <72h (or staff manually advances)
- **SOT system:** Healthie (forms, labs, payment method)
- **GHL role:** Reminder cadence (T-72h, T-24h, T-2h), missing-item nags
- **Dashboard role:** Morning-prep cron flags incomplete intake; iPad "Today" tab shows readiness
- **Staff actions:** Chase missing forms/labs, collect payment method
- **Healthie state:** Intake form submitted, payment method on file, lab orders out
- **Exit criteria:** Provider sees patient → Stage 4

---

### Stage 4 — Evaluated
- **Entry trigger:** Healthie appointment marked complete (provider note signed)
- **SOT system:** Healthie (chart note, treatment plan)
- **GHL role:** Post-eval follow-up sequence (decision pending → onboarding hand-off)
- **Dashboard role:** Show in "needs onboarding" queue if no recurring exists yet but treatment plan was made
- **Staff actions:** Translate provider plan → Healthie package selection; explain price/cadence; send Healthie billing link
- **Healthie state:** Chart note signed; **package not yet active**
- **Exit criteria:** First Healthie recurring charge clears (or pro-bono explicitly assigned) → Stage 5
- **Branch — declines treatment:** classification stays `visit`, exits the recurring loop (still in dashboard, not billed)
- **🔴 KNOWN GAP — "No Man's Land" (confirmed Phil 2026-04-24):** the time between Stage 4 (provider signs treatment plan) and Stage 5 (Healthie recurring active) has **no orchestrated handoff**. Staff manually translates plan → Healthie package; no system tracks this as a discrete WIP queue. Dropped handoffs = revenue leak + patient frustration. **This is the single highest-leverage automation target in the whole flow map.**
  - **What's missing:** a "Pending Onboarding" queue on the dashboard, fed by `(Healthie chart note signed in last 14d) AND (no active Healthie recurring)`, with SLA timer + assignee, and an automated GHL nudge cadence to the patient (T+1d, T+3d, T+7d) until they're on a package or explicitly declined.
  - **Hand-off automation idea:** structured "treatment plan" capture in the chart note (or a tiny dashboard form the provider fills) → triggers Healthie package suggestion + billing link send via GHL → staff confirms/closes the loop. Removes the manual translation step.

---

### Stage 5 — Onboarded
- **Entry trigger:** Healthie `recurringPayments` for patient transitions to active state with at least one successful charge
- **SOT system:** Healthie (`recurringPayments`)
- **GHL role:** Welcome series (brand-specific), set tags for active member, enable promo channel (per consent)
- **Dashboard role:**
  - Reconciliation cron auto-classifies patient as `member` (rule from sot-modules/25)
  - Sets `billing_source` to matching enum (`healthie_recurring`)
  - Triggers welcome workflow via GHL tag
- **Staff actions:** Confirm app login (mobile/iPad), confirm shipping address, set first refill cadence
- **Healthie state:** Active recurring package, first charge cleared
- **Exit criteria:** First refill or first month complete → Stage 6
- **Risk flags:** First charge fails (back to Stage 4 with `hold_payment_research`)

---

### Stage 6 — Active
- **Entry trigger:** ≥1 successful recurring cycle complete
- **SOT system:** Healthie (recurring + appointments) + Dashboard (dispenses, vial inventory, refills)
- **GHL role:** Refill nudges, lab-due reminders, retention campaigns, win-back if at-risk
- **Dashboard role:**
  - Daily reconciliation: confirm Healthie recurring still active
  - Refill eligibility per care line (TRT: see sot-modules/25 §TRT Refill Eligibility)
  - Dispense tracking, vial FIFO, controlled-substance log
- **Staff actions:** Routine — process refills, schedule follow-ups, manage labs
- **Healthie state:** Active recurring, regular appointments, lab cadence
- **Exit criteria:** Any risk flag fires → Stage 7, or staff-initiated cancel → Stage 8

---

### Stage 7 — At-risk
- **Entry trigger:** Any of:
  - Healthie payment declined (`status_key → hold_payment_research` auto)
  - Lab overdue past care-line threshold
  - Missed required follow-up
  - Recurring paused/canceled in Healthie
  - Manual `hold_patient_research` by staff
- **SOT system:** Healthie (declined charge, paused state) + Dashboard (audit flag)
- **GHL role:** Reactivation sequence (payment update link, lab booking link) — gated by reason
- **Dashboard role:**
  - At-risk widget on CEO/Today tab
  - Weekly reconciliation email to admin@granitemountainhealth.com (per hardening plan decision)
  - Inactive notification (Phase 1 deliverable) when staff manually marks
- **Staff actions:** Resolve root cause (call patient, re-bill, rebook lab, talk to provider)
- **Exit criteria:**
  - Resolved → back to Stage 6
  - Unresolved + staff decision → Stage 8
- **HARD RULE:** Never auto-flip to `inactive`. Cron flags only; humans decide.

---

### Stage 8 — Off-service
- **Entry trigger:** Staff marks `status_key='inactive'` (manual action, never automated)
- **SOT system:** Healthie (recurring canceled) + Dashboard (`inactive` status)
- **GHL role:** Removed from active tags; eligible for win-back nurture only
- **Dashboard role:**
  - Inactive notification fires (Phase 1)
  - Confirm Healthie recurring is canceled in same flow — warn if still active
  - Confirm external billing (QBO/Jane legacy) is canceled
  - Continue to retain chart for compliance; no billing
- **Staff actions:** Cancel Healthie recurring, cancel any QBO/Jane recurring (during sunset), document reason
- **Exit criteria:**
  - Returns and re-onboards → Stage 4 (with prior history visible)
  - Stays off → terminal state
- **🔴 KNOWN GAP — Inactive without cancel-check (confirmed Phil 2026-04-24):** today, when staff marks `inactive`, NOTHING verifies that the Healthie recurring was also canceled. A patient can be marked inactive and continue to be charged. **Phase 1 deliverable:** when status flips to `inactive`, the dashboard MUST query Healthie `recurringPayments(user_id)` and either (a) auto-cancel it in the same transaction, or (b) block the status change with a "cancel Healthie recurring first" error, or (c) at minimum send a loud notification to admin@ and Telegram. Phil's preference: option (b) — force the staff to cancel Healthie before they can mark inactive, so the two facts can never disagree.

---

## Cross-Stage Concerns

### What kicks off when (orchestration map)

| Event | Cron / Webhook | Stages affected | What it does |
|---|---|---|---|
| Healthie patient created | webhook | 1→2 | Create/link `patients` row |
| Healthie appointment created | webhook | 2 | Tag in GHL, set `active_pending` |
| Healthie recurring activated | webhook (or recon cron) | 4→5 | Auto-classify member, fire welcome |
| Healthie recurring canceled | webhook (or recon cron) | 6→7 or 6→8 | Flag at-risk; if staff also marked inactive, mark off-service |
| Healthie payment declined | webhook | 6→7 | Set `hold_payment_research` |
| Daily 6am | morning-prep cron | 2,3,7 | Today's prep, missing items, at-risk list |
| Daily | patient-reconciliation cron | all | Verify status_key vs Healthie state, flag drift |
| Weekly Mon 8am | billing-recon cron *(planned, hardening Phase 3)* | 5,6,7,8 | Email admin@ with payer reconciliation |

### What the dashboard owns vs Healthie vs GHL

| Concern | Owner | Why |
|---|---|---|
| `status_key` value | Dashboard (writes), Healthie (informs) | Audit trail, staff workspace |
| `billing_source` enum | Dashboard | Healthie doesn't model legacy billing |
| Membership classification | Dashboard (derived) | Mechanical from Healthie |
| Welcome / nurture send | GHL | Best send infra |
| Tags that drive GHL workflows | Dashboard writes via GHL API | Orchestration in code, send in GHL |
| Workflow logic itself | Lambda / dashboard code | Branching, gating, protocol logic — version-controlled, testable, auditable |
| GHL workflow nodes | GHL UI — **one per channel, not per scenario** | "execute SMS", "execute email", "create task". Dumb webhook receivers. Deploy target, not source of truth |
| Appointment / chart / Rx | Healthie | Clinical SOT |
| Recurring billing | Healthie | Single destination |
| Retail one-off | Direct Stripe | Orthogonal |
| Inventory / dispense / DEA | Dashboard | Built in-house |

### Migration overlay (during QBO/Jane sunset)

A patient on legacy billing (`billing_source IN ('qbo_legacy','jane_legacy','primecare_legacy','ins_supp_legacy')`) sits in Stage 6 (Active) but is also flagged on the **migration tracker** (hardening plan Phase 4). The migration tab makes the legacy → Healthie transition visible and fast. Once the patient is on `healthie_recurring`, they drop off the migration tracker automatically.

---

## Open Questions (for Phil)

1. ~~**Lead → Booked attribution.**~~ ✅ Answered 2026-04-24: GHL does NOT reliably tag source; staff manually re-tags. Automation = capture source at lead creation, propagate forward. See Stage 1 KNOWN GAP.
2. ~~**Stage 4 → Stage 5 hand-off.**~~ ✅ Answered 2026-04-24: staff manually converts; no orchestrated handoff exists. "No Man's Land" between provider visit and recurring package. Highest-leverage automation target. See Stage 4 KNOWN GAP.
3. ~~**At-risk thresholds.**~~ ✅ Answered 2026-04-24 (partial): Phil clarified GHL workflows are no longer used for tracking. Clinical lab-overdue + missed-followup thresholds per care line are still TBD — answer separately when defining the at-risk cron.
4. ~~**Off-service same-flow cancel.**~~ ✅ Answered 2026-04-24: NO check today. Phase 1 deliverable. Preferred solution: BLOCK the inactive flip until Healthie recurring is canceled. See Stage 8 KNOWN GAP.
5. ~~**GHL workflow sprawl.**~~ ✅ Answered 2026-04-24: scorched-earth decision — disable all current GHL workflows EXCEPT SMS workflows connected to iPad system. Rebuild fresh from the per-channel atomic-receiver pattern. See "GHL Reset Plan" section below.

---

## GHL Reset Plan (decided 2026-04-24)

Phil's decision: **disable all current GHL workflows except the SMS workflows connecting to the iPad system. Start fresh.**

This is enabled by the fact that Phil no longer uses GHL for anything that tracks patient state — Healthie + the dashboard are now SOT for everything that matters. GHL's only job going forward is "send a message via this channel when called."

**Steps (when greenlit):**
1. **Inventory** — pull all workflows across the 4 sub-accounts (Men's Health, Primary Care, ABXTac, Longevity) and list by name, status, last-run timestamp.
2. **Identify keep-list** — the iPad-connected SMS workflows. Need Phil to point at the specific ones (or look at iPad code that calls GHL).
3. **Disable everything else** — flip to "Inactive" in the GHL UI (NOT delete, so we have a graveyard if we need to reference old logic).
4. **Build the new minimal set** — per the "one workflow per channel" pattern: `Send SMS`, `Send Email`, `Create Task`, `Add/Remove Tag`. Per sub-account.
5. **Wire dashboard/Lambda** — orchestration code calls those receivers with payloads. Branching, eligibility, and protocol logic all live in code.
6. **Document** — add the kept iPad SMS workflows + new minimal set to `docs/sot-modules/23-ghl-ai-agents.md` (or split into a new module if it grows).

**Ordering note:** the iPad SMS workflow keep-list MUST be confirmed before disabling anything, or we break the iPad system. This is the only blocker before step 3.

---

## Implementation Implications

Once this map is locked, the next steps follow naturally:

1. **Phase 1 (hardening plan)** — Inactive notification belongs at Stage 8 entry; bug fixes mostly live in Stage 6 reconciliation.
2. **Phase 4 (hardening plan)** — Migration tracker is a filtered view of Stage 6 patients with legacy `billing_source`.
3. **Auto-classification** — Stage 5 trigger and Stage 7→8 manual-only rule encode the classification policy mechanically.
4. **GHL tag schema** — every tag the dashboard writes must map to a stage transition above; rogue tags get pruned.
5. **Cron audit** — every existing cron should cite which stage(s) it serves; orphan crons flagged for retirement.

---

*v1 drafted 2026-04-24. Awaiting Phil's review and corrections before locking.*
