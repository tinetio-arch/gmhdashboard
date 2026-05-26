# ABXTAC Patient Email Audit (2026-05-26)

> Inventory of every customer-facing email an ABXTAC patient could automatically
> receive, across WooCommerce / ShipStation / GHL. Use this to decide what to
> trim before publishing the GHL lifecycle workflows.

## Changes applied this session

**2026-05-26 — WC emails disabled per Phil:**
- `customer_completed_order` (yes → **no**) — ShipStation's Branded Tracking emails
  cover the "shipped / on its way" beat
- `customer_on_hold_order` (yes → **no**) — duplicated the processing-email subject

Rollback (if needed):
```bash
wp --path=/var/www/abxtac eval '
foreach (["customer_completed_order","customer_on_hold_order"] as $id) {
    foreach (WC()->mailer()->get_emails() as $e) {
        if ($e->id === $id) $e->update_option("enabled", "yes");
    }
}'
```

**Current ABXTAC customer-email footprint per order** (after the change above):
1. WC `customer_processing_order` — "Your ABXTac order has been received!"
2. ShipStation BTN #1 — "Your order is being prepared"
3. ShipStation BTN #2 — "Your package is estimated to arrive [day]"
4. ShipStation BTN #3 — "Your package is out for delivery"
5. ShipStation BTN #4 — "Your package has been delivered"

5 emails per order; further trim is in ShipStation's UI (Branded Tracking toggles —
items #2 and #3 above are the next candidates to turn off).


## Sender identity (live)

- From: `admin@granitemountainhealth.com` (option `woocommerce_email_from_address`)
- `woocommerce_email_from_name` is **unset** — and store name has a trailing space
  ("ABXTac "), which is why every WC subject reads `[ABXTac ]` / "ABXTac  order". *(Cleanup nit.)*

## 1. WooCommerce built-in emails (live, on the ABXTAC storefront)

| Email | Enabled | Audience | Triggered when | Subject (live) |
|---|---|---|---|---|
| new_order | ✅ | admin@granitemountainhealth.com | order placed | "[ABXTac ]: You've got a new order: #" |
| cancelled_order | ✅ | admin | order cancelled | "[ABXTac ]: Order # has been cancelled" |
| customer_cancelled_order | ❌ off | customer | order cancelled | — |
| failed_order | ✅ | admin | payment failure | "[ABXTac ]: Order # has failed" |
| **customer_failed_order** | ✅ | **customer** | payment failure | "Your order at ABXTac was unsuccessful" |
| **customer_on_hold_order** | ✅ | **customer** | order moves to on-hold | "Your ABXTac order has been received!" |
| **customer_processing_order** | ✅ | **customer** | order moves to processing | "Your ABXTac order has been received!" |
| **customer_completed_order** | ✅ | **customer** | order moves to completed *(= ShipStation marks shipped — see §2)* | "Your order from ABXTac is on its way!" |
| customer_refunded_order | ✅ | customer | refund issued | "Your ABXTac order # has been refunded" |
| customer_invoice | ❌ off | customer | manual send | — |
| customer_note | ✅ | customer | staff adds an order note "to customer" | (per-note) |
| customer_reset_password | ✅ | customer | password reset request | (utility) |
| customer_new_account | ✅ | customer | new WC account created | (utility) |

**No other email-sending plugins are active** (no AutomateWoo, Follow-Ups, Subscriptions,
Mailchimp, Abandoned-Cart, etc.). Only the WC core, WC ShipStation integration, WC Square,
WC Stripe Gateway, and `link-woocommerce-plugin-gty-main` are active — none of those add
extra customer transactional emails.

## 2. ShipStation is the loudest channel — confirmed from live Gmail (2026-05-26)

ShipStation's classic "Shipment Notification" toggle is **OFF** (no `subject:shipped`
emails ever come from `tracking@shipstation.com`). But the **Branded Tracking Notifications**
feature is fully on, and it sends a customer **four separate emails per shipment** from
`tracking@shipstation.com`:

| # | Stage | Subject | Triggered by |
|---|---|---|---|
| 1 | Label created | "Your order is being prepared" | label printed in ShipStation |
| 2 | Tracking active | "Your package is estimated to arrive [day]" | first carrier scan |
| 3 | Out for delivery | "Your package is out for delivery" | OFD scan |
| 4 | Delivered | "Your package has been delivered" | delivery scan |

**Live volume** in the last 14 days, sampled from admin's inbox (admin is BCC'd on every
one of these): **~5 unique customers × 4 emails = ~20 ShipStation customer touches** —
`bcozrn52@gmail.com`, `jfulmer92037@gmail.com`, `alex@halenkainvestments.com`,
`badgersdenaz@gmail.com`, `joekarcie@gmail.com`, `brian@thegathering.global`,
`jtbsyount@hotmail.com`. Every shipment generated all 4 emails.

