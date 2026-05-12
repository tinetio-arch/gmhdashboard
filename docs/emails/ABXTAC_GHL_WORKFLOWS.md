# ABXTAC — GHL Workflow Specs

Paste-ready specs for wiring each of the 5 email templates into a GHL workflow.
**Location:** ABXTAC (`OyC2MESFDP3Pxm10tECz`). Template IDs are canonical and
stored in `docs/emails/_ghl_template_ids_abxtac.json` — do NOT duplicate the
templates, bind workflows to these IDs.

| Slug                            | Template ID                       | Audience          |
|---------------------------------|-----------------------------------|-------------------|
| booking-confirmation            | `69e57d2c59494a5c1830b759`        | NEW patient       |
| booking-confirmation-existing   | `69e58c09b62dfb7be98fc529`        | Returning patient |
| appointment-reminder            | `69e57d2d2f23970484618bb3`        | All               |
| cancellation                    | `69e57d2eac092f535c1e3976`        | All               |
| reschedule                      | `69e57d2ffd652128d6efc29e`        | All               |
| post-visit                      | `69e57d304824c0ef8ec39811`        | All               |

Merge fields used by every email: `{{contact.first_name}}`, `{{contact.appointment_date}}`, `{{contact.appointment_time}}`, `{{contact.appointment_type}}`, `{{contact.amount_paid}}` (booking only), `{{contact.temp_password}}` (new-patient booking only). The `/api/abxtac/book` route writes all of these to the GHL contact BEFORE adding the trigger tag.

---

## 1. Booking Confirmation (branches: New vs Returning)

**Workflow name:** `ABXTAC — Booking Confirmation`
**When it fires:** Immediately after `/api/abxtac/book` completes (Stripe charge + Healthie appointment). The backend writes the temp password to Healthie for new patients, pushes all merge fields to GHL, and sets ONE of these two tags that route the workflow:

- `abxtac-new-patient` → send "New Patient" email (shows temp password)
- `abxtac-existing-patient` → send "Returning Patient" email (shows reset link)

Plus the shared tag `Telehealth Consult Booked` (used by other workflows like SMS).

**Trigger:**
- *Event:* Contact Tag Added → tag = `Telehealth Consult Booked`

**Filters (all must be true):**
- Contact has email
- Contact has custom field `appointment_date`
- Contact has custom field `appointment_time`
- Tag `abxtac-cancelled` is NOT present

**Actions (in order):**
1. **If/Else branch** on tag `abxtac-new-patient`:
   - **YES branch** → **Send Email** → template `ABXTAC — Booking Confirmation (New Patient)` (id `69e57d2c59494a5c1830b759`)
     - Subject: *"Your ABXTAC Consultation is Booked — Here's Your Login"*
     - Uses `{{contact.temp_password}}` (already populated by the booking route).
   - **NO branch** → **Send Email** → template `ABXTAC — Booking Confirmation (Returning Patient)` (id `69e58c09b62dfb7be98fc529`)
     - Subject: *"You're Booked — See You in the Now Optimal App"*
     - Offers a reset link; no password is emailed.
2. **Add Tag** → `abxtac-welcome-sent`
3. **Wait** → 0 (send immediately)

**Do NOT:**
- Send this if `abxtac-cancelled` is present (guard against race conditions)
- Re-enroll the same contact — mark the workflow "Contact can only enter once per appointment ID"
- Email the temp password to returning patients (they already have one)

---

## 2. Appointment Reminder (24h)

**Workflow name:** `ABXTAC — Appointment Reminder 24h`
**When it fires:** Exactly 24 hours before the appointment start time.

**Trigger:**
- *Event:* Appointment Status changes to `confirmed` (or upon creation)
- Use GHL's native "Appointment Start Date" trigger with offset `-24 hours`

**Filters:**
- Appointment is in the future
- Tag `abxtac-cancelled` is NOT present
- Tag `abxtac-rescheduled` is NOT present on THIS appointment
- Contact has email

**Actions:**
1. **Wait Until** → `Appointment Start - 24 hours`
2. **Re-check filters** (cancellation/reschedule may have happened in the meantime)
3. **Send Email** → template `ABXTAC — Appointment Reminder (24h)` (id `69e57d2d2f23970484618bb3`)
4. **Add Tag** → `abxtac-24h-reminder-sent`

**Edge cases:**
- If appointment is within 24 hours at creation, send immediately (fallback path)
- If contact cancels after workflow enrollment but before send, workflow must drop via filter re-check

---

## 3. Cancellation

