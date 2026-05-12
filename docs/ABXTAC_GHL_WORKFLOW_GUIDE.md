# ABXTAC GHL Workflow Setup Guide

> **Sub-account:** ABXTAC (GHL_ABXTAC_LOCATION_ID in .env.local)
> **Purpose:** All patient communications for ABXTAC flow through GHL — email + SMS, branded as ABX TAC.
> **No Healthie emails** — Healthie notifications are suppressed per-patient via API.

---

## Custom Fields Required

Create these custom fields in GHL ABXTAC sub-account (Settings → Custom Fields → Contact):

| Field Name | Field Key | Type | Used In |
|---|---|---|---|
| Appointment Date | `appointment_date` | Text | All workflows |
| Appointment Time | `appointment_time` | Text | All workflows |
| Appointment Type | `appointment_type` | Text | Confirmation |
| Appointment Status | `appointment_status` | Text | All workflows |
| Appointment ID | `appointment_id` | Text | Internal tracking |
| Amount Paid | `amount_paid` | Text | Confirmation |

---

## Workflow 1: Booking Confirmation

**Trigger:** Tag added → `Telehealth Consult Booked`

**Actions:**
1. **Send Email** (immediately)
   - From: hello@abxtac.com (or configured ABXTAC sender)
   - Subject: `Your ABX TAC Consultation is Confirmed`
   - Body template:
   ```
   Hi {{contact.first_name}},

   Your telehealth consultation has been booked!

   📅 Date: {{contact.appointment_date}}
   🕐 Time: {{contact.appointment_time}} (Arizona Time)
   💳 Amount Paid: {{contact.amount_paid}}
   📱 Type: Telehealth Video Call

   What to expect:
   1. You'll receive a video call link before your appointment
   2. Your provider will review your health goals
   3. Together, you'll design your personalized peptide protocol
   4. After your visit, you'll get access to member pricing

   Questions? Reply to this email.

   — ABX TAC Team
   abxtac.com
   ```

2. **Send SMS** (immediately)
   ```
   ABX TAC: Your consultation is confirmed for {{contact.appointment_date}} at {{contact.appointment_time}} AZ time. Telehealth video call. Reply STOP to opt out.
   ```

---

## Workflow 2: Appointment Reminder (24h Before)

**Trigger:** Tag added → `Telehealth Consult Booked`
**Wait:** Until `appointment_date` minus 24 hours (use GHL's date-based wait)

> **Alternative if date-based wait is complex:** Use a simple time delay + check. Or set up a separate cron-triggered workflow.

**Simpler approach:** Trigger on tag, wait 24h before the custom field date. If GHL doesn't support custom field date waits natively, use this pattern:
- Trigger: Tag `Telehealth Consult Booked`
- Action: Add to "Appointment Reminders" automation
- The automation checks daily and sends reminder when appointment is tomorrow

**Actions:**
1. **Send Email**
   - Subject: `Your ABX TAC Consultation is Tomorrow`
   - Body:
   ```
   Hi {{contact.first_name}},

   Just a reminder — your telehealth consultation is tomorrow!

   📅 {{contact.appointment_date}}
   🕐 {{contact.appointment_time}} (Arizona Time)

   Please make sure you're in a quiet place with good internet.
   Your provider will call you via video at your scheduled time.

   Need to reschedule? Reply to this email and we'll help.

   — ABX TAC Team
   ```

2. **Send SMS**
   ```
   ABX TAC Reminder: Your consultation is tomorrow at {{contact.appointment_time}} AZ time. Be ready for a video call. Questions? Reply here.
   ```

---

## Workflow 3: Appointment Cancelled

**Trigger:** Tag added → `Appointment Cancelled`

**Actions:**
1. **Send Email** (immediately)
   - Subject: `Your ABX TAC Appointment Has Been Cancelled`
   - Body:
   ```
   Hi {{contact.first_name}},

   Your telehealth consultation has been cancelled.

   If you'd like to reschedule, you can book a new appointment at:
   https://abxtac.com/booking

   If you have questions about your cancellation or need help,
   just reply to this email.

   — ABX TAC Team
   ```

2. **Send SMS**
   ```
   ABX TAC: Your appointment has been cancelled. Reschedule at abxtac.com/booking or reply for help.
   ```

---

## Workflow 4: Appointment Rescheduled

**Trigger:** Tag added → `Appointment Rescheduled`

**Actions:**
1. **Send Email** (immediately)
   - Subject: `Your ABX TAC Appointment Has Been Rescheduled`
   - Body:
   ```
   Hi {{contact.first_name}},

   Your telehealth consultation has been rescheduled to a new time:

   📅 New Date: {{contact.appointment_date}}
   🕐 New Time: {{contact.appointment_time}} (Arizona Time)

   Everything else stays the same — telehealth video call with your provider.

   Need to make another change? Reply to this email.

   — ABX TAC Team
   ```

2. **Send SMS**
   ```
   ABX TAC: Your appointment has been rescheduled to {{contact.appointment_date}} at {{contact.appointment_time}} AZ time.
   ```

---

## Workflow 5: Post-Visit Follow-Up

**Trigger:** Tag added → `Consult Completed`

**Actions:**
1. **Wait** 1 hour (let provider finish notes)

2. **Send Email**
   - Subject: `Welcome to ABX TAC — Your Next Steps`
   - Body:
   ```
   Hi {{contact.first_name}},

   Thank you for your consultation! Here's what happens next:

   🧬 Your provider is finalizing your personalized peptide protocol
   💊 You now have access to our peptide catalog at member pricing
   🧪 Consider ordering a BioBox at-home lab kit for baseline tracking

   👉 Browse peptides: https://abxtac.com/shop
   👉 View lab kits: https://abxtac.com/shop#biobox
   👉 View membership plans: https://abxtac.com/membership

   Your provider will reach out if any adjustments are needed.
   Questions? Reply to this email anytime.

   — ABX TAC Team
   ```

3. **Send SMS**
   ```
   ABX TAC: Thanks for your consultation! Browse your personalized peptide catalog at abxtac.com/shop. Your provider will follow up with your protocol.
   ```

---

## Healthie Webhook Setup

For workflows 3-5 to trigger, you need to configure a Healthie webhook:

1. Go to **Healthie → Settings → Developer → Webhooks**
2. Add endpoint: `https://nowoptimal.com/ops/api/webhooks/healthie/appointment-updated`
3. Select events: `appointment.updated`
4. Save

This webhook detects cancellations, reschedules, and completions for ABXTAC appointments and adds the corresponding GHL tags automatically.

---

## Testing

1. Book a test appointment at `abxtac.com/booking` with `philschafer7@gmail.com`
2. Check GHL ABXTAC sub-account → contact should have tags + custom fields
3. Workflow should fire → check email delivery in GHL → Conversations
4. Cancel the appointment in Healthie → webhook fires → GHL tag added → cancellation email sent
5. Verify no Healthie-branded emails were sent (all suppressed)

---

_Last updated: 2026-04-19_