Meanwhile, the WC ShipStation integration plugin is configured `shipped_status: wc-completed`
— so when ShipStation marks shipped, WC also fires `customer_completed_order` ("Your order
from ABXTac is on its way!"). That's a **5th email per shipment**.

**Total customer-facing emails per single ABXTAC order today:**

1. WC `customer_processing_order` — order placed → "Your ABXTac order has been received!"
2. ShipStation #1 → "Your order is being prepared"
3. WC `customer_completed_order` — ShipStation marks shipped → "Your order from ABXTac is on its way!"
4. ShipStation #2 → "Your package is estimated to arrive [day]"
5. ShipStation #3 → "Your package is out for delivery"
6. ShipStation #4 → "Your package has been delivered"

**→ Six emails per order.** And `admin@granitemountainhealth.com` is BCC'd on the
ShipStation four (which is why this audit can see them), so Phil's inbox gets 4 copies too.

Our own `app/api/webhooks/shipstation/route.ts` only handles **delivery** events to set
`peptide_order_tracking.delivered_at` — it sends no emails.

## 3. GHL ABXTAC location (from §4d audit, 2026-05-26)

8 email templates exist; **the 10 lifecycle workflows are DRAFT** (only "Capture Inbound
SMS" is published), so today *none of these are firing yet*:

| GHL template | Built? | Would fire on |
|---|---|---|
| ABXTAC Launch Announcement | ✅ | manual blast |
| ABXTAC — Booking Confirmation (New) | ✅ | (workflow draft) |
| ABXTAC — Booking Confirmation (Returning) | ✅ | (workflow draft) |
| ABXTAC — Appointment Reminder (24h) | ✅ | (workflow draft) |
| ABXTAC — Cancellation | ✅ | (workflow draft) |
| ABXTAC — Reschedule | ✅ | (workflow draft) |
| ABXTAC — Post-Visit | ✅ | (workflow draft) |
| ABXTac - Post Purchase Welcome (workflow exists) | template? | (workflow draft) |
| ABXTac - Order Shipped (workflow exists) | template? | (workflow draft) |

## 4. Cross-source overlap & redundancy risk

What an ABXTAC patient could receive across all three systems **for a single order + visit**
once the GHL workflows are published as-is:

| Event | WC | ShipStation native | GHL workflow |
|---|---|---|---|
| Order placed (payment ok) | "Your ABXTac order has been received!" (processing) | — | — |
| Order moves to on-hold (rare) | "Your ABXTac order has been received!" (on_hold) — **same subject as processing** | — | — |
| Payment failed | "Your order at ABXTac was unsuccessful" | — | (none yet) |
| Order shipped | "Your order from ABXTac is on its way!" (completed) | optional "Shipment Notification" | ABXTac - Order Shipped (draft) |
| Order refunded | "Your ABXTac order # has been refunded" | — | — |
| Visit booked | — | — | ABXTAC Booking Confirmation (draft) |
| Visit reminder (24h) | — | — | ABXTAC 24h Reminder (draft) |
| Visit cancelled / rescheduled | — | — | ABXTAC Cancellation / Reschedule (draft) |
| Post-visit | — | — | ABXTAC Post-Visit (draft) |

**Live duplicates today (with WC emails on, GHL workflows still draft):**
- `customer_on_hold_order` and `customer_processing_order` both have **the exact same
  subject** ("Your ABXTac order has been received!"). On the rare paths that hit on-hold
  first then processing (e.g., manually held orders, certain gateway delays), the patient
  receives the **same email twice**.
- If ShipStation's UI-side "Shipment Notification" is on, the patient gets the shipped
  email **twice** (WC's completed_order + ShipStation's).

**Latent duplicates that activate when GHL workflows publish:**
- "Order Shipped" (WC ✅, possibly ShipStation ✅, GHL workflow draft) — pick ONE.
- (None of the GHL templates duplicate WC's *order* emails; they're appointment-focused,
  which WC doesn't send. No overlap there.)

## 5. Recommended trims — biggest noise first

### The 4 ShipStation Branded-Tracking emails are the largest source of noise.
In ShipStation: **Settings → Notifications → Branded Tracking Notifications** (or
**Settings → Stores → [Store] → Customer Email** → "Tracking Updates"). Each of the 4
stages can be toggled. A sensible trim:

- ✂️ **Off:** "Order is being prepared" (redundant with WC's processing email)
- ✂️ **Off:** "Estimated to arrive [day]" (low-value preview; reduces noise the most)
- ✅ Keep: "Out for delivery" (only one with porch-piracy / availability utility)
- ✅ Keep: "Delivered" (only one with "did it arrive?" utility)

That drops customers from 6 → 4 emails per order. If you want to go further:

- ✂️ Disable **WC `customer_completed_order`** (WP → WC → Settings → Emails) — ShipStation
  emails cover the same "your order is on its way" ground. Drops to 3.
- ✂️ Disable **WC `customer_on_hold_order`** — duplicate subject with `customer_processing_order`
  on the rare paths that hit on-hold.

### Other items
| Action | Where | Why |
|---|---|---|
| Audit `customer_note` use | WC admin | Staff "note to customer" emails the patient — easy accidental over-messaging |
| Fix store name "ABXTac " (trailing space) + set `woocommerce_email_from_name` | WC → Settings → General + Emails | Cosmetic — cleans the `[ABXTac ]` subjects |
| Decide owner for "order shipped" before publishing GHL "ABXTac - Order Shipped" workflow | GHL UI | Don't publish a 3rd "shipped" sender |
| Turn off admin BCC on Branded Tracking emails | ShipStation Settings → Notifications | You're getting 4 copies in your inbox per shipment too |
| Healthie group 82534 has no onboarding flow → no Healthie auto-emails (verified §4a) | — | already correct |

### Verification trail (all read-only)

```
wp --path=/var/www/abxtac eval '$mailer = WC()->mailer(); foreach ($mailer->get_emails() as $e) { ... }'
wp --path=/var/www/abxtac option get woocommerce_shipstation_settings --format=yaml
# Gmail MCP — confirmed live volume:
#   from:shipstation.com newer_than:14d      → ~20 hits across ~5 customers (4 per shipment)
#   from:shipstation.com subject:shipped     → 0 hits (classic Shipment Notification is OFF)
# (no ShipStation API key in env — Branded Tracking toggles must be flipped in their UI)
```
