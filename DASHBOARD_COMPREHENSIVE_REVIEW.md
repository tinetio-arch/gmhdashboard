# GMH Dashboard Comprehensive Review
**Date:** December 1, 2025  
**Purpose:** Complete audit of current implementation, working features, and required fixes

---

## ✅ WHAT'S CURRENTLY IMPLEMENTED

### 1. Dashboard Structure (`app/page.tsx`)
- **Integration Status Section** - Shows QuickBooks, Jane (ClinicSync), GoHighLevel status
- **QuickBooks Operations Center Card** - Client-side component with metrics
- **Operational Metrics Cards:**
  - Total Patients ✅
  - Active Patients ✅
  - Hold - Payment Research ✅ (RED gradient)
  - Hold - Patient Research ✅ (RED gradient) - **ALREADY IN CODE** (line 477-486)
  - Hold - Contract Renewal ✅
  - Labs Due ≤30 Days ✅ (YELLOW gradient)
  - Controlled Dispenses (30d) ✅
  - Pending Signatures ✅
  - Weeks Since Audit ✅ (turns red if ≥1 week)
- **Executive Summary** (Owner only):
  - Outstanding Balances card
  - Primary Care MRR
  - Men's Health MRR
- **Membership Revenue Breakdown** (Owner only)
- **Inventory & Supply Chain** cards
- **Outstanding Balances** section (Jane + QuickBooks split)
- **Patient Breakdown by Service Type**
- **Recent Activity** (Recently Edited + Recent Dispenses)

### 2. Data Queries (`lib/`)
- `metricsQueries.ts` - Dashboard metrics (patients, labs, audits, holds)
- `quickbooksDashboard.ts` - QuickBooks revenue, payment issues, unmatched patients
- `membershipStats.ts` - Outstanding balances (Jane + QBO combined)
- `patientAnalytics.ts` - Patient breakdown by service type
- `janeRevenueQueries.ts` - Jane revenue totals
- `membershipRevenue.ts` - MRR calculations

### 3. API Routes (`app/api/admin/quickbooks/`)
- `/sync` - QuickBooks sync endpoint ✅
- `/check-payment-failures` - Payment checker ✅
- `/patient-matching` - Patient mapping (GET potential matches, POST create mapping) ✅
- `/payment-issues` - Get payment issues ✅
- `/metrics` - Get dashboard metrics ✅
- `/resolve-payment-issue` - Resolve payment issues ✅
- `/connection-status` - Check QB connection ✅

### 4. Patients Page Filtering (`app/patients/`)
- **Status filtering works** - `searchParams.status` passed to `PatientTable`
- `PatientTable.tsx` filters by `initialStatusFilter` prop (line 464, 518-528)
- Cards link with correct query params:
  - `/patients?status=hold_payment_research` ✅
  - `/patients?status=hold_patient_research` ✅
  - `/patients?status=hold_contract_renewal` ✅
  - `/patients?status=active` ✅
  - `/patients?labs_due=30` ✅

### 5. QuickBooks Card Component (`app/components/QuickBooksCard.tsx`)
- Shows connection status ✅
- Buttons: Reconnect, Sync, Run Payment Check ✅
- Metrics tiles: Daily/Weekly/Monthly Revenue, Payment Issues, Patients on Recurring, Unmatched Patients ✅
- Lists: Critical Payment Issues (top 5), Unmatched Patients (top 5) ✅
- **MISSING:** Inline resolve/map buttons for each issue/patient

---

## ❌ WHAT'S BROKEN / NEEDS FIXING

### 1. QuickBooks Revenue Numbers Don't Make Sense
**Location:** `lib/quickbooksDashboard.ts` lines 36-140

**Current Implementation:**
- Queries `quickbooks_payments` table for `amount_paid` where `qb_sync_date >= startOfToday`
- Queries `quickbooks_sales_receipts` table for `amount` where `receipt_date = startOfToday`
- **Problem:** User reports numbers don't match reality

**Likely Issues:**
- Wrong date field (`qb_sync_date` vs actual transaction date)
- Double-counting (invoices + receipts for same transaction)
- Missing filters (voided transactions, test data)
- Timezone issues (dates not in server timezone)

**Fix Required:**
- Verify actual QuickBooks data structure
- Check if `quickbooks_payments` and `quickbooks_sales_receipts` are the right tables
- Add filters for voided/closed transactions
- Use correct date fields (transaction date, not sync date)

### 2. Outstanding Balances Incorrect
**Location:** `lib/membershipStats.ts` lines 284-384

**Current Implementation:**
- `getCombinedOutstandingMemberships()` combines Jane + QuickBooks balances
- Jane: from `jane_packages_import.outstanding_balance`
- QuickBooks: from `payment_issues.amount_owed` + `quickbooks_payments.balance`

**Problem:** User says totals don't match actual outstanding amounts

**Likely Issues:**
- Double-counting (same patient in both Jane and QBO)
- Wrong source tables (should query QuickBooks invoices directly?)
- Missing filters (resolved issues, inactive patients)
- Currency/rounding issues

