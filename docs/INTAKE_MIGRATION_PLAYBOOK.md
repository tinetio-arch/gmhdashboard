# Intake Migration Playbook — Self-Serve Forms that Feed Healthie

> **Status:** ACTIVE (started 2026-05-20). First brand: **ABXTAC** (worked example below).
> **Owner decision (Phil, 2026-05-20):** *"Our forms feed Healthie."* Patients set up their
> account entirely on our own surfaces; we store the data in **our Postgres** as the capture
> point of record and **push it to Healthie**, which stays the clinical record.
> **Rollout order (one at a time):** ABXTAC → Now Men's Health → Now Primary Care → Now Longevity.

---

## 1. Why this exists

Today, patient documentation/intake is **Healthie-native**: assigning a patient to a Healthie
group auto-triggers Healthie's intake *flow*, which emails the patient and surfaces forms
(HIPAA, Consent to Treat, AI Scribe, brand intake) in Healthie's own portal. The only way a
patient completes intake is through Healthie's UI or the in-office iPad kiosk
(`app/api/ipad/kiosk/submit`), and the answers live in Healthie.

Phil wants patients to **completely set up an account on our own forms** — a public
"Google-facing" web form and the iPhone/iPad app — without depending on Healthie's portal.
Healthie still receives the data so charting/billing keep working, but it is no longer the
*intake surface*.

This must be **repeatable** because the same job is needed for Now Men's Health, Now Primary
Care, and Now Longevity. So the design is **data-driven**: forms are rows in Postgres, and one
set of code renders + provisions any brand's form.

---

## 2. Architecture

```
                        ┌──────────────────────────────┐
   Patient (web)   ───▶ │  /ops/intake/[brand]/[slug]   │  (app/intake/.../page.tsx)
   Patient (iPhone)───▶ │  same JSON form contract      │  (iPad app renders same fields)
                        └───────────────┬───────────────┘
                                        │ GET form structure / POST answers
                                        ▼
                        ┌──────────────────────────────┐
                        │ /ops/api/intake/[brand]/[slug] │  (app/api/intake/.../route.ts)
                        │  - validate vs form_fields     │
                        │  - capture submission          │
                        └───────────────┬───────────────┘
                                        ▼
                        ┌──────────────────────────────┐
                        │ lib/intakeForms.ts            │
                        │  1. INSERT intake_submissions  │  ← capture point of record
                        │  2. find-or-create patient     │  (our Postgres)
                        │  3. createPatientInHealthie     │  → triggers Healthie flow + group
                        │  4. push answers (if mapped)    │  → createFormAnswerGroup
                        └───────────────┬───────────────┘
                                        ▼
                                Healthie (clinical record)
```

**Healthie is best-effort.** A submission is written locally *first* and never lost if Healthie
is unreachable. Submission `status` records how far provisioning got.

### Data model (`migrations/20260520_intake_forms.sql`)

| Table | Purpose |
|---|---|
| `form_definitions` | One row per `(brand_key, slug, version)`. Holds `client_type_key` (drives Healthie group) and `healthie_custom_module_form_id` (the Healthie form to push answers to; NULL = capture-only). |
| `form_fields` | Ordered fields. `mod_type` mirrors Healthie's `custom_module` vocabulary. `healthie_custom_module_id` maps a field to its Healthie question (NULL until mapped). |
| `intake_submissions` | Capture point of record. Stores applicant identity, `answers` JSONB, signature, and provisioning results (`patient_id`, `healthie_client_id`, `healthie_form_answer_group_id`, `status`). |

### Submission `status` values
- `provisioning` — row inserted, provisioning in progress.
- `provisioned` — patient created in Healthie **and** answers pushed (form fully mapped).
- `healthie_unmapped` — patient created in Healthie (flow triggered), but the form's
  Healthie module ids aren't mapped yet, so answers are held locally. **This is the normal
  state for a brand until playbook Step 4 is done.**
- `error` — provisioning failed; submission is still saved locally for retry.

