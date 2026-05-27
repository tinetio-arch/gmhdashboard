# Video-Call-Join Comms Event

**Project**: `untangling-healthie-communications-from-healthie`
**Phase**: 3 (dispatch row `20260526-192907-f4ba`)
**Status**: shipped 2026-05-26 — helper + endpoint only, **DRY-RUN by default**

## Standard

When a provider is ready to start a telehealth visit, the patient gets **one**
push-first prompt with a tappable join link, dedup'd at 5 minutes and
hard-idempotent per `appt:<id>:video_join`. Channel is chosen by the gateway
in priority order: **push → SMS → email**, skipping any channel the patient
can't receive on.

This replaces Healthie's native "join your video call" send. Decommissioning
the Healthie-side trigger is a Phase 4 follow-up — for now, this stack runs in
**shadow mode**, so any go-live needs Phil's explicit flip of
`VIDEO_JOIN_NOTIFY_DRY_RUN=0`.

## Helper API

`lib/video-call-event.ts`:

```ts
import { buildVideoCallJoinEvent } from '@/lib/video-call-event';
import { notifyPatient } from '@/lib/comms-gateway';

const { event, payload } = buildVideoCallJoinEvent({
  appointmentId: 12345,
  joinUrl: 'https://app.gethealthie.com/video/sess-abc-token-xyz',  // Healthie or Zoom
  patientFirstName: 'Alex',
  providerName: 'Dr. Whitten',
  accountKey: 'mensHealth',
});

await notifyPatient(patientId, event, payload, { source: 'api:video.notify-join' });
```

The helper does **NOT** know the join URL — the URL is Healthie- or
Zoom-generated and must be supplied by the caller. The iPad provider UI
already fetches `session_id`+`generated_token`/`zoom_join_url` via
`GET /api/ipad/patient?action=video_session&appointment_id=<id>` and can
hand the appropriate URL through.

Validation:
- `appointmentId` required (non-empty)
- `joinUrl` required, must match `/^https?:\/\//` — non-http(s) schemes (`app://`,
  `mailto:`, etc.) and `null`/`undefined`/`''` are rejected with a 400 from the
  endpoint and a thrown `Error` from the helper

## Event spec

| Field                    | Value                                           |
|--------------------------|-------------------------------------------------|
| `event.name`             | `video_call_join`                               |
| `event.category`         | `appointments` (push opt-in bucket)             |
| `event.idempotencyKey`   | `appt:<appointmentId>:video_join`               |
| `event.dedupWindowMinutes` | `5` (overridable)                              |
| `event.accountKey`       | caller-supplied (`mensHealth\|primaryCare\|abxtac`) |
| `event.templateKey`      | `video_call_join.v1` (overridable)              |
| `event.preferredChannel` | undefined → gateway default = push first        |

Per-channel copy (defaults, future Phase 4 may swap for brand-specific):

| Channel | Field         | Copy                                                                 |
|---------|---------------|----------------------------------------------------------------------|
| push    | title         | `Your video visit is starting`                                       |
| push    | body          | `<provider> is ready — tap to join.`                                 |
| push    | data.joinUrl  | absolute URL (mobile app deep-links rather than opening browser)     |
| SMS     | body          | `<name>, <provider> is ready for your video visit. Join: <url>`      |
| email   | subject       | `Join your video visit with <provider>`                              |
| email   | body          | greeting + provider line + `Join here: <url>` + GMH sign-off         |

## Trigger surface