**Fix Required:**
- Verify raw SQL queries return correct totals
- Check if `payment_issues` is the right source for QBO balances
- Ensure no double-counting in FULL OUTER JOIN
- Add proper filters for resolved/closed items

### 3. QuickBooks Card Missing Inline Resolve/Map Functionality
**Location:** `app/components/QuickBooksCard.tsx` lines 300-356

**Current State:**
- Shows payment issues list (lines 300-325)
- Shows unmatched patients list (lines 340-355)
- Both link to `/ops/admin/quickbooks` page

**Missing:**
- "Resolve" button next to each payment issue
- "Map Patient" button next to each unmatched patient
- Modal dialogs for resolution/mapping
- API calls to `/api/admin/quickbooks/resolve-payment-issue` and `/api/admin/quickbooks/patient-matching`

**Fix Required:**
- Add inline buttons to each list item
- Create modal components for resolve/map actions
- Wire up API calls
- Refresh card data after successful action

### 4. No Manual Payment Checker Button on Main Dashboard
**Location:** `app/page.tsx`

**Current State:**
- Payment checker only in QuickBooks card (line 200-214 of QuickBooksCard.tsx)
- No standalone button on main dashboard

**Fix Required:**
- Add "Run Payment Check" button to main dashboard (maybe in Integration Status section?)
- Should trigger both Jane and QuickBooks payment checks
- Show results in toast/notification

### 5. Duplicate System Integration Health Section
**Location:** `app/page.tsx`

**Current State:**
- One "Integration Status" section at line 315-428
- User reports seeing duplicate section

**Fix Required:**
- Search for duplicate JSX block
- Remove if found

### 6. Weeks Since Audit May Not Be Working
**Location:** `lib/metricsQueries.ts` lines 70-73

**Current Query:**
```sql
SELECT EXTRACT(EPOCH FROM (NOW() - MAX(audit_week))) / 604800
FROM weekly_inventory_audits
```

**Potential Issues:**
- `weekly_inventory_audits` table may not exist or be empty
- `audit_week` column may not be populated
- No fallback if no audits exist

**Fix Required:**
- Verify table exists and has data
- Add fallback (return 0 or show "No audits recorded")
- Ensure audit logging is working

---

## 🔍 ARCHITECTURE OVERVIEW

### Data Flow:
1. **Dashboard Page** (`app/page.tsx`) - Server Component
   - Fetches all data in parallel via `Promise.all()`
   - Passes data to client components (QuickBooksCard)
   - Renders static cards with links

2. **QuickBooks Card** (`app/components/QuickBooksCard.tsx`) - Client Component
   - Receives metrics, issues, unmatched patients as props
   - Handles user interactions (sync, payment check)
   - Makes API calls to update data

3. **Patients Page** (`app/patients/page.tsx`) - Server Component
   - Reads `searchParams` for filtering
   - Passes `initialStatusFilter` to `PatientTable`
   - `PatientTable` filters client-side

4. **API Routes** (`app/api/admin/quickbooks/*`)
   - Handle QuickBooks operations
   - Return JSON responses
   - Used by QuickBooksCard component

### Database Tables:
- `patients` - Main patient data
- `quickbooks_payments` - QuickBooks payment records
- `quickbooks_sales_receipts` - QuickBooks sales receipts
- `payment_issues` - Payment problems tracking
- `patient_qb_mapping` - Patient to QuickBooks customer mapping
- `jane_packages_import` - Jane membership data
- `weekly_inventory_audits` - Audit tracking

---

## 📋 PRIORITY FIX LIST

### HIGH PRIORITY (Data Accuracy):
1. ✅ Fix QuickBooks revenue queries - verify tables, dates, filters
2. ✅ Fix Outstanding Balances calculation - check for double-counting
3. ✅ Verify Weeks Since Audit query works

### MEDIUM PRIORITY (UX Improvements):
4. ✅ Add inline Resolve/Map buttons to QuickBooks card
5. ✅ Add manual Payment Checker button to main dashboard
6. ✅ Remove duplicate System Integration Health section (if exists)

### LOW PRIORITY (Polish):
7. ✅ Verify all card colors (Holds = red, Labs Due = yellow)
8. ✅ Test all card click filters work correctly
9. ✅ Add real-time WebSocket updates (future enhancement)

---

## 🎯 NEXT STEPS

1. **Verify Data Sources:**
   - Run raw SQL queries for QuickBooks revenue
   - Run raw SQL queries for Outstanding Balances
   - Compare with dashboard numbers

2. **Fix Query Logic:**
   - Update `quickbooksDashboard.ts` with correct queries
   - Update `membershipStats.ts` with correct calculations
   - Test with production data

3. **Add Missing Features:**
   - Inline resolve/map buttons in QuickBooks card
   - Payment checker button on main dashboard
   - Remove duplicates

4. **Test Everything:**
   - Click every card, verify filtering works
   - Test all QuickBooks operations
   - Verify all numbers match database

---

## 📝 NOTES

- "Hold - Patient Research" card **already exists** in code (line 477-486 of page.tsx)
- Patient filtering **already works** via searchParams
- QuickBooks API routes **already exist** for mapping/resolving
- Main work needed: **fix data queries** and **add inline UI actions**