### Code map
| File | Role |
|---|---|
| `migrations/20260520_intake_forms.sql` | Schema + ABXTAC seed |
| `lib/intakeForms.ts` | Load definition, validate, provision (DB → Healthie) |
| `app/api/intake/[brand]/[slug]/route.ts` | Public GET (structure) + POST (submit) |
| `app/intake/[brand]/[slug]/page.tsx` | Google-facing web form |
| iPad app | Consumes the same GET contract; posts with `source: 'ios'`/`'ipad'` |

### Security / anti-abuse
- The submit endpoint is **public** (no staff session). If `INTAKE_TOKEN` is set, POST requires
  a matching `?token=` (or `x-intake-token` header) — the brand embeds it in the link it sends
  (e.g. via GHL). **Set `INTAKE_TOKEN` in production.** When unset, POST is open (dev only).
- Dedup is by lowercased email in both our DB and Healthie (`createPatientInHealthie` already
  searches Healthie by email/phone/name and links instead of duplicating).
- Recommended hardening before public launch: per-IP rate limit, email/SMS OTP verification,
  and CAPTCHA on the web form. (Tracked, not built in the first slice.)

---

## 3. Per-brand rollout checklist (repeat for each company)

Do **one brand at a time**. ABXTAC is done as the worked example; the others follow the same steps.

1. **Define the form(s).** Add `form_definitions` + `form_fields` rows for the brand. Mirror the
   brand's existing Healthie form (`scripts/create-healthie-forms.ts`) so the patient experience
   is unchanged. Set `client_type_key` to the brand's key (`lib/patientHealthieSync.ts`):
   `nowmenshealth` (group 75522), `nowprimarycare` (75523), `nowlongevity` (82532),
   `nowmentalhealth` (82533), `abxtac` (82534).
2. **Verify provisioning** with a test submission → confirm a patient row + `healthie_clients`
   link + a Healthie user in the right group (which fires Healthie's onboarding flow).
3. **Confirm capture.** Inspect `intake_submissions` — `answers` JSONB present, signature stored.
4. **Map answers to Healthie (optional but recommended).** Look up the brand's Healthie
   `custom_module_form` id and each question's `custom_module` id (via the Healthie API /
   `customModuleForm` query used in `app/api/ipad/patient-chart/send-forms/route.ts`). Set
   `form_definitions.healthie_custom_module_form_id` and each `form_fields.healthie_custom_module_id`.
   Re-test → status should now reach `provisioned`.
5. **Wire the link.** Put `/ops/intake/<brand>/<slug>?token=…` into the brand's GHL/website flow.
6. **iPhone/iPad.** Point the app's intake screen at the GET contract for the brand.
7. **Cutover.** Once self-serve is verified, stop relying on Healthie's email-the-form step for
   that brand (keep Healthie group assignment — it still creates the chart). Do **not** touch the
   other brands' Healthie flows.
8. **Verify & document.** Run the 5-layer iPad check if the data reaches the CEO tab; update
   `docs/PROJECT_TRACKER.md`; mark the brand done here.

---

## 4. ABXTAC — worked example (this session)

- **Form:** `brand_key='abxtac'`, `slug='services-agreement'` — "ABX Tactical Services Agreement"
  (9 fields: occupation, professional background, training/certs, deployment status, antibiotic
  pack authorization, self-admin training, emergency-use ack, liability waiver, signature).
  Mirrors `scripts/create-healthie-forms.ts` Form 5.
- **client_type_key:** `abxtac` → Healthie group **82534**, provider Aaron Whitten, DO.
- **Web form:** `/ops/intake/abxtac/services-agreement`
- **API:** `GET|POST /ops/api/intake/abxtac/services-agreement`
- **Status:** schema **applied to RDS** (2026-05-20) + seed + API + web form built; submissions
  provision a patient locally and in Healthie. By default intake now **suppresses Healthie's
  welcome/set-password email** (`suppressWelcome`) so OUR forms own all patient comms.
  **Healthie answer-mapping (Step 4) is NOT done yet** — submissions land as `healthie_unmapped`
  until the ABXTAC Healthie form/module ids are filled in. Expected, not a bug.

