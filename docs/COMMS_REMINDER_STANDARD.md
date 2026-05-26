# Appointment-Reminder Cadence Standard

**Project**: `untangling-healthie-communications-from-healthie`
**Phase**: 2 (dispatch row `20260526-192906-2008`)
**Status**: shipped 2026-05-26 — schema + helper only, disabled on every clinic

## Standard

Every appointment gets **one reminder** sent **24 hours before** start, on the
**single best available channel** (push → SMS → email, chosen by the comms
gateway in `lib/comms-gateway.ts`). The cadence is **configurable per clinic**
via `clinic_reminder_settings`. The default is `enabled = FALSE` on every row
— **no clinic sends until Phase 4 rollout flips its row to `TRUE`**.

This replaces Healthie's native cadence of **5d SMS + 24h SMS + 24h email** (3
sends per appointment, on multiple channels at once). Decommissioning the
Healthie-side toggles is the Phase 4 task `20260526-192918-41a0`.

## Storage

`clinic_reminder_settings` — one row per `account_key`:

| Column                  | Default                      | Purpose |
|-------------------------|------------------------------|---------|
| `account_key`           | (PK)                         | `mensHealth \| primaryCare \| abxtac` |
| `enabled`               | `FALSE`                      | Writers MUST skip when false |
| `hours_before`          | `24`                         | The cadence (1–168) |
| `event_type`            | `appointment_reminder_24h`   | Slug written to `patient_communications.event_type` |
| `preferred_channel`     | `NULL`                       | NULL = gateway default priority; or `push`/`sms`/`email` to pin one |
| `dedup_window_minutes`  | `1440`                       | Soft-dedup window the writer passes to `notifyPatient` |
| `notes`                 | per-row                      | Free-form |

Adding a new `account_key` requires also extending the CHECK constraints on
`patient_communications.account_key`, `ghl_messages.account_key`, and
`clinic_reminder_settings.account_key` — they must stay in lockstep.

## Read API

`lib/clinic-reminder-settings.ts`:

```ts
import {
  getClinicReminderSettings,
  buildAppointmentReminderEvent,
  isWithinReminderWindow,
} from '@/lib/clinic-reminder-settings';

const settings = await getClinicReminderSettings('mensHealth');
if (!settings || !settings.enabled) return;          // short-circuit on disabled
if (!isWithinReminderWindow(apptStartMs, settings.hoursBefore)) return;

const event = buildAppointmentReminderEvent(settings, { appointmentId });
await notifyPatient(patientId, event, payload, { source: 'cron:appt-reminders' });
```

The helper emits a `CommsEvent` with this idempotency-key shape:
`appt:<appointmentId>:reminder<hours>h`. That matches the Phase 1 ledger
comment convention (`appt:<id>:reminder24h`), so Phase 1's example and
Phase 2's writer collapse to the same `patient_communications.idempotency_key`
on retry.

## No overlap with the existing push cron

`app/api/cron/appointment-reminders/route.ts` runs every 15 minutes and pushes
at **24h** and **1h** before each appointment, dedup'd by
`push_send_log (category, dedupe_key, expo_token)`. It is **currently inert** —
no opt-ed-in `patient_push_tokens` rows, so every recent run reports
`patients_checked: 0`.

Why this matters: the moment a single device opts in, the legacy cron will
start firing **24h + 1h push**, which violates the single-24h standard and
duplicates anything Phase 3 sends through the gateway.

**Migration plan** (Phase 3 task `20260526-192907-f4ba` and friends):

1. Wire that cron through `notifyPatient()` using
   `buildAppointmentReminderEvent()`. The gateway's
   `idempotency_key = appt:<id>:reminder24h` will collapse with any retry.
2. Drop the `1h` phase. (If a clinic later wants it, add a second row
   `appointment_reminder_1h` and a new `event_type` column — don't sneak it
   into the default.)
3. Gate the cron on `clinic_reminder_settings.enabled` per the patient's
   `account_key`. If the patient's clinic is disabled, the writer short-
   circuits before any gateway call.

Until that migration ships, the cron stays inert (no opt-ed-in tokens) and the
standard is enforced by **all reminder writers being disabled by default**.

## Hard rules (Phase 2)

- `enabled = FALSE` on every seeded row. Enabling is a per-clinic Phase 4 step.
- No code in Phase 2 actually sends a reminder. This file ships schema +
  helper + doc only.
- "comms-suppression must be airtight — NO accidental patient/customer
  contact; read-only + dry-run before going live" (Phil, 2026-05-26).

## Related artifacts

- Migration: `migrations/20260526_clinic_reminder_settings.sql`
- Read API: `lib/clinic-reminder-settings.ts`
- Gateway: `lib/comms-gateway.ts` (`notifyPatient`)
- Ledger: `migrations/20260526_patient_communications.sql` + `lib/comms-ledger.ts`
- Per-patient opt-outs: `migrations/20260526_patient_comms_preferences.sql`
- Legacy cron (inert, to be migrated): `app/api/cron/appointment-reminders/route.ts`