**Workflow name:** `ABXTAC — Cancellation`
**When it fires:** When the patient (or clinic) cancels the appointment in Healthie.

**Trigger:**
- *Event:* Appointment Status changes to `cancelled`
- Source: Healthie webhook → GHL inbound

**Filters:**
- Contact has email
- This email hasn't been sent for this specific appointment already (dedupe on appointment ID)

**Actions:**
1. **Add Tag** → `abxtac-cancelled`
2. **Remove Tag** → `abxtac-24h-reminder-sent` (so we don't send a reminder for a dead appt)
3. **Cancel any scheduled "Appointment Reminder 24h" for this contact's appt**
4. **Send Email** → template `ABXTAC — Cancellation` (id `69e57d2eac092f535c1e3976`)
5. **Add Tag** → `abxtac-cancellation-sent`

**Do NOT:**
- Refund automatically — refund is a separate manual process
- Send if the appointment was rescheduled, not cancelled (reschedule is a different workflow)

---

## 4. Reschedule

**Workflow name:** `ABXTAC — Reschedule`
**When it fires:** When the appointment's start time is changed.

**Trigger:**
- *Event:* Appointment `start_time` updated
- Source: Healthie webhook

**Filters:**
- Contact has email
- `appointment_date` custom field has been updated to the new value BEFORE this workflow fires
- Tag `abxtac-cancelled` is NOT present

**Actions:**
1. **Update custom field** `appointment_date` and `appointment_time` from webhook payload
2. **Add Tag** → `abxtac-rescheduled`
3. **Send Email** → template `ABXTAC — Reschedule` (id `69e57d2ffd652128d6efc29e`)
4. **Re-enroll into "Appointment Reminder 24h" workflow** with the NEW appointment time

**Do NOT:**
- Re-send the booking-confirmation email
- Send this at the same time as cancellation

---

## 5. Post-Visit

**Workflow name:** `ABXTAC — Post-Visit`
**When it fires:** ~30 minutes after the scheduled appointment end time (not start), to guarantee the visit actually happened.

**Trigger:**
- *Event:* Appointment Status changes to `completed` (ideal) OR
- Time-based: `Appointment End Time + 30 minutes`

**Filters:**
- Appointment was attended (status ≠ `no_show`)
- Contact has email
- Tag `abxtac-post-visit-sent` NOT already present
- Tag `abxtac-cancelled` NOT present

**Actions:**
1. **Send Email** → template `ABXTAC — Post-Visit` (id `69e57d304824c0ef8ec39811`)
2. **Add Tag** → `abxtac-post-visit-sent`
3. **Add Tag** → `abxtac-active-patient`

**Follow-on workflows (wire separately):**
- Day +1: Push notification "Your plan is ready" (once provider finalizes in Healthie)
- Day +7: Check-in via in-app message
- Day +30: Member pricing / refill reminder

---

## Password Reset (not a scheduled workflow — triggered by user)

**Flow:**
1. User taps "Set password" / "Reset password" link in any ABXTAC email
2. Lands on `https://abxtac.com/reset-password?email=...`
3. Submits email → POSTs to `https://nowoptimal.com/ops/api/abxtac/reset-password`
4. Backend:
   - Looks up active Healthie patient by email
   - Generates a secure 12-char password
   - Sets it on Healthie (admin mutation)
   - Sends a **fully ABXTAC-branded email via GHL** containing the new password
5. User logs into the Now Optimal app with the temp password

**Tags set:**
- `abxtac-password-reset` — any time a reset email is sent

**No Healthie-branded email is ever sent.**

---

## Global "Do Not Send" Rules

Apply these filters to every workflow above:

- Contact tag `unsubscribed` → SKIP
- Contact tag `do-not-email` → SKIP
- Contact email is obviously fake (`@test.`, `@example.`) → SKIP
- Patient is deceased or deactivated in Healthie → SKIP (use a `healthie-inactive` tag)

---

## Healthie → GHL Field Mapping

The Healthie webhook handler (`/api/webhooks/healthie`) must populate these GHL
custom fields on the contact before any workflow triggers:

| Healthie field                    | GHL custom field             |
|-----------------------------------|------------------------------|
| `appointment.date`                | `appointment_date`           |
| `appointment.time`                | `appointment_time`           |
| `appointment_type.name`           | `appointment_type`           |
| `stripe.amount`                   | `amount_paid` (booking only) |
| `user.first_name`                 | native `firstName`           |
| `user.email`                      | native `email`               |
| generated 12-char (new patients)  | `temp_password` (new-patient booking only) |
