# ABXTAC Patient Email Audit (2026-05-26, read-only)

> Inventory of every customer-facing email an ABXTAC patient could automatically
> receive, across WooCommerce / ShipStation / GHL. Use this to decide what to
> trim before publishing the GHL lifecycle workflows.

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

## 2. The ShipStation ↔ Woo bridge — where the "shipped" email actually comes from

The WC ShipStation integration plugin is configured with:
- `shipped_status: wc-completed` — **when ShipStation marks a shipment shipped, the plugin
  moves the WC order to status "Completed".**
- That status change triggers `WC_Emails::send_transactional_email` on the `completed`
  hook → fires `customer_completed_order` → patient gets *"Your order from ABXTac is on
  its way!"*.

So the "your order shipped" email patients see is **WooCommerce's `customer_completed_order`**,
not a ShipStation-sent email.

**But ShipStation can ALSO send its own customer "Shipment Notification" email** (configured
per-store in the ShipStation Web UI, Settings → Stores → [store] → *Customer Email*). That
setting is not exposed in any WC option or API surface I can read — **must verify in the
ShipStation dashboard**. If it's enabled, the patient gets *two* shipped emails (the WC one
above + ShipStation's).

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

## 5. Recommended trims (read-only — for Phil to apply in the relevant UIs)

| Action | Where | Why |
|---|---|---|
| **Disable `customer_on_hold_order`** | WP → WC → Settings → Emails | Same subject as processing; second copy when both fire |
| **Verify "Shipment Notification" in ShipStation UI** is OFF (let WC own the shipped email), or disable WC `customer_completed_order` and let ShipStation own it | ShipStation → Settings → Stores → [Store] → Customer Email | Avoid double "your order shipped" |
| **Audit `customer_note` use** | WC admin | Any staff "note to customer" emails the patient — easy accidental over-messaging |
| **Fix store name "ABXTac " (trailing space) + set `woocommerce_email_from_name`** | WC → Settings → General + Emails | Cosmetic; cleans the `[ABXTac ]` subjects |
| **Decide owner for "order shipped" before publishing GHL "ABXTac - Order Shipped" workflow** | GHL UI | Don't publish a 3rd shipped email |
| **(Already correct)** Healthie group 82534 has no onboarding flow → no Healthie auto-emails | Healthie | Verified in §4a |

Read-only verification commands used (no changes made):
```
wp --path=/var/www/abxtac eval '$mailer = WC()->mailer(); foreach ($mailer->get_emails() as $e) { ... }'
wp --path=/var/www/abxtac option get woocommerce_shipstation_settings --format=yaml
# (no ShipStation API key in env — Shipment Notification toggle must be checked in UI)
```