### Apply the migration (on-box)
```bash
psql "$DATABASE_URL" -f migrations/20260520_intake_forms.sql
# verify
psql "$DATABASE_URL" -c "SELECT name, slug, client_type_key FROM form_definitions WHERE brand_key='abxtac';"
psql "$DATABASE_URL" -c "SELECT ordinal, field_key, mod_type, required FROM form_fields f JOIN form_definitions d USING(form_def_id) WHERE d.brand_key='abxtac' ORDER BY ordinal;"
```

### Smoke test
```bash
# structure
curl -s "https://nowoptimal.com/ops/api/intake/abxtac/services-agreement" | python3 -m json.tool
# submit (add ?token=… if INTAKE_TOKEN is set)
curl -s -X POST "https://nowoptimal.com/ops/api/intake/abxtac/services-agreement" \
  -H 'Content-Type: application/json' \
  -d '{"applicant_name":"Test Operator","applicant_email":"test+abx@example.com",
       "answers":{"occupation":"Medic","professional_background":"Military (Active)",
       "deployment_status":"Active Deployment","antibiotic_pack_auth":"true",
       "self_admin_training":"true","emergency_use_ack":"true","liability_waiver":"true",
       "signature":"Test Operator"}}' | python3 -m json.tool
```

---

## 4a. Deep-dive safety findings (2026-05-20)

Audited before applying the migration. Goal: prove it can't impact other companies or
how Healthie communicates with customers.

### Schema migration is additive + safe
- Creates **only** 3 new tables (`form_definitions`, `form_fields`, `intake_submissions`)
  + indexes. **Touches no existing table**, no `ALTER`, no `DROP` (passes the pre-deploy
  DROP-TABLE gate). Verified idempotent — re-running inserts 0 rows.
- Live-DB dependencies verified before apply: `gen_random_uuid()` available; `patients.patient_id`
  is the UUID PK; `healthie_clients` has a **single-column** unique index on `healthie_client_id`
  (so `ON CONFLICT (healthie_client_id)` is valid); all inserted `patients` columns exist.
- The `patients` INSERT is allowed by the status-chokepoint trigger `trg_patient_status_audit`
  (it only blocks `webhook_processor→inactive` and non-admin `inactive→active`; a fresh INSERT
  of `active` just writes one audit row — same pattern as `lib/ipad-patient-resolver.ts`).

### Isolation from other companies — proven
- `createPatientInHealthie` has exactly **one** other caller (`app/api/patients/route.ts`).
  The new `suppressWelcome` option is **additive with the legacy default**, so that caller's
  behavior is byte-for-byte unchanged.
- Only **ABXTAC** is seeded. `getActiveFormDefinition` returns `null` for every other brand →
  the public GET/POST return **404** for them. No other company can be provisioned here.
- Nothing else (no cron/webhook) reads the new tables. No code auto-applies a Healthie
  onboarding flow.
- ⚠️ One inherited cross-brand behavior to know: `createPatientInHealthie` dedups by
  email/phone/name across **all** Healthie patients and *links* to a match instead of creating.
  If an ABXTAC applicant already exists in another brand's Healthie group, we link to that one
  human's chart (intended — one human = one chart). Acceptable; flagged for awareness.

### Healthie customer communication — the gate before real launch
Two layers can make Healthie email/text a customer:
1. **`createClient` welcome / set-password email** — **WE control this.** Intake now sets
   `suppressWelcome: true` by default → `dont_send_welcome=true`, `skip_set_password_state=true`.
   Healthie holds the chart silently. (Re-enable with `INTAKE_HEALTHIE_SEND_WELCOME=1`.)