`POST /ops/api/video/notify-join/` (trailing slash required per global
`trailingSlash: true` — POSTs without it get 308'd and the body is dropped):

```bash
curl -sS -X POST 'https://nowoptimal.com/ops/api/video/notify-join/' \
  -H "x-internal-auth: $INTERNAL_AUTH_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{
    "patient_id":       "00000000-0000-0000-0000-000000000001",
    "appointment_id":   12345,
    "join_url":         "https://app.gethealthie.com/video/sess",
    "patient_first_name": "Alex",
    "provider_name":    "Dr. Whitten",
    "account_key":      "mensHealth"
  }'
```

Required body fields: `patient_id`, `appointment_id`, `join_url`.
Optional: `patient_first_name`, `provider_name`, `account_key`,
`appt_start_iso`, `preferred_channel`.

Auth: `requireApiUser(request, 'write')` — either an `x-internal-auth` header
matching `INTERNAL_AUTH_SECRET` (server-to-server) or a `gmh_session_v2`
cookie. Missing/invalid → 401.

Validation (returns 400):
- `account_key` not in `{mensHealth, primaryCare, abxtac}`
- `preferred_channel` not in `{push, sms, email}`
- `join_url` missing or not absolute http(s)
- `patient_id` missing or non-string
- `appointment_id` missing

## Shadow mode (DRY-RUN by default)

Phil's standing Phase-3/4 rule: **"entire new comms stack stays gated off real
patients until he signs off on testing — NOTHING goes live without thorough
testing"**.

- `VIDEO_JOIN_NOTIFY_DRY_RUN !== '0'` (default `'1'`) → no `notifyPatient()`,
  no ledger write, no patient contact. Response carries `dry_run: true` plus
  `preview: { event, payload }` so the caller (and Phil, via `pm2 logs
  gmh-dashboard | grep '\[VideoJoinNotify\] DRY-RUN'`) can verify the rendered
  push/SMS/email before the flip.
- `VIDEO_JOIN_NOTIFY_DRY_RUN=0` → live. Every send hits the gateway's
  idempotency + dedup + cap layers and lands in `patient_communications`.
- `VIDEO_JOIN_NOTIFY_ENABLED=0` → 503, endpoint disabled entirely.

## How idempotency interacts with retries

A second `notify-join` call for the **same appointment** within the dedup
window (default 5 min) collapses to the same ledger row via the hard
idempotency key `appt:<id>:video_join` — even if `join_url` changes (e.g.
Healthie regenerates the Vonage token). That is **intentional**: the second
call is the iPad provider double-tapping "Start Video", not a legitimate
re-prompt. Outside the dedup window, a follow-up call is treated as a fresh
event and gets a new ledger row.

If a clinic genuinely needs a "you missed the first prompt" re-prompt event
later, add a sibling event (`video_call_join_followup` with a different
idempotency-key shape) — don't loosen this one.

## Verification (2026-05-26)

- Helper smoke (`.tmp/video-call-event-smoke.ts`, 35 assertions): all pass.
- Endpoint HTTP tests against `localhost:3055` (dev server, `/ops` basePath):
  - missing `patient_id` → 400 ✅
  - non-http `join_url` → 400 ✅
  - bad `account_key` → 400 ✅
  - bad `preferred_channel` → 400 ✅
  - missing auth → 401 ✅
  - valid DRY-RUN → 200 with full preview ✅
  - `preferred_channel: 'sms'` pin → event.preferredChannel passes through ✅
- Ledger check after every DRY-RUN test:
  `SELECT count(*) FROM patient_communications WHERE event_type='video_call_join'`
  → `0` ✅ (DRY-RUN really is dry)
- Typecheck: zero new errors (worktree 148 = master 148).

## Related artifacts

- Helper: `lib/video-call-event.ts`
- Endpoint: `app/api/video/notify-join/route.ts`
- Gateway: `lib/comms-gateway.ts` (`notifyPatient`)
- Ledger: `migrations/20260526_patient_communications.sql` + `lib/comms-ledger.ts`
- Per-patient opt-outs: `migrations/20260526_patient_comms_preferences.sql`
- Reminder-cadence (sister Phase 2): `docs/COMMS_REMINDER_STANDARD.md`,
  `lib/clinic-reminder-settings.ts`
- Existing video pages (provider-side, unchanged):
  `public/ipad/video.html`, `app/api/video/waiting/route.ts`
- Legacy push cron (separate Phase 3 task, not migrated here):
  `app/api/cron/appointment-reminders/route.ts`

## What this task does NOT do

- Decommission Healthie's native "join your video call" send — Phase 4.
- Wire the iPad "Start Video" button to call this endpoint — separate
  follow-up (iPad code change). The endpoint exists for that future wiring
  plus any cron-style "starting soon" sweep.
- Build a patient-side video page. The patient still lands on Healthie's or
  Zoom's hosted join page — that's what the `join_url` points to.
- Generate the join URL. The caller supplies it (Healthie/Zoom-generated).
