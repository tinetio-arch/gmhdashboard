# GHL email draft — "ABXTAC — Welcome / Complete Intake"

> Drop-in content for a new GHL email template at the ABXTAC location, plus the
> 48-hour reminder. To paste into **GHL → Marketing → Emails → New Email**.
> Merge tags use GHL's `{{contact.*}}` syntax.

---

## ⚠️ One dependency before you publish the workflow

The link points at `https://nowoptimal.com/ops/intake/abxtac` (a single hub page that
walks the patient through the 7 forms in one flow). That hub page **does not exist yet** —
today each form lives at its own URL (`/ops/intake/abxtac/<slug>`). Two options:

- **Best (recommended):** I build the hub page next so the email points at one URL and
  patients fill all 7 forms in sequence. (~1 short session.)
- **Stopgap:** point this email at the most-urgent single form (e.g. `hipaa-agreement`)
  and add the rest later. Cleaner to wait for the hub.

**`INTAKE_TOKEN` is set in prod (2026-05-26).** The submit endpoint returns 401 without
a matching token. One-time GHL setup:
1. **GHL → Settings → Business Profile → Custom Values** → add `intake_token` with the
   value from `~/gmhdashboard/.env.local` (`grep '^INTAKE_TOKEN=' ~/gmhdashboard/.env.local`).
2. In the email link below, use `…/ops/intake/abxtac?token={{custom_values.intake_token}}`.
3. Same in the 48h-reminder email. Rotating the token = edit `.env.local` + GHL Custom
   Value + `pm2 restart gmh-dashboard`.

---

## Email 1 — "Welcome / Complete Intake" (initial send)

**Suggested trigger:** `Telehealth Consult Booked` tag (already added by the existing
Healthie appointment webhook) — sends intake before the visit so the provider has the
data in hand.

**From:** `ABXTAC Care Team <admin@granitemountainhealth.com>` *(or your dedicated ABXTAC sender)*
**Reply-to:** same

### Subject (pick one)
- **A.** `Before your ABXTAC consult — quick intake (~15 min)`
- **B.** `One step before your ABXTAC consult: complete your intake forms`
- **C.** `{{contact.first_name}}, complete your ABXTAC intake before we meet`

### Preheader (preview text, ~100 chars)
`Seven short forms so your provider walks in ready. About 15 minutes — finish before your visit.`

### HTML body

```html
<!-- paste into GHL email builder as Custom HTML, or rebuild visually -->
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:8px;padding:32px;">
      <tr><td>
        <p style="margin:0 0 16px;font-size:14px;color:#6b7280;letter-spacing:0.04em;text-transform:uppercase;">ABXTAC</p>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:600;">{{contact.first_name}}, finish your intake before your consult.</h1>

        <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
          You're booked with your provider. Before that conversation, we need a few
          standard intake and consent forms on file so they can prescribe and ship
          without delay.
        </p>

        <p style="margin:0 0 24px;font-size:15px;line-height:1.55;">
          <strong>Time:</strong> about <strong>15 minutes</strong>. One link, all 7 forms in sequence — you can sign on a phone, tablet, or computer.
        </p>

        <table cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#111827;border-radius:6px;">
          <a href="https://nowoptimal.com/ops/intake/abxtac?token={{custom_values.intake_token}}"
             style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
            Complete intake →
          </a>
        </td></tr></table>

        <p style="margin:24px 0 8px;font-size:14px;color:#374151;"><strong>What you'll complete:</strong></p>
        <ul style="margin:0 0 24px 20px;padding:0;font-size:14px;color:#374151;line-height:1.7;">
          <li>HIPAA Agreement</li>
          <li>Consent to Treat</li>
          <li>Telehealth Informed Consent</li>
          <li>Patient Informed Consent for AI Scribe</li>
          <li>Financial Agreement</li>
          <li>Patient Intake (medical history)</li>
          <li>Peptide Therapy Informed Consent</li>
        </ul>

        <p style="margin:0 0 16px;font-size:13px;color:#6b7280;line-height:1.55;">
          Your responses are stored securely and go straight to your provider's chart.
          If you've started before and need to pick up where you left off, use the same link.
        </p>

        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.55;">
          Trouble with the form? Reply to this email and we'll sort it out.<br>
          — The ABXTAC Care Team
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
```

### Plain-text fallback (for email clients that block HTML)

```
ABXTAC — Complete your intake before your consult

{{contact.first_name}}, you're booked with your provider. Before that
conversation, we need a few standard intake and consent forms on file so
they can prescribe and ship without delay.

Time: about 15 minutes. One link, all 7 forms — phone, tablet, or computer.

Complete intake:
https://nowoptimal.com/ops/intake/abxtac?token={{custom_values.intake_token}}

What you'll complete:
  - HIPAA Agreement
  - Consent to Treat
  - Telehealth Informed Consent
  - Patient Informed Consent for AI Scribe
  - Financial Agreement
  - Patient Intake (medical history)
  - Peptide Therapy Informed Consent

Your responses are stored securely and go straight to your provider's chart.
Use the same link to resume if you stop partway through.

Trouble with the form? Reply to this email.
— The ABXTAC Care Team
```

---

## Email 2 — 48-hour reminder (only if intake not yet completed)

**Suggested trigger:** if the contact still has the `Telehealth Consult Booked` tag and
does **not** yet have an `Intake Complete` tag 48 hours after email 1.
(The intake API can be wired to add `Intake Complete` to the GHL contact on submit — quick
follow-up; happy to do that next.)

### Subject (pick one)
- **A.** `Quick reminder — finish your ABXTAC intake (~10 min left)`
- **B.** `{{contact.first_name}}, your provider is still waiting on your intake`

### Preheader
`We can't dispense without these forms on file. Picks up where you left off.`

### Plain-text body (a reminder doesn't need the full HTML treatment)

```
Hey {{contact.first_name}},

Quick nudge — your ABXTAC intake forms are still incomplete. Your provider
needs these on file before your consult so we can prescribe and ship the
same day.

If you started already, this link picks up where you left off:
https://nowoptimal.com/ops/intake/abxtac?token={{custom_values.intake_token}}

About 10–15 minutes total.

If something's blocking you, just reply — we'll sort it.

— The ABXTAC Care Team
```

---

## Workflow spec (what to build in GHL)

```
Workflow: "ABXTAC — Intake"
Status: Published

Trigger:  Contact tag added = "Telehealth Consult Booked"
          AND contact does not have tag "Intake Complete"

Step 1:   Send Email → "ABXTAC — Welcome / Complete Intake"
Step 2:   Wait 48 hours
Step 3:   IF tag "Intake Complete" exists → exit
          ELSE Send Email → "ABXTAC — Intake Reminder"
Step 4:   Wait 24 hours
Step 5:   IF tag "Intake Complete" exists → exit
          ELSE Create internal Slack/Telegram task: "Manually outreach <patient> — intake incomplete 72h after booking"
```

The third step (manual escalation) is intentionally a *task*, not another email — three
auto-emails for the same ask is over-messaging.

---

## Optional next moves

1. **Build `/ops/intake/abxtac` hub page** so this email points at one URL (instead of
   per-slug). Short session.
2. **Add `Intake Complete` tag on submit:** when `submitIntake()` finishes for a contact,
   call GHL `/contacts/{id}/tags` to add `Intake Complete`. That powers the reminder
   skip-logic in the workflow above.
3. **A/B subject line** — between A and C above. Personalized (`{{contact.first_name}}`)
   usually wins on opens.