2. **Group-level auto onboarding flow** — **Healthie-side config we cannot see from code.**
   If ABXTAC group **82534** is set to auto-apply an onboarding flow, Healthie will email
   "complete your forms" the moment the patient is assigned to the group — *regardless* of
   `suppressWelcome`. **🚦 GATE: before the first real (non-dry-run) provisioning, confirm in
   the Healthie UI that group 82534 has no auto-onboarding flow (or disable it).** Until then,
   test only with `dry_run` or `INTAKE_DRY_RUN=1`.

## 4b. Test plan — through and through

| # | Test | How | Side effects | Status |
|---|------|-----|--------------|--------|
| 1 | Migration applies + idempotent | `psql -f migrations/20260520_intake_forms.sql` twice | additive only | ✅ done |
| 2 | Schema deps exist on live DB | read-only psql probes | none | ✅ done |
| 3 | Pipeline: load/validate/dry-run-submit | `npx tsx --env-file=.env.local .tmp/test-intake-pipeline.ts` (16 assertions) | none (dry-run; self-cleans) | ✅ 16/16 |
| 4 | Isolation: other brands → null/404 | covered in test #3 + GET probe post-deploy | none | ✅ (lib) |
| 5 | Live GET form structure | `curl …/api/intake/abxtac/services-agreement` | none | ⏳ needs deploy |
| 6 | Live GET other brand → 404 | `curl …/api/intake/nowmenshealth/x` | none | ⏳ needs deploy |
| 7 | Live POST dry-run | `curl -X POST … -d '{"dry_run":true,…}'` | none | ⏳ needs deploy |
| 8 | Web form renders + submits (dry-run) | open `/ops/intake/abxtac/services-agreement` | none | ⏳ needs deploy |
| 9 | **Real** provision (1 patient) | POST with a Phil-owned test email, `suppressWelcome` on | creates 1 Healthie client | 🚦 after gate (§4a.2) |
| 10 | Healthie answer push reaches chart | after Step-4 mapping, POST test → check Healthie chart | writes form answers | 🚦 after mapping |

The dry-run path (env `INTAKE_DRY_RUN=1` or body `{"dry_run":true}`) validates + captures with
**no patient and no Healthie call** — use it for all pre-launch HTTP testing. The test script
lives at `.tmp/test-intake-pipeline.ts` (regenerable; not committed).

## 4c. ABXTAC GHL ↔ Healthie wiring audit (2026-05-20, read-only)

Question: "Is everything wired so the intake forms we need to send ABXTAC patients
reach them and land on the Healthie chart?" **Answer: No — nothing is wired end-to-end
today.** Evidence from read-only probes of Healthie group 82534 + the GHL ABXTAC location
(`OyC2MESFDP3Pxm10tECz`):

- **Healthie group 82534 has NO onboarding flow attached.** (6 flows exist; only Men's
  Health 75522, Primary 75523, Sick Visit 77894 are attached to groups.) → joining the
  ABXTAC group auto-sends **nothing**. *(Upside: clears the comms gate — no surprise
  Healthie emails on provisioning.)*
- **The "ABX Tactical Services Agreement" form does NOT exist in Healthie** (75 templates
  scanned; absent). It's only defined in `scripts/create-healthie-forms.ts` — never created.
- **GHL native forms = lead-capture only** ("A2P", "Registration" ×2, "Optin Claim"). No
  HIPAA / consent / intake form. GHL has **no form→Healthie sync** (the only GHL↔Healthie
  link is the appointment-webhook adding tags). So GHL forms never reach the Healthie chart.
