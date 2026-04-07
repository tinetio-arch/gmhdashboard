## 📱 Headless Mobile App (NOWOptimal Patient App)

**Full SOT**: `/home/ec2-user/.gemini/antigravity/scratch/nowoptimal-headless-app/HEADLESS_APP_SOURCE_OF_TRUTH.md` (704 lines)  
**Codebase**: `/home/ec2-user/.gemini/antigravity/scratch/nowoptimal-headless-app/`  
**Status**: Phase 14 Complete — Billing, Forms, Journal & Metrics Polish  
**Google Play**: Health declaration updated Feb 15, 2026  
**Deployed API**: `https://o6rhh3wva6.execute-api.us-east-2.amazonaws.com/prod/`

### Architecture Overview

React Native / Expo mobile app → API Gateway → AWS Lambda → Healthie GraphQL + Snowflake + GMH Dashboard APIs

```
Backend (4 Lambdas):
├── lambda-auth-node/     → Patient login via Healthie signIn + access-check gate
├── lambda-booking/       → 33 actions (booking, forms, chat, billing, metrics, etc.)
├── lambda-data-pipe-python/ → Webhook → Snowflake pipeline
└── lambda-ask-ai/        → RAG: Snowflake PATIENT_360_VIEW + Gemini 2.0 Flash

Frontend (React Native / Expo):
├── 18 screens, 5 components, Chameleon branding engine
├── Auth via SecureStore (token persistence)
└── Dynamic theming by Healthie group ID
```

### Critical Config IDs (from `config.js`)

| Config | Men's Health | Primary Care |
|--------|-------------|-------------|
| **Group ID** | `75522` | `75523` |
| **Location ID** | `13029260` | `13023235` |
| **Provider ID** | `12093125` (Dr. Whitten) | `12088269` (Phil Schafer NP) |
| **Brand** | Red/Black | Navy/Green |

### Authentication & Access Control Flow

1. Patient → API Gateway → `lambda-auth` → Healthie `signIn` mutation
2. Auth Lambda calls **`/api/headless/access-check?healthie_id=X`** on GMH Dashboard
3. If `allowed: false` (403) → login blocked with revoke/suspend message
4. If access-check unreachable → login proceeds (graceful fallback)
5. Token stored in `SecureStore`, sent as Bearer on all API calls

**Access-check URL**: `ACCESS_CHECK_URL = process.env.ACCESS_CHECK_URL || 'https://nowoptimal.com/ops/api/headless/access-check/'`

### Server-Side Endpoints (in this repo: `app/api/headless/`)

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/api/headless/access-check` | GET | Returns `{ allowed: true/false }` | Healthie ID |
| `/api/headless/lab-status` | GET | Returns next_lab_date, urgency | Healthie ID + access check |
| `/api/headless/update-avatar` | POST | Stores avatar URL from Lambda | None (Lambda only) |

**Access Control Library**: `lib/appAccessControl.ts` (441 lines)  
**DB Table**: `app_access_controls` (migration: `20260214_app_access_controls.sql`)

### Lambda Actions (33 in booking Lambda)

| Action | Purpose |
|--------|---------|
| `get_slots`, `create_appointment`, `confirm_appointment`, `cancel_appointment` | Booking |
| `get_pending_forms`, `get_form_schema`, `submit_form`, `get_form_history`, `get_form_answers` | Forms |
| `get_conversations`, `get_messages`, `send_message` | Chat |
| `get_profile`, `update_profile`, `get_upload_url`, `update_avatar` | Profile |
| `get_upcoming_appointments`, `get_appointment_types`, `get_documents` | Records |
| `get_journal_entries`, `create_journal_entry`, `update_journal_entry`, `delete_journal_entry` | Journal |
| `get_metrics`, `add_metric_entry` | Health Metrics |
| `get_billing_items`, `get_payment_methods`, `add_payment_method`, `delete_payment_method`, `set_default_payment_method` | Billing |
| `get_lab_status`, `get_dashboard_alerts`, `get_dashboard_stats` | Dashboard |

### Healthie API Gotchas (CRITICAL)

> **`client_id` vs `user_id`**: Healthie uses DIFFERENT argument names for the same patient ID. Using the wrong one **silently returns empty arrays**:
> - `entries()`, `documents()`, `conversationMemberships()` → `client_id`
> - `appointments()`, `requestedFormCompletions()` → `user_id`
> - `user()` → `id`

> **Date Format**: Healthie returns `"2026-01-30 12:15:00 -0700"` — does NOT work with `new Date()`. Convert to ISO: `${parts[0]}T${parts[1]}${parts[2]}`

> **GraphQL type quirk**: `$client_id: String` (NOT `ID`) for entries/metrics queries

> **createFormAnswerGroup**: Must include `finished: true` or submission stays as draft

> **createEntry** (journal): Uses `poster_id` (NOT `user_id`) in input

> **Slot availability**: Do NOT pass `location_id` to `availableSlotsForRange` — causes field error

> [!CAUTION]
> **`createAppointment` dual-provider bug (Fixed March 26, 2026)**:
> Healthie **auto-adds the API key owner as a provider** on every appointment created via API. If the API key belongs to Provider A and you create an appointment for Provider B using `providers: providerBId`, the appointment gets BOTH providers.
>
> **FIX**: Always use BOTH `other_party_id` AND `providers` in createAppointment:
> ```javascript
> input: {
>   user_id: patientId,           // The patient
>   other_party_id: providerId,   // Explicit single provider (from patient's perspective)
>   providers: providerId,        // Override to prevent API key owner auto-add
>   appointment_type_id: typeId,
>   // ... other fields
> }
> ```
> **Files fixed**: `lambda-booking/src/healthie.js`, `nowmenshealth-website/lib/healthie-booking.ts`
> **Files to check**: Any code that calls `createAppointment` mutation — verify it uses `other_party_id`.

### CDK vs. Live Infrastructure

| Lambda | CDK Timeout | Live Override |
|--------|------------|--------------|
| Auth | 10s | — |
| Booking | 15s | **30s / 256MB** |
| Data Pipe | 30s | — |
| Ask AI | 60s | — |

> ⚠️ Running `cdk deploy` will revert booking Lambda to 15s/128MB. Update CDK stack first.

### Known Issues

1. **Healthie sync can fail silently** — `healthie_synced` may be `false` while `access_status` shows `revoked`. Verify via Healthie API directly.
2. **Multiple Healthie IDs per patient** — 2 patients have duplicate active Healthie client mappings. Revoking one doesn't block the others.
3. **CDK stack out of sync** with live Lambda configuration (see table above).

### Journal & Metrics Formatting (Feb 26, 2026)

Healthie `entries` API returns raw `metric_stat` as a single number with no units or formatting. The app now applies smart formatting based on `category`:

| Category | Raw Value | Formatted Display |
|----------|-----------|------------------|
| Blood Pressure | `13686` | `136/86 mmHg` (split by digit count) |
| Weight | `190` | `190 lbs (86.2 kg)` |
| Height (in.) | `70` | `5'10" (177.8 cm)` |
| Sleep | `8.5` | `8.5 hours` |
| Steps | `10432` | `10,432 steps` |
| Heart Rate | `72` | `72 bpm` |

Formatting functions: `formatBloodPressure()`, `formatWeight()`, `formatHeight()`, `formatMetricValue()`, `safeParseDate()`

> **Height gotcha**: If Healthie returns a value ≤ 7, the formatter assumes it's in feet (not inches) and multiplies by 12. Values > 12 are treated as inches.

---

