# GMH Dashboard — Full Financial System Audit Report

**Date:** 2026-03-23
**Codebase:** gmhdashboard-1c021b0b (Next.js 14.2)
**Hosted at:** https://www.nowoptimal.com

---

## Table of Contents

1. [Complete File Inventory](#1-complete-file-inventory)
2. [Payment Flow Architecture](#2-payment-flow-architecture)
3. [iPad App Financial System — Deep Dive](#3-ipad-app-financial-system)
4. [API Routes — Full Documentation](#4-api-routes)
5. [Dashboard Pages & Components](#5-dashboard-pages--components)
6. [Library/Utility Modules](#6-libraryutility-modules)
7. [Peptide Inventory System Architecture](#7-peptide-inventory-system)
8. [Database Schema](#8-database-schema)
9. [Healthie vs Direct Stripe — Card Distinction](#9-healthie-vs-direct-stripe)
10. [Current Bugs & Issues](#10-current-bugs--issues)
11. [Specific Code Changes Needed](#11-specific-code-changes-needed)
12. [Peptide Product Data (35 products)](#12-peptide-product-data)
13. [Peptide Inventory Integration Plan](#13-peptide-inventory-integration-plan)
14. [Label Printing Capability Design](#14-label-printing-capability-design)
15. [Implementation Roadmap](#15-implementation-roadmap)

---

## 1. Complete File Inventory

### iPad App (public/ipad/)
| File | Size | Financial Role |
|------|------|----------------|
| `public/ipad/app.js` | 540 KB | Main app — ALL financial functions (13 core financial functions) |
| `public/ipad/add-card.html` | 11.7 KB | Direct Stripe card collection page (Stripe Elements) |
| `public/ipad/index.html` | 12.5 KB | App shell with Stripe.js library load |
| `public/ipad/style.css` | 90.6 KB | All financial tab styling |
| `public/ipad/debug.html` | 12.5 KB | Diagnostic tool (non-financial) |
| `public/ipad/polling_service.js` | 5.5 KB | Background polling (non-financial) |

### iPad Billing API Routes
| File | Method | Endpoint |
|------|--------|----------|
| `app/api/ipad/billing/charge/route.ts` | POST | `/api/ipad/billing/charge/` |
| `app/api/ipad/billing/add-card-dual/route.ts` | POST | `/api/ipad/billing/add-card-dual` |
| `app/api/ipad/billing/delete-card/route.ts` | DELETE | `/api/ipad/billing/delete-card` |
| `app/api/ipad/billing/assign-package/route.ts` | GET, POST | `/api/ipad/billing/assign-package/` |

### QuickBooks API Routes
| File | Method | Endpoint |
|------|--------|----------|
| `app/api/admin/quickbooks/sync/route.ts` | POST | `/api/admin/quickbooks/sync` |
| `app/api/admin/quickbooks/metrics/route.ts` | GET | `/api/admin/quickbooks/metrics` |
| `app/api/admin/quickbooks/payment-issues/route.ts` | GET | `/api/admin/quickbooks/payment-issues` |
| `app/api/admin/quickbooks/resolve-payment-issue/route.ts` | POST | `/api/admin/quickbooks/resolve-payment-issue` |
| `app/api/admin/quickbooks/check-payment-failures/route.ts` | POST | `/api/admin/quickbooks/check-payment-failures` |
| `app/api/admin/quickbooks/patient-matching/route.ts` | GET, POST | `/api/admin/quickbooks/patient-matching` |
| `app/api/admin/quickbooks/connection-status/route.ts` | GET | `/api/admin/quickbooks/connection-status` |
| `app/api/admin/quickbooks/debug/route.ts` | GET | `/api/admin/quickbooks/debug` |
| `app/api/auth/quickbooks/route.ts` | GET | `/api/auth/quickbooks` (OAuth initiate) |
| `app/api/auth/quickbooks/callback/route.ts` | GET | `/api/auth/quickbooks/callback` (OAuth callback) |

### Financial Summary / Revenue Routes
| File | Method | Endpoint |
|------|--------|----------|
| `app/api/patients/[id]/financial-summary/route.ts` | GET | `/api/patients/:id/financial-summary` |
| `app/api/patients/[id]/qbo-last-payment/route.ts` | GET | `/api/patients/:id/qbo-last-payment` |
| `app/api/analytics/revenue-details/route.ts` | GET | `/api/analytics/revenue-details` |
| `app/api/jane-revenue/route.ts` | GET | `/api/jane-revenue` |
| `app/api/jane-membership-revenue/route.ts` | GET | `/api/jane-membership-revenue` |

### Healthie Integration Routes
| File | Method | Endpoint |
|------|--------|----------|
| `app/api/healthie/webhook/route.ts` | POST | `/api/healthie/webhook` |
| `app/api/admin/healthie/invoices/create/route.ts` | POST | `/api/admin/healthie/invoices/create` |
| `app/api/admin/healthie/invoices/payment-status/route.ts` | GET | `/api/admin/healthie/invoices/payment-status` |
| `app/api/admin/healthie/packages/route.ts` | GET | `/api/admin/healthie/packages` |
| `app/api/admin/healthie/preview/route.ts` | GET | `/api/admin/healthie/preview` |
| `app/api/ipad/patient/[id]/payments/route.ts` | GET | `/api/ipad/patient/:id/payments` |

### Peptide Inventory Routes
| File | Method | Endpoint |
|------|--------|----------|
| `app/api/peptides/route.ts` | GET, POST, DELETE, PATCH | `/api/peptides/` |
| `app/api/peptides/dispenses/route.ts` | GET, POST, PATCH, DELETE | `/api/peptides/dispenses/` |
| `app/api/peptides/orders/route.ts` | GET, POST | `/api/peptides/orders/` |
| `app/api/peptides/sales/route.ts` | GET | `/api/peptides/sales/` |

### Vial Inventory Routes
| File | Method | Endpoint |
|------|--------|----------|
| `app/api/inventory/vials/route.ts` | GET, POST | `/api/inventory/vials/` |
| `app/api/inventory/vials/[id]/route.ts` | GET, PATCH | `/api/inventory/vials/:id` |
| `app/api/inventory/vials/bulk-delete/route.ts` | DELETE | `/api/inventory/vials/bulk-delete` |
| `app/api/inventory/transactions/route.ts` | POST | `/api/inventory/transactions/` |
| `app/api/inventory/transactions/[id]/route.ts` | PATCH | `/api/inventory/transactions/:id` |
| `app/api/inventory/retire-vial/route.ts` | POST | `/api/inventory/retire-vial/` |
| `app/api/inventory/controlled-check/route.ts` | GET, POST | `/api/inventory/controlled-check/` |
| `app/api/inventory/intelligence/summary/route.ts` | GET | `/api/inventory/intelligence/summary` |
| `app/api/inventory/intelligence/alerts/route.ts` | GET | `/api/inventory/intelligence/alerts` |
| `app/api/inventory/intelligence/reorder-suggestion/route.ts` | GET | `/api/inventory/intelligence/reorder-suggestion` |
| `app/api/inventory/intelligence/trends/route.ts` | GET | `/api/inventory/intelligence/trends` |
| `app/api/smart-dispense/stage/route.ts` | POST | `/api/smart-dispense/stage` |
| `app/api/smart-dispense/dispense/route.ts` | POST | `/api/smart-dispense/dispense` |
| `app/api/smart-dispense/discard/route.ts` | POST | `/api/smart-dispense/discard` |
| `app/api/smart-dispense/vial-options/route.ts` | GET | `/api/smart-dispense/vial-options` |

### Dashboard Pages
| File | Description |
|------|-------------|
| `app/admin/financials/page.tsx` | Admin financials page (server wrapper) |
| `app/admin/financials/FinancialsAdminClient.tsx` | QB admin dashboard (759 lines) |
| `app/jane-revenue/page.tsx` | Jane revenue dashboard |
| `app/peptides/page.tsx` | Peptide inventory main page |
| `app/inventory/page.tsx` | Vial inventory main page |

### UI Components
| File | Description |
|------|-------------|
| `app/components/PaymentCheckerButton.tsx` | Payment failure detection tool (118 lines) |
| `app/components/QuickBooksCard.tsx` | QB operations dashboard card (753 lines) |
| `app/peptides/DispenseForm.tsx` | Peptide dispense form |
| `app/peptides/ReceiveShipmentForm.tsx` | Receive incoming peptide orders |
| `app/peptides/PeptideTable.tsx` | Inventory display table |
| `app/peptides/DispenseHistory.tsx` | Patient dispense history |
| `app/peptides/OrderHistory.tsx` | Incoming shipment history |
| `app/peptides/InStockList.tsx` | Quick stock reference |
| `app/peptides/SpecialtyOrderTabs.tsx` | Tirzepatide & Farmakaio tracking |

### Library Modules
| File | Description |
|------|-------------|
| `lib/patientFinancials.ts` | Core financial data fetching (404 lines) |
| `lib/quickbooks.ts` | QB API client with auto-token refresh (200+ lines) |
| `lib/payments.ts` | Payment service interface (174 lines) |
| `lib/healthieInvoiceService.ts` | Healthie invoice management (200+ lines) |
| `lib/healthie/financials.ts` | Healthie billing data + Snowflake sync (189 lines) |
| `lib/paymentTracking.ts` | Payment sync & status management (640 lines) |
| `lib/healthiePaymentAutomation.ts` | Healthie payment webhook processing (100+ lines) |
| `lib/mixedPaymentDetection.ts` | Mixed payment method detection (94 lines) |
| `lib/peptideQueries.ts` | Peptide inventory queries (736 lines) |
| `lib/inventoryQueries.ts` | Vial inventory queries (1300+ lines) |
| `lib/dispenseHistory.ts` | Dispense audit trail |
| `lib/pdf/labelGenerator.ts` | Label PDF generation (217 lines) |
| `lib/healthie/peptideWebhook.ts` | Billing webhook → peptide dispense handler |

### Scripts
| File | Description |
|------|-------------|
| `scripts/import-peptide-inventory.ts` | Bulk import peptide products |
| `scripts/sync-peptide-purchases.ts` | Sync Healthie peptide purchases |
| `scripts/import-dispenses.ts` | Historical dispense import |
| `scripts/check-testosterone-inventory.ts` | Inventory audit |

### Migrations
| File | Description |
|------|-------------|
| `migrations/20260305_peptide_shop.sql` | Peptide shop: prescription gating, Stripe customer mapping |
| `migrations/20260106_controlled_substance_checks.sql` | DEA compliance features |
| `migrations/20250211_cleanup_zombie_vials.sql` | Cleanup empty/expired vials |

---

## 2. Payment Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     PAYMENT FLOW ARCHITECTURE                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐                                                │
│  │  iPad App    │                                                │
│  │  (app.js)    │                                                │
│  └──────┬───────┘                                                │
│         │                                                        │
│    ┌────▼────┐     ┌───────────────────────────────────────┐    │
│    │ Charge  │────►│ POST /api/ipad/billing/charge          │    │
│    │ Patient │     │                                         │    │
│    └────┬────┘     │  ┌──────────────────────────────┐      │    │
│         │          │  │ stripe_account == "healthie"  │      │    │
│   ┌─────┴──────┐   │  │  → chargeViaHealthie()        │      │    │
│   │ Select     │   │  │  → Healthie GraphQL API       │      │    │
│   │ Stripe     │   │  │  → Creates billing_item       │      │    │
│   │ Account    │   │  │  → Triggers webhook           │──┐   │    │
│   └─────┬──────┘   │  └──────────────────────────────┘  │   │    │
│         │          │  ┌──────────────────────────────┐  │   │    │
│   ┌─────┴──────┐   │  │ stripe_account == "direct"   │  │   │    │
│   │ "healthie" │   │  │  → chargeViaDirectStripe()    │  │   │    │
│   │ or "direct"│   │  │  → Stripe PaymentIntent       │  │   │    │
│   └────────────┘   │  │  → Immediate confirm=true     │  │   │    │
│                    │  └──────────────────────────────┘  │   │    │
│                    └───────────────────────────────────┘ │   │    │
│                              │                           │   │    │
│                    ┌─────────▼──────────┐                │   │    │
│                    │ payment_transactions│                │   │    │
│                    │ (DB record)         │                │   │    │
│                    └────────────────────┘                │   │    │
│                                                          │   │    │
│  ┌───────────────────────────────────────────────────────┘   │    │
│  │  Webhook Flow (Healthie charges only)                      │    │
│  │                                                            │    │
│  │  POST /api/healthie/webhook                                │    │
│  │    ├── HMAC-SHA256 signature verification                  │    │
│  │    ├── Event: billing_item.created                         │    │
│  │    └── handleBillingItemCreated()                          │    │
│  │         ├── Fetch billing item from Healthie GraphQL       │    │
│  │         ├── Map offering → peptide_products                │    │
│  │         ├── Create PENDING dispense in peptide_dispenses   │    │
│  │         └── ⚠️ Does NOT decrement inventory (status=Pending)│   │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │ Card Management Flow                                      │      │
│  │                                                           │      │
│  │  ┌─────────────────┐    ┌───────────────────────────┐    │      │
│  │  │ "Add Card for   │───►│ Opens add-card.html popup  │    │      │
│  │  │  Billing"       │    │ Stripe.js Elements          │    │      │
│  │  │  (Direct Stripe)│    │ POST /add-card-dual         │    │      │
│  │  └─────────────────┘    │ → Creates Stripe customer   │    │      │
│  │                          │ → Attaches payment method   │    │      │
│  │                          │ → Stores stripe_customer_id │    │      │
│  │                          └───────────────────────────┘    │      │
│  │                                                           │      │
│  │  ┌──────────────────┐    ┌───────────────────────────┐   │      │
│  │  │ "Add Card to     │───►│ External: Healthie billing │   │      │
│  │  │  Healthie Stripe"│    │ page (requires separate     │   │      │
│  │  │  ⚠️ TO REMOVE    │    │ card entry through Healthie)│   │      │
│  │  └──────────────────┘    └───────────────────────────┘   │      │
│  └──────────────────────────────────────────────────────────┘      │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │ QuickBooks Sync Flow                                      │      │
│  │                                                           │      │
│  │  Admin Dashboard                                          │      │
│  │    → POST /api/admin/quickbooks/sync                      │      │
│  │      → Fetch QB customers, invoices, receipts, payments   │      │
│  │      → Sync to: quickbooks_payments, quickbooks_sales_    │      │
│  │        receipts, quickbooks_payment_transactions           │      │
│  │      → Detect payment issues → payment_issues table       │      │
│  │      → Update patient status (hold_payment_research)      │      │
│  │      → Sync to Go-High-Level (tags, custom fields)        │      │
│  └──────────────────────────────────────────────────────────┘      │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │ Peptide Inventory Auto-Decrement Rule                     │      │
│  │                                                           │      │
│  │  Current Stock = Total Ordered - Total Dispensed           │      │
│  │  WHERE:                                                   │      │
│  │    Total Ordered = SUM(peptide_orders.quantity)            │      │
│  │    Total Dispensed = SUM(peptide_dispenses.quantity        │      │
│  │                      WHERE status='Paid'                  │      │
│  │                      AND education_complete=true)          │      │
│  │                                                           │      │
│  │  ⚠️ GAP: Charging a patient does NOT auto-update status   │      │
│  │  to 'Paid' in peptide_dispenses — requires manual staff   │      │
│  │  intervention                                             │      │
│  └──────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
```

### External Integration Map

| System | Purpose | Auth Method |
|--------|---------|-------------|
| **Stripe (Direct/MindGravity)** | Card storage, payment processing | API key (`STRIPE_SECRET_KEY`) |
| **Stripe (via Healthie)** | Billing items, packages | Healthie Stripe Connect |
| **Healthie EHR** | Invoicing, payment methods, packages, patient billing | GraphQL + Basic auth |
| **QuickBooks Online** | Accounting, recurring charges, invoices, revenue | OAuth 2.0 + auto-refresh |
| **Go-High-Level (GHL)** | CRM sync, payment status tagging | API key |
| **Snowflake** | Financial analytics data warehouse | Key-pair / password auth |
| **Jane App** | Membership revenue, payment data | Webhooks / API |

---

## 3. iPad App Financial System

### File: `public/ipad/app.js`

The iPad app contains 13 core financial functions. Here are all of them with exact line numbers:

#### 3.1 `renderFinancialTab()` — Displays Financial Tab
- Renders 3 sections: Payment Methods, Active Packages, Recent Payments
- Shows cards on file with Healthie/Direct distinction
- Shows "Add Card to Healthie Stripe" button (line 9997) — **TO REMOVE**
- Shows "Bill Patient for Product/Service" section (line 10006) — **KEEP**
- Shows "Charge Patient" button (line 6062)

#### 3.2 `updateBillingInfo()` — Line ~9937
- Opens the card management modal
- Shows all cards on file with color-coding (green = Healthie, pink = Direct)
- Contains both "Add Card" buttons

#### 3.3 Card Display Logic — Lines 9964-9985
```javascript
const isDirectStripe = pm.source_type === 'direct_stripe' || pm.id?.startsWith('direct_pm_');
const bgColor = isDirectStripe ? 'rgba(240,147,251,0.08)' : 'rgba(16,185,129,0.08)';
const borderColor = isDirectStripe ? 'rgba(240,147,251,0.3)' : 'rgba(16,185,129,0.3)';
```
- **Direct Stripe cards**: Pink/magenta styling, DELETE button enabled
- **Healthie Stripe cards**: Green styling, no delete (managed via Healthie)
- **Default card indicator**: Green badge with "Default" label

#### 3.4 "Add Card to Healthie Stripe" Button — Lines 9987-10002
```javascript
// Lines 9987-10002
<div style="margin-bottom: 20px;">
    <div style="font-size: 12px; font-weight: 600; color: #10b981; text-transform: uppercase; margin-bottom: 8px;">
        🏥 For Packages & Subscriptions
    </div>
    <button onclick="addNewCard()" style="
        width: 100%; padding: 14px;
        background: linear-gradient(135deg, #10b981, #059669);
        color: white; border: none; border-radius: 8px;
        font-size: 14px; font-weight: 600; cursor: pointer;
    ">
        ➕ Add Card to Healthie Stripe
    </button>
    <div style="font-size: 11px; color: var(--text-tertiary); margin-top: 6px; padding: 0 4px;">
        Use this for recurring packages managed in Healthie
    </div>
</div>
```
**⚠️ THIS ENTIRE BLOCK (lines 9987-10002) NEEDS TO BE REMOVED**

#### 3.5 "Bill Patient for Product/Service" Section — Lines 10004-10019
```javascript
// Lines 10004-10019
<div style="margin-bottom: 16px;">
    <div style="font-size: 12px; font-weight: 600; color: #f093fb; text-transform: uppercase; margin-bottom: 8px;">
        💳 Bill Patient for Product/Service
    </div>
    <button onclick="manageDualStripeCards()" style="
        width: 100%; padding: 14px;
        background: linear-gradient(135deg, #f093fb, #f5576c);
        color: white; border: none; border-radius: 8px;
        font-size: 14px; font-weight: 600; cursor: pointer;
    ">
        ➕ Add Card for Billing
    </button>
    <div style="font-size: 11px; color: var(--text-tertiary); margin-top: 6px; padding: 0 4px;">
        For today's visit, supplements, peptides, or any product/service
    </div>
</div>
```
**✅ THIS SECTION STAYS**

#### 3.6 `addNewCard()` — Line ~10039
- Function that redirects to Healthie billing page for card addition
- Opens external Healthie URL: `https://app.gethealthie.com/patients/{healthie_id}/billing`
- **This function can be removed along with its button**

#### 3.7 `manageDualStripeCards()` — Line ~10078
- Opens `add-card.html` popup for Direct Stripe card entry
- Uses Stripe.js Elements for secure card collection
- Passes patient info via URL params

#### 3.8 `chargePatient()` — Line 10232
```javascript
async function chargePatient() {
    const patientId = chartPanelData?.demographics?.patient_id || chartPanelPatientId;
    const healthieId = chartPanelData?.healthie_id;
    const patientName = chartPanelData?.demographics?.full_name || 'Patient';
    const paymentMethods = chartPanelData?.payment_methods || [];
    // ... creates modal for Stripe account selection
}
```
- Creates a modal asking user to select: Healthie Stripe or Direct Stripe
- Line 10259: "For packages & subscriptions" option (Healthie)
- Line 10273: "For products/services" option (Direct)

#### 3.9 `selectStripeAccount(account)` — Line 10307
```javascript
async function selectStripeAccount(account) {
    // Line 10320: prompt for amount
    const amount = prompt(`Enter amount to charge ${patientName}:`);
    // Line 10326: prompt for description
    const description = prompt('Description/reason for charge:');
    // POST to /ops/api/ipad/billing/charge/
}
```
- **Current product selection: Simple text prompt (NO search/autocomplete)**
- Uses `prompt()` dialogs — not a product dropdown

#### 3.10 `deletePaymentMethod(paymentMethodId)` — Deletes Direct Stripe card
#### 3.11 `showAssignPackageModal()` — Lists Healthie packages for assignment
#### 3.12 `assignPackageToPatient()` — Assigns package via Healthie
#### 3.13 `loadPatientPaymentData()` — Loads payment history from Healthie

### File: `public/ipad/add-card.html`

Standalone page for adding cards to Direct Stripe:
- Loads Stripe.js Elements
- Gets patient info from URL params: `patient_id`, `patient_name`, `patient_email`, `healthie_id`
- Creates `PaymentMethod` → POSTs to `/ops/api/ipad/billing/add-card-dual`
- Title says "Add Card to Both Stripe Accounts" but actually only saves to Direct Stripe
- Returns Healthie billing URL for separate card addition
- 372 lines, self-contained HTML/JS

---

## 4. API Routes

### 4.1 POST `/api/ipad/billing/charge` — Charge Patient
**File:** `app/api/ipad/billing/charge/route.ts` (336 lines)

**Request:**
```json
{
  "patient_id": "uuid or healthie numeric ID",
  "amount": 150.00,
  "description": "Peptide - BPC-157 (10mg)",
  "stripe_account": "healthie" | "direct"
}
```

**Flow:**
1. Resolves patient ID (accepts both UUID and Healthie numeric ID)
2. Routes to `chargeViaHealthie()` or `chargeViaDirectStripe()`
3. **Healthie**: Creates billing item via GraphQL → triggers webhook
4. **Direct**: Creates PaymentIntent with `confirm: true` using saved card
5. Records transaction in `payment_transactions` table

**Response:**
```json
{
  "success": true,
  "stripe_account": "direct",
  "patient_name": "John Doe",
  "amount": 150.00,
  "charge_id": "pi_xxxxx",
  "status": "succeeded",
  "payment_method": { "brand": "visa", "last4": "4242" }
}
```

### 4.2 POST `/api/ipad/billing/add-card-dual` — Add Card
**File:** `app/api/ipad/billing/add-card-dual/route.ts` (162 lines)

Creates/updates Stripe customer, attaches payment method, sets as default.
Stores `stripe_customer_id` on the patient record.

### 4.3 DELETE `/api/ipad/billing/delete-card` — Delete Card
**File:** `app/api/ipad/billing/delete-card/route.ts` (75 lines)

Detaches payment method from Stripe. Only accepts `pm_*` prefixed IDs.

### 4.4 GET/POST `/api/ipad/billing/assign-package` — Package Assignment
**File:** `app/api/ipad/billing/assign-package/route.ts` (80 lines)

GET: Lists Healthie offerings (packages)
POST: Assigns package to patient, immediately charges

### 4.5 GET `/api/patients/[id]/financial-summary` — Financial Summary
**File:** `app/api/patients/[id]/financial-summary/route.ts` (168 lines)

Parallel queries for:
- Payment issues (unresolved)
- Balance summary (total outstanding, overdue, days oldest)
- TRT dispense count
- Peptide dispense count
- Last dispense date
- Active/pending specialty orders

### 4.6 POST `/api/healthie/webhook` — Webhook Handler
**File:** `app/api/healthie/webhook/route.ts`

HMAC-SHA256 signature verification. Routes `billing_item.created` events to `handleBillingItemCreated()` which creates PENDING peptide dispenses.

### 4.7 QuickBooks Routes — Full sync, metrics, payment issues, patient matching, OAuth flow
(See file inventory above for complete list)

### 4.8 Revenue Analytics — Jane revenue, membership revenue, QB+Healthie combined analytics
(See file inventory above)

---

## 5. Dashboard Pages & Components

### Admin Financials Page
**File:** `app/admin/financials/FinancialsAdminClient.tsx` (759 lines)

QB Administration portal with:
- Revenue metrics (Daily/Weekly/Monthly) split by QuickBooks vs Healthie
- Patient statistics (Patients on Recurring, Payment Issues, Unmatched)
- Payment Issues table with severity/amount/days overdue
- Patient Matching interface (dashboard patients ↔ QB customers)
- Connection status indicator
- Sync controls

### Jane Revenue Page
**File:** `app/jane-revenue/page.tsx`

Revenue dashboard with auto-refresh (60s), summary metrics, time-based analytics.

### QuickBooks Card Component
**File:** `app/components/QuickBooksCard.tsx` (753 lines)

Inline QB operations: sync, resolve issues, map patients, intake customers, search.

### Payment Checker Button
**File:** `app/components/PaymentCheckerButton.tsx` (118 lines)

Detects payment failures across Jane + QuickBooks.

---

## 6. Library/Utility Modules

### `lib/patientFinancials.ts` (404 lines)
Core module for fetching complete patient financial profile:
- QB mapping, invoices, stats, membership, sales receipts, payments
- Healthie invoices and stats
- Payment issues

### `lib/quickbooks.ts` (200+ lines)
QB API client with OAuth auto-token refresh, request retry on 401.

### `lib/payments.ts` (174 lines)
Payment service: ensurePaymentMethod, createInvoice, createBulkInvoices, refreshPaymentStatuses.

### `lib/paymentTracking.ts` (640 lines)
Full payment sync orchestration: QB recurring → memberships, invoices → payments, patient status updates, GHL sync.

### `lib/healthie/peptideWebhook.ts`
**Critical file** — handles `billing_item.created` webhook:
1. Fetches billing item details from Healthie GraphQL
2. Maps offering → peptide_products via `healthie_product_id`
3. Creates **PENDING** dispense (status='Pending', education_complete=false)
4. **Does NOT decrement inventory** — requires manual staff update

### `lib/peptideQueries.ts` (736 lines)
All peptide inventory CRUD operations. Key inventory calculation:
```sql
Current Stock = SUM(peptide_orders.quantity)
              - SUM(peptide_dispenses.quantity WHERE status='Paid' AND education_complete=true)
```

### `lib/pdf/labelGenerator.ts` (217 lines)
Generates 3×2 inch PDF labels for peptides and testosterone.

---

## 7. Peptide Inventory System

### Database Tables

```sql
peptide_products (
  product_id SERIAL PK,
  name TEXT,
  healthie_product_id TEXT,
  reorder_point INT,
  category TEXT,
  sku TEXT,
  supplier TEXT,
  unit_cost NUMERIC,
  sell_price NUMERIC,
  label_directions TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ
)

peptide_orders (
  order_id SERIAL PK,
  product_id INT FK → peptide_products,
  quantity INT,
  order_date DATE,
  po_number TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ
)

peptide_dispenses (
  sale_id SERIAL PK,
  product_id INT FK → peptide_products,
  quantity INT DEFAULT 1,
  patient_name TEXT,
  patient_dob TEXT,
  sale_date DATE,
  order_date DATE,
  received_date DATE,
  status TEXT ('Paid' | 'Pending'),
  education_complete BOOLEAN DEFAULT false,
  notes TEXT,
  paid BOOLEAN,
  stripe_payment_intent_id TEXT,
  amount_charged NUMERIC(10,2),
  healthie_billing_item_id TEXT,
  created_at TIMESTAMPTZ
)

patient_approved_peptides (
  id SERIAL PK,
  healthie_user_id TEXT,
  peptide_product_id INT FK,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  notes TEXT,
  active BOOLEAN,
  UNIQUE(healthie_user_id, peptide_product_id)
)

peptide_stripe_customers (
  id SERIAL PK,
  healthie_user_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ
)
```

### Inventory Calculation

```
Current Stock = Total Ordered - Total Dispensed
WHERE:
  Total Ordered = SUM(peptide_orders.quantity FOR this product)
  Total Dispensed = SUM(peptide_dispenses.quantity
                       WHERE status='Paid' AND education_complete=TRUE)
```

**Critical rule**: Inventory only decrements when BOTH `status='Paid'` AND `education_complete=true`.

### Dispense Flow
1. Select peptide product from dropdown
2. Search/select patient
3. Enter quantity (default: 1 vial)
4. Set status (Paid/Pending) and education_complete checkbox
5. On submission:
   - Creates `peptide_dispenses` record
   - Auto-generates PDF label if patient has `healthie_client_id`
   - Uploads label to Healthie (fire-and-forget)
   - Inventory recalculates automatically

### Label Generation
**Peptide labels (3×2 inches, Zebra GK420d format):**
- ABXTAC branding
- Patient name & DOB
- Medication name (auto-wrapped for long compound names)
- Auto-generated dosing instructions per peptide type
- Lot #, expiration date
- "NOT FDA Approved" warning

---

## 8. Database Schema

### Core Financial Tables
```
payment_transactions        — All Stripe/Healthie charges
payment_issues              — Outstanding payment issues (QB sync)
payment_sync_log            — QB sync execution logs
payment_rules               — Eligibility rules based on payment status

quickbooks_payments         — QB invoice data
quickbooks_sales_receipts   — QB sales receipt data
quickbooks_payment_transactions — QB payment records
quickbooks_oauth_tokens     — QB OAuth tokens

patient_qb_mapping          — Patient ↔ QB customer mappings
healthie_clients            — Patient ↔ Healthie mappings
healthie_invoices           — Healthie invoice records
healthie_packages           — Available Healthie packages
healthie_subscriptions      — Patient subscriptions
healthie_migration_log      — Migration operation logging
healthie_webhook_events     — Webhook idempotency log

memberships                 — Patient membership/subscription data
clinicsync_memberships      — Jane/ClinicSync membership data
patient_ghl_mapping         — Patient ↔ GHL contact mappings
patient_status_activity_log — Patient status changes (optional)

peptide_products            — Product catalog
peptide_orders              — Incoming inventory
peptide_dispenses           — Sales/dispense records
patient_approved_peptides   — Prescription gating
peptide_stripe_customers    — Patient Stripe customer mapping

vials                       — Controlled substance vials
dispenses                   — Vial dispense records
dea_transactions            — DEA compliance log
dispense_history            — Audit trail
staged_doses                — Pre-staged doses
```

---

## 9. Healthie vs Direct Stripe

### How Cards Are Distinguished

**In the iPad App (app.js line 9968):**
```javascript
const isDirectStripe = pm.source_type === 'direct_stripe' || pm.id?.startsWith('direct_pm_');
```

**Visual Distinction:**
| Property | Direct Stripe | Healthie Stripe |
|----------|---------------|-----------------|
| Background | `rgba(240,147,251,0.08)` pink | `rgba(16,185,129,0.08)` green |
| Border | `rgba(240,147,251,0.3)` pink | `rgba(16,185,129,0.3)` green |
| Delete button | ✅ Shown (red) | ❌ Hidden |
| Default badge | ✅ (if default) | ✅ (if default) |
| Label text | "For products/services" | "For Packages & Subscriptions" |

**Purpose Distinction:**
- **Direct Stripe (MindGravity account)**: Used for one-time charges — products, services, peptides, supplements
- **Healthie Stripe (Connect account)**: Used for recurring packages and subscriptions managed through Healthie

**Card Addition:**
- **Direct**: Opens `add-card.html` popup → Stripe Elements → `/api/ipad/billing/add-card-dual`
- **Healthie**: Links to external Healthie billing page (patient must add card through Healthie UI)

---

## 10. Current Bugs & Issues

### CRITICAL

| # | Issue | File | Line | Impact |
|---|-------|------|------|--------|
| 1 | **No idempotency key on charge endpoint** | `app/api/ipad/billing/charge/route.ts` | POST handler | Same request can charge patient multiple times |
| 2 | **No patient authorization on delete-card** | `app/api/ipad/billing/delete-card/route.ts` | DELETE handler | Any authenticated user can delete any card if they know the pm_ ID |
| 3 | **No auth on qbo-last-payment** | `app/api/patients/[id]/qbo-last-payment/route.ts` | GET handler | Patient payment data accessible without authentication |
| 4 | **Amount unit undocumented** | `app/api/ipad/billing/charge/route.ts` | ~line 266 | Code does `Math.round(amount * 100)` — input assumed to be dollars but not validated/documented |
| 5 | **Patient ID type confusion** | `app/api/ipad/billing/charge/route.ts` | ~lines 47-62 | Accepts both UUID and numeric Healthie ID — could resolve to wrong patient |

### HIGH

| # | Issue | File | Impact |
|---|-------|------|--------|
| 6 | **No patient verification on charge/add-card** | Multiple billing routes | Any app user can charge/add card to any patient |
| 7 | **Payment recorded before confirmation** | `charge/route.ts` | Transaction logged even if charge fails → orphaned records |
| 8 | **add-card.html title misleading** | `public/ipad/add-card.html` | Says "Both Stripe Accounts" but only saves to Direct |
| 9 | **Healthie webhook no timestamp validation** | `app/api/healthie/webhook/route.ts` | Replay attacks possible |
| 10 | **QB sync no concurrency lock** | `app/api/admin/quickbooks/sync/route.ts` | Multiple syncs can run simultaneously |

### MEDIUM

| # | Issue | File | Impact |
|---|-------|------|--------|
| 11 | **Charge uses `prompt()` dialogs** | `public/ipad/app.js` line 10320 | No product search, no input validation, poor UX |
| 12 | **Billing ↔ Inventory not linked** | System-wide | Charging for a peptide doesn't decrement inventory |
| 13 | **No revenue analytics from Healthie cache staleness check** | `app/api/analytics/revenue-details` | Reads `/tmp/healthie-revenue-cache.json` without checking age |
| 14 | **Error messages leak system details** | Multiple endpoints | Production endpoints return detailed error info |
| 15 | **Healthie "Add Card" button still present** | `public/ipad/app.js` lines 9987-10002 | Confuses staff — should be removed per requirements |

### LOW

| # | Issue | File | Impact |
|---|-------|------|--------|
| 16 | **Negative inventory values in peptide data** | `peptide_products.json` | Multiple products show negative stock (dispensed more than received) |
| 17 | **patient_status_activity_log wrapped in try-catch** | `resolve-payment-issue` | Table may not exist — silent failure |

---

## 11. Specific Code Changes Needed

### CHANGE 1: Remove "Add Card to Healthie Stripe" Button

**File:** `public/ipad/app.js`
**Lines to DELETE:** 9987-10002 (the entire `<div>` block)

```javascript
// DELETE THIS ENTIRE BLOCK (lines 9987-10002):
            <div style="margin-bottom: 20px;">
                <div style="font-size: 12px; font-weight: 600; color: #10b981; text-transform: uppercase; margin-bottom: 8px;">
                    🏥 For Packages & Subscriptions
                </div>
                <button onclick="addNewCard()" style="
                    width: 100%; padding: 14px;
                    background: linear-gradient(135deg, #10b981, #059669);
                    color: white; border: none; border-radius: 8px;
                    font-size: 14px; font-weight: 600; cursor: pointer;
                ">
                    ➕ Add Card to Healthie Stripe
                </button>
                <div style="font-size: 11px; color: var(--text-tertiary); margin-top: 6px; padding: 0 4px;">
                    Use this for recurring packages managed in Healthie
                </div>
            </div>
```

**Also remove the `addNewCard()` function** (line ~10039) since it's no longer needed.

### CHANGE 2: Remove Healthie Stripe Option from Charge Flow

**File:** `public/ipad/app.js`
**Lines:** ~10244-10305 (the `chargePatient()` function's Stripe account selection modal)

Currently shows two options:
- Line 10259: "For Packages & Subscriptions" (Healthie Stripe)
- Line 10273: "For Products/Services" (Direct Stripe)

**Change:** Remove the Healthie Stripe option from the charge modal. If Healthie charging should be eliminated entirely, the charge flow should default to Direct Stripe without showing a selection modal.

### CHANGE 3: Add Product Search to Billing Flow

**File:** `public/ipad/app.js`
**Lines:** ~10307-10340 (the `selectStripeAccount()` function)

**Current:** Uses `prompt()` for amount and description — no product search.

**Needed:** Replace the `prompt()` dialogs with a product search modal that:
1. Shows a searchable dropdown/autocomplete of products (including 35 peptide products)
2. Auto-fills amount from product price
3. Auto-fills description from product name
4. Still allows custom amount/description for non-standard charges

**Implementation approach:**
```javascript
// Replace prompt() calls with a product selection modal
// that includes:
// 1. Search input with debounced filtering
// 2. Product list from /ops/api/ipad/billing/products/ (new endpoint)
// 3. Auto-populated amount and description
// 4. "Custom Amount" toggle for non-standard charges
```

### CHANGE 4: Create Product Search API Endpoint

**New File:** `app/api/ipad/billing/products/route.ts`

```typescript
// GET /api/ipad/billing/products?q=bpc
// Returns matching products from:
//   1. peptide_products table (35 peptide products)
//   2. Any other product catalogs

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import pool from '@/lib/db';

export async function GET(request: NextRequest) {
  const user = await requireApiUser(request, 'read');
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = request.nextUrl.searchParams.get('q') || '';

  const result = await pool.query(
    `SELECT product_id, name, sell_price as price, unit_cost as cost,
            supplier, category,
            CASE WHEN sell_price > 0 THEN true ELSE false END as has_price
     FROM peptide_products
     WHERE active = true
       AND name ILIKE $1
     ORDER BY name
     LIMIT 50`,
    [`%${q}%`]
  );

  return NextResponse.json({ success: true, products: result.rows });
}
```

### CHANGE 5: Add Peptide Products to Database

The 35 peptide products from `peptide_products.json` need to be importable. They may already exist in the `peptide_products` table. Verify with:

```sql
SELECT name, sell_price, unit_cost, supplier FROM peptide_products WHERE active = true ORDER BY name;
```

If missing, create an import script or SQL insert using the product data (see Section 12).

### CHANGE 6: Link Billing to Peptide Inventory Decrement

**Option A (Recommended): Modify the charge endpoint**

**File:** `app/api/ipad/billing/charge/route.ts`

After a successful charge, if the description matches a peptide product:
```typescript
// After successful charge:
if (result.success && isPeptideProduct) {
  await createPeptideDispense({
    product_id: matchedProduct.product_id,
    quantity: 1,
    patient_name: patientName,
    sale_date: new Date().toISOString().split('T')[0],
    status: 'Paid',
    education_complete: true, // or false if separate verification needed
    notes: `Auto-created from billing charge ${result.charge_id}`,
    stripe_payment_intent_id: result.charge_id,
    amount_charged: amount
  });
}
```

**Option B: Enhance the webhook handler**

**File:** `lib/healthie/peptideWebhook.ts`

When `billing_item.created` fires and `amount_paid > 0`:
```typescript
// Change status from 'Pending' to 'Paid' when billing item is already paid
const status = billingItem.amount_paid > 0 ? 'Paid' : 'Pending';
const educationComplete = billingItem.amount_paid > 0 ? true : false;
```

### CHANGE 7: Add Label Print Trigger to Billing Flow

When a peptide is sold through the iPad billing flow:
1. After successful charge + dispense creation
2. Generate label PDF using existing `generateLabelPdf()` from `lib/pdf/labelGenerator.ts`
3. Return the PDF URL to the iPad app for immediate printing
4. Optionally upload to Healthie (existing pattern in dispenses route)

```typescript
// In the billing product selection modal, add a "Print Label" button
// that triggers after successful charge:
const label = await generateLabelPdf({
  type: 'peptide',
  patientName: patientName,
  patientDob: patientDob,
  medication: productName,
  dateDispensed: new Date().toISOString().split('T')[0]
});
// Open PDF in new tab for printing
window.open(labelUrl, '_blank');
```

---

## 12. Peptide Product Data

35 peptide products to be available in billing search (from `peptide_products.json`):

| Product Name | Price | Cost | Supplier | Tax | Price Includes Tax |
|-------------|-------|------|----------|-----|-------------------|
| Peptide - AOD 9604 (3mg) | $150 | $60 | Alpha BioMed | — | No |
| Peptide - AOD 9604 (5mg) | $150 | $150 | Alpha BioMed | Sales Tax | Yes |
| Peptide - BPC-157 (10mg) | $130 | $130 | Alpha BioMed | Sales Tax | Yes |
| Peptide - BPC-157 (10mg) / TB 500 (10mg) | $196 | $83 | Alpha BioMed | — | No |
| Peptide - BPC-157 (20mg) | $180 | $75 | Alpha BioMed | Sales Tax | Yes |
| Peptide - BPC-157 (5mg) | $120 | $45 | Alpha BioMed | — | No |
| Peptide - CJC 1295 without DAC (10mg) | $150 | — | Alpha BioMed | — | No |
| Peptide - CJC w/ DAC (10mg) | $170 | $170 | Alpha BioMed | — | No |
| Peptide - CJC-1295 with Ipamorelin (5mg) | $140 | — | Alpha BioMed | — | No |
| Peptide - Gonadorelin (10mg) | $150 | $60 | Alpha BioMed | — | No |
| Peptide - HCG (10,000 iu) | $198 | $84 | Alpha BioMed | — | No |
| Peptide - PT 141 (10 mg) | $130 | $50 | Alpha BioMed | — | No |
| Peptide - PT 141 (5mg) | $110 | $40 | Alpha BioMed | — | No |
| Peptide - Retatrutide (10 mg) | $375 | — | Alpha BioMed | Sales Tax | No |
| Peptide - Retatrutide (24 mg) | $664 | — | Alpha BioMed | — | No |
| Peptide - Semax (30mg) | $120 | $45 | Alpha BioMed | — | No |
| Peptide - Semorelin (10mg) | $160 | $65 | Alpha BioMed | — | No |
| Peptide - TB500 Thymosin Beta 4 (10mg) | $150 | $60 | Alpha BioMed | — | No |
| Peptide - TB500 Thymosin Beta 4 (5mg) | $130 | $50 | Alpha BioMed | — | No |
| Peptide - Tesamorelin (10mg) | $160 | $65 | Alpha BioMed | — | No |
| Peptide - Tesamorelin (10mg) / Ipamorelin (5mg) | $160 | $65 | Alpha BioMed | — | No |
| Peptide- 2x blend CJC 1295 no DAC (5mg)/ Ipamorelin (5mg) | $140 | $55 | Alpha BioMed | — | No |
| Peptide- 2x blend Tesamorelin (10mg)/ Ipamorelin (5mg) | $160 | $65 | Alpha BioMed | — | No |
| Peptide- 2x blend Tesamorelin (5mg)/ Ipamorelin (5mg) | $140 | $55 | Alpha BioMed | — | No |
| Peptide- 3x blend Tesamorelin (5mg)/ MGF (500mcg)/ Ipamorelin (2.5mg) | $150 | $60 | Alpha BioMed | — | No |
| Peptide- 4x blend GHRP-2 (5mg)/ Tesamorelin (5mg)/ MGF (500mcg)/ Ipamorelin (2.5mg) | $160 | $65 | Alpha BioMed | — | No |
| Peptide- Gondorellin (5mg) | $120 | $45 | Alpha BioMed | — | No |
| Peptide- HCG (5000iu) | $128 | $49 | Alpha BioMed | — | No |
| Peptide- Ipamorellin (10mg) | $120 | $45 | Alpha BioMed | — | No |
| Peptide- Semorelin (5mg) | $120 | $45 | Alpha BioMed | — | No |
| Peptide- Tesamorelin (8mg) | $148 | $59 | Alpha BioMed | — | No |
| Peptide - GHRP-6 (5mg) | $90 | $90 | — | — | No |
| Peptide - Staff 2x CJC/Ipamorelin | $75 | — | — | Sales Tax | No |
| Peptide- GHK-CU 100mg | $130 | $52 | — | Sales Tax | Yes |
| Peptide- GHK-CU 50mg | $100 | $40 | — | Sales Tax | Yes |

**Note:** Inventory numbers from the CSV are NOT included per requirements. Only product name, price, cost, tax status, and supplier info.

---

## 13. Peptide Inventory Integration Plan

### Current State
- Billing (charge endpoint) and inventory (peptide_dispenses) are **completely decoupled**
- The webhook handler creates PENDING dispenses that require manual staff update
- The inventory formula only counts dispenses where `status='Paid' AND education_complete=true`

### Goal
When a peptide is charged to a patient via iPad billing:
1. Inventory auto-decrements
2. Dispense is logged (who, what, when, which patient)
3. Staff can print a label

### Implementation Plan

#### Phase 1: Product Search in Billing (iPad App Changes)

**Step 1.1:** Create new API endpoint for product search
- **New file:** `app/api/ipad/billing/products/route.ts`
- Query: `SELECT product_id, name, sell_price, unit_cost, supplier, category FROM peptide_products WHERE active = true AND name ILIKE $1`
- Returns: Product list with prices

**Step 1.2:** Replace `prompt()` dialogs in iPad app with product search modal
- **File:** `public/ipad/app.js` (modify `selectStripeAccount()` at line 10307)
- Add a searchable product modal:
  - Text input with debounced search (300ms)
  - Product list filtered by search query
  - Click product → auto-fill amount and description
  - "Custom Charge" option for non-product charges
  - Amount override capability

**Step 1.3:** Ensure 35 peptide products exist in `peptide_products` table
- Run verification query against existing data
- Insert any missing products via migration or import script

#### Phase 2: Auto-Decrement on Charge

**Step 2.1:** Modify charge endpoint to create dispense record
- **File:** `app/api/ipad/billing/charge/route.ts`
- After successful charge, if `product_id` is provided in request body:
  ```
  POST body addition: { ..., product_id: 123 (optional) }
  ```
- If product_id maps to a peptide product:
  - Create `peptide_dispenses` record with `status='Paid'`, `education_complete=true`
  - Link via `stripe_payment_intent_id` or `healthie_billing_item_id`
  - Inventory auto-decrements via existing SQL formula

**Step 2.2:** Add dispense logging
- Already exists: `peptide_dispenses` table tracks patient_name, product_id, quantity, sale_date, status
- New fields to populate: `stripe_payment_intent_id`, `amount_charged`
- Consider adding: `charged_by` (staff user who processed the charge)

**Step 2.3:** Enhance webhook handler for Healthie charges
- **File:** `lib/healthie/peptideWebhook.ts`
- When billing_item is already paid (`amount_paid > 0`):
  - Create dispense with `status='Paid'` instead of `'Pending'`
  - Set `education_complete=true` if auto-approve is desired
  - OR keep `education_complete=false` and require staff verification

#### Phase 3: Label Printing from Billing Flow

**Step 3.1:** Add label generation to charge response
- After successful charge + dispense creation:
  - Generate PDF using existing `generateLabelPdf()` from `lib/pdf/labelGenerator.ts`
  - Return `label_url` in the charge response

**Step 3.2:** Add "Print Label" button to charge success modal in iPad app
- **File:** `public/ipad/app.js`
- In the success handler of `selectStripeAccount()`:
  - Show "Print Label" button if the product is a peptide
  - Opens the PDF in a new tab for printing
  - Auto-upload to Healthie (existing pattern)

**Step 3.3:** Create label generation API endpoint
- **New file:** `app/api/ipad/billing/label/route.ts`
- Accepts: patient info, product info, dispense date
- Returns: PDF buffer or URL
- Uses existing `generateLabelPdf()` with type='peptide'

#### Phase 4: Reconciliation Safety

**Step 4.1:** Add reconciliation job
- Periodic check (hourly via cron):
  - Find `peptide_dispenses` where `status='Pending'`
  - Check corresponding Healthie billing item status
  - Auto-update to 'Paid' if payment confirmed
  - Alert if payment failed → keep as Pending

**Step 4.2:** Add refund handling
- When a charge is refunded in Stripe:
  - Update dispense status to 'Refunded'
  - Inventory auto-adjusts (refunded dispenses not counted)

---

## 14. Label Printing Capability Design

### Existing Infrastructure

The system already has a complete label printing system in `lib/pdf/labelGenerator.ts`:

**Peptide Label Format (3×2 inches, Zebra GK420d):**
```
┌────────────────────────────────────────────┐
│  [ABXTAC Logo]        ABXTAC Issuance      │
│                       Agent: NowOptimal     │
│                                             │
│  Patient: John Doe                          │
│  DOB: 01/15/1985                            │
│                                             │
│  Rx: Peptide - BPC-157 (10mg)               │
│  Inject 10-20 units SUBQ daily              │
│  Can inject locally at site of injury       │
│                                             │
│  Lot: AB2024-001  Exp: 2026-06-30           │
│  Date Dispensed: 2026-03-23                  │
│                                             │
│  ⚠ NOT FDA Approved                         │
└────────────────────────────────────────────┘
```

**Auto-Generated Instructions by Peptide Type:**

| Peptide | Instructions |
|---------|-------------|
| Tesamorelin/Ipamorelin | "Inject 5-15 units SUBQ 5 days on, 2 days off. Inject Fasted." |
| BPC-157 | "Inject 10-20 units SUBQ daily. Can inject locally at site of injury." |
| CJC/Ipamorelin/Sermorelin | "Inject 10-15 units SUBQ 5 days on, 2 days off." |
| HCG/TB-500 | "Inject 10-50 units SUBQ 2x per week." |
| PT-141 | "Inject 10-20 units SUBQ as needed. 2-4 hours before activity." |
| Retatrutide/Semaglutide/Tirzepatide | "Inject SUBQ once weekly as directed." |
| Default/Other | "Use as directed by your provider." |

### Integration Points for Billing

**When billing triggers a peptide sale:**
1. Charge endpoint creates dispense record
2. Dispense API generates PDF label (existing code)
3. Label PDF returned to iPad app
4. iPad app opens PDF in new tab → user prints on Zebra printer
5. Label optionally uploaded to Healthie patient documents

**New iPad UI Elements Needed:**
```javascript
// After successful charge, show:
<div class="charge-success-actions">
  <button onclick="printLabel(dispenseId)">🏷️ Print Label</button>
  <button onclick="viewReceipt(chargeId)">🧾 View Receipt</button>
</div>
```

---

## 15. Implementation Roadmap

### Sprint 1: Remove Healthie Card Button + Fix Critical Bugs (1-2 days)

1. **Remove "Add Card to Healthie Stripe" button** (lines 9987-10002 in app.js)
2. **Remove `addNewCard()` function** (line ~10039 in app.js)
3. **Simplify charge flow** — remove Healthie Stripe option from charge modal (or keep as option but remove card add)
4. **Fix: Add auth check to `/api/patients/[id]/qbo-last-payment`**
5. **Fix: Add patient verification to delete-card endpoint**

### Sprint 2: Product Search in Billing (2-3 days)

1. Create `/api/ipad/billing/products/` endpoint
2. Verify/import 35 peptide products into `peptide_products` table
3. Build product search modal in iPad app (replace `prompt()` dialogs)
4. Wire up auto-fill for amount and description
5. Add "Custom Charge" option for non-product charges

### Sprint 3: Billing → Inventory Linkage (2-3 days)

1. Modify charge endpoint to accept `product_id` parameter
2. On successful peptide charge → create `peptide_dispenses` record (status='Paid')
3. Inventory auto-decrements via existing SQL formula
4. Enhance webhook handler to create 'Paid' dispenses when billing item is already paid
5. Add dispense logging with charge reference

### Sprint 4: Label Printing from Billing (1-2 days)

1. Create `/api/ipad/billing/label/` endpoint using existing `generateLabelPdf()`
2. Add "Print Label" button to charge success modal in iPad app
3. Open PDF in new tab for Zebra printer output
4. Auto-upload to Healthie patient documents

### Sprint 5: Safety & Polish (1-2 days)

1. Add idempotency key support to charge endpoint
2. Add reconciliation job for pending dispenses
3. Add refund handling
4. Fix add-card.html misleading title
5. Add error sanitization for production
6. Test end-to-end: charge → inventory decrement → label print → Healthie upload

---

## Summary

### Key Findings
1. The financial system spans 50+ files across iPad app, API routes, dashboard pages, and library modules
2. Two parallel Stripe integrations exist: Direct (MindGravity) and Healthie Connect
3. The "Add Card to Healthie Stripe" button at app.js lines 9987-10002 needs removal
4. Billing and peptide inventory are currently **completely decoupled**
5. The existing peptide inventory system has a clean auto-decrement formula that can be leveraged
6. Label printing infrastructure already exists and is production-ready
7. Several critical security issues exist (no idempotency, missing auth checks, no patient verification)

### Architecture Strength
The existing codebase has a solid foundation:
- Clean separation between Healthie and Direct Stripe
- Well-structured peptide inventory with automatic calculation
- Production-ready label generation
- Comprehensive webhook handling

### Primary Gap
The single biggest gap is the **lack of linkage between billing charges and inventory management**. When a peptide is sold via the iPad billing flow, there is no automatic inventory decrement — staff must manually record the dispense in the Peptides tab separately.

The implementation plan above bridges this gap by:
1. Adding product search to the billing flow
2. Auto-creating dispense records on successful charge
3. Leveraging the existing inventory formula for automatic stock reduction
4. Enabling label printing directly from the billing flow