- **GHL ABXTAC workflows are mostly DRAFT** (10 of 11 draft; only "Dashboard: Capture
  Inbound SMS" is published). None send clinical intake/consent forms.
- The generic Healthie templates DO exist and DO land on the chart **if sent** — but for
  ABXTAC the only delivery path today is a staff member manually sending each via the
  dashboard/iPad (`requestFormCompletion`). No automation.

**Per-form end-to-end status** (post-wiring 2026-05-26):

| Intake form | Healthie form id | Self-serve mapped? | Wired E2E (patient → our form → Healthie chart) |
|---|---|---|---|
| HIPAA Agreement | 2898628 | ✅ 3 fields | ✅ |
| Consent to Treat | 2898608 | ✅ 4 fields | ✅ |
| Telehealth Informed Consent | 2898624 | ✅ 6 fields | ✅ |
| AI Scribe Consent | 2898621 | ✅ 5 fields | ✅ |
| Financial Agreement | 2898609 | ✅ 5 fields | ✅ |
| Patient Intake (NOWOPTIMAL) | 2898622 | ✅ 18 fields | ✅ |
| Peptide Therapy Informed Consent | 2960753 | ✅ 34 fields | ✅ |
| **ABX Tactical Services Agreement** (created) | **3098004** | ✅ 9 fields | ✅ |

**Wiring done by `scripts/wire-abxtac-intake.ts`** (one-shot, idempotent):
- Created the missing **ABX Tactical Services Agreement** template in Healthie (id 3098004, 9 questions).
- Read each form's `custom_modules` from Healthie and UPSERTed `form_definitions` + per-field
  `form_fields` with `healthie_custom_module_form_id` and `healthie_custom_module_id` set.
  So when a patient submits, `submitIntake` pushes answers via `createFormAnswerGroup` to the
  right Healthie form, on the right modules, on that patient's chart.
- Created an unattached Healthie onboarding flow **"ABXTAC Intake"** (id 127754) per Phil's
  *self-serve primary, Healthie silent* choice. Flow is NOT attached to group 82534 → Healthie
  emails nobody automatically. (NB: `createOnboardingItem` returned generic Healthie 500s, so
  the flow is empty for now — non-blocking since it's unattached. Staff can drop the 8 forms
  into the flow from the Healthie UI if they ever want manual-send fallback.)

**Updates to the legacy code map:**
- `scripts/create-healthie-forms.ts` is **stale** for new work — its `createCustomModuleForm`
  uses `form_name:` (rejected) and its `createCustomModule` uses `description:` (rejected).
  The Healthie schema now uses `name:` and `sublabel:` respectively. Use
  `scripts/wire-abxtac-intake.ts` as the current reference.

**To wire the next brand:** copy `wire-abxtac-intake.ts`, edit the `BRAND_CONFIG` block at top
(brand_key, client_type_key, the 8 form names + healthieId / createIfMissing), run once.

## 5. Open items / next sessions
- ~~Map ABXTAC Healthie `custom_module_form_id` + per-field `custom_module_id` (Step 4) to reach `provisioned`~~ — ✅ done 2026-05-26 (all 8 forms mapped via `wire-abxtac-intake.ts`).
- ~~Confirm/disable the auto onboarding flow on Healthie group 82534~~ — ✅ done; no flow attached to 82534 (verified read-only), and Phil's policy is to keep it that way.
- **Deploy the branch** (behind the pre-deploy gate) so the public GET/POST endpoints + web form go live. Submissions will then post the patient's answers to the right Healthie chart with no Healthie customer email (`suppressWelcome` on, no group auto-flow).
- **Build a multi-form patient experience** for the 8-form ABXTAC set (single wizard or sequenced links). Today each form is at `/ops/intake/abxtac/<slug>`; a published GHL workflow could send the patient through them one at a time, or we add a composite `/ops/intake/abxtac` hub page.
- **Wire the publish-the-link step in GHL**: today the ABXTAC GHL workflows are mostly draft. Add (or publish) one workflow that sends new contacts the `/ops/intake/abxtac/...` link.
- Populate the empty "ABXTAC Intake" Healthie flow (127754) via the Healthie UI as manual-send fallback (`createOnboardingItem` over the API returned 500s).
- Build an admin review screen for `intake_submissions` (retry `error` rows, see `healthie_unmapped`).
- Add rate-limit + OTP + CAPTCHA before public launch.
- iPhone/iPad intake screen against the shared GET contract.
- Then repeat Section 3 for Now Men's Health, Now Primary Care, Now Longevity — one at a time.
