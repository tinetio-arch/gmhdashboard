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
- **Status after this session:** schema + seed + API + web form built; submissions provision a
  patient locally and in Healthie. **Healthie answer-mapping (Step 4) is NOT done yet** —
  submissions will land as `healthie_unmapped` until the ABXTAC Healthie form/module ids are
  filled in. This is expected and called out so it isn't mistaken for a bug.

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

## 5. Open items / next sessions
- Map ABXTAC Healthie `custom_module_form_id` + per-field `custom_module_id` (Step 4) to reach `provisioned`.
- Build an admin review screen for `intake_submissions` (retry `error` rows, see `healthie_unmapped`).
- Add rate-limit + OTP + CAPTCHA before public launch.
- iPhone/iPad intake screen against the shared GET contract.
- Then repeat Section 3 for Now Men's Health, Now Primary Care, Now Longevity — one at a time.
