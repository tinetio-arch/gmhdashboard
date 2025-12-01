# Dashboard Financial Overhaul Plan
## Executive Summary & Operational Metrics Redesign

**Date:** January 2025  
**Status:** Planning Phase - No Code Changes Yet

---

## 1. Current State Analysis

### 1.1 Redundancy Issues Identified

#### Executive Summary Section:
- **Active Patients** appears in both Executive Summary AND Operational Metrics (duplicate)
- **Pending Signatures** appears in both sections (duplicate)
- **Outstanding Balances** is the only unique metric in Executive Summary

#### Operational Metrics Section:
- **Total Patients** vs **Active Patients** - both show patient counts (redundant)
- **Hold - Payment Research** and **Hold - Contract Renewal** are operational, not executive-level
- **Labs Due ≤30 Days** is operational, not financial
- **Controlled Dispenses** is compliance, not financial
- **Weeks Since Audit** is operational, not financial

### 1.2 Missing Financial Metrics

**Current Financial Data Available:**
- ✅ Outstanding balances (Jane + QuickBooks)
- ❌ **Revenue (money coming in)** - NOT tracked
- ❌ **Expenses (money going out)** - NOT tracked
- ❌ **Monthly Recurring Revenue (MRR)** - NOT calculated
- ❌ **Average Revenue Per Patient (ARPP)** - NOT calculated
- ❌ **Payment success rates** - Partially tracked (failures only)
- ❌ **Revenue by payment source** - NOT tracked
- ❌ **Revenue trends (MTD, YTD)** - NOT tracked

### 1.3 Integration Status

#### GoHighLevel (GHL):
- ✅ Connected and syncing patient data
- ✅ Custom fields include: `method_of_payment`, `membership_balance`
- ❌ **NOT extracting financial/transaction data from GHL**
- ❌ **NOT using GHL opportunities/pipelines for revenue tracking**
- ❌ **NOT mapping Jane payments from GHL data**

#### QuickBooks:
- ⚠️ Connected but user lacks confidence
- ✅ Can fetch: Customers, Invoices, Payments, Sales Receipts, Recurring Transactions
- ✅ Database tables: `quickbooks_payments`, `payment_issues`
- ❌ **Metrics NOT displayed on dashboard**
- ❌ **Sync status NOT visible**
- ❌ **Revenue data NOT aggregated**

#### Jane EMR (ClinicSync):
- ✅ Connected via webhook
- ✅ Database tables: `jane_packages_import`, `clinicsync_memberships`
- ✅ Tracks: `outstanding_balance`, `amount_due`, `last_payment_at`, `next_payment_due`
- ❌ **Payment amounts NOT aggregated for revenue**
- ❌ **NOT using GHL to map/verify Jane payments**

---

## 2. Proposed Dashboard Structure

### 2.1 Executive Summary (Top Section)
**Purpose:** High-level financial and operational KPIs for C-suite

**Metrics:**
1. **Total Revenue (MTD)** - Money in this month
   - Breakdown: Jane | QuickBooks | Other
   - Trend: vs Last Month | vs Last Year
   - Link: `/admin/financials?period=mtd`

2. **Outstanding Receivables** - Money owed
   - Total: $X,XXX
   - Breakdown: Jane: $X,XXX | QuickBooks: $X,XXX
   - Patients with balances: X
   - Link: `/admin/membership-audit?filter=outstanding`

3. **Monthly Recurring Revenue (MRR)**
   - Current MRR: $X,XXX
   - Breakdown by service type: Primary Care | Men's Health
   - Growth: +X% vs last month
   - Link: `/admin/financials?view=mrr`

4. **Active Patients**
   - Total: XXX
   - Breakdown: Primary Care: XX | Men's Health: XX
   - Link: `/patients?status=active`

5. **Payment Success Rate**
   - Overall: XX%
   - By source: Jane: XX% | QuickBooks: XX%
   - Failed payments: X (this month)
   - Link: `/admin/financials?view=payments`

6. **Average Revenue Per Patient (ARPP)**
   - Monthly: $XXX
   - By service type: Primary Care: $XXX | Men's Health: $XXX
   - Link: `/admin/financials?view=arpp`

### 2.2 Financial Health Dashboard (New Section)
**Purpose:** Detailed financial metrics and trends

**Sub-sections:**

#### A. Revenue Overview
- **Revenue This Month** (MTD)
  - Jane payments: $X,XXX (X payments)
  - QuickBooks payments: $X,XXX (X payments)
  - Total: $X,XXX
  - Chart: Daily revenue trend

- **Revenue This Year** (YTD)
  - Total: $XX,XXX
  - Growth: +X% vs last year
  - Average monthly: $X,XXX

- **Revenue by Service Type**
  - Primary Care: $X,XXX (XX% of total)
  - Men's Health: $X,XXX (XX% of total)
  - Other: $X,XXX (XX% of total)

#### B. Payment Sources
- **Jane EMR**
  - Status: ✅ Connected | ⚠️ Sync Issues | ❌ Disconnected
  - Last sync: X minutes ago
  - Active memberships: XX
  - Expected monthly revenue: $X,XXX
  - Actual collected (MTD): $X,XXX
  - Success rate: XX%
  - Link: `/admin/clinicsync`

- **QuickBooks**
  - Status: ✅ Connected | ⚠️ Token Expiring | ❌ Disconnected
  - Last sync: X minutes ago
  - Active recurring: XX
  - Expected monthly revenue: $X,XXX
  - Actual collected (MTD): $X,XXX
  - Success rate: XX%
  - Overdue invoices: X ($X,XXX)
  - Link: `/admin/quickbooks`

#### C. Outstanding Balances
- **Total Outstanding:** $X,XXX
- **By Source:**
  - Jane: $X,XXX (X patients)
  - QuickBooks: $X,XXX (X patients)
- **Aging:**
  - 0-30 days: $X,XXX
  - 31-60 days: $X,XXX
  - 61-90 days: $X,XXX
  - 90+ days: $X,XXX
- **Top 10 Outstanding** (table)
  - Patient | Source | Amount | Days Overdue | Link

#### D. Payment Issues
- **Failed Payments (This Month):** X
- **By Type:**
  - Declined: X ($X,XXX)
  - Insufficient Funds: X ($X,XXX)
  - Other: X ($X,XXX)
- **By Source:**
  - Jane: X failures
  - QuickBooks: X failures
- **Action Required:** X patients need follow-up
  - Link: `/patients?status=hold_payment_research`

### 2.3 Operational Metrics (Refined)
**Purpose:** Day-to-day operational KPIs (non-financial)

**Metrics:**
1. **Labs Due ≤30 Days** - X patients
2. **Pending Signatures** - X dispenses
3. **Controlled Dispenses (30d)** - X transactions
4. **Weeks Since Audit** - X weeks
5. **Hold - Payment Research** - X patients
6. **Hold - Contract Renewal** - X patients

---

## 3. Data Sources & Integration Plan

### 3.1 Revenue Data Sources

#### A. Jane EMR Revenue
**Current State:**
- `jane_packages_import` table has `outstanding_balance` but NOT payment history
- `clinicsync_memberships` has `last_payment_at` and `next_payment_due` but NOT payment amounts
- ClinicSync webhook may contain payment data in payload

**Plan:**
1. **Extract payment amounts from ClinicSync webhooks**
   - Parse `last_payment_at` events
   - Store in new `jane_payments` table:
     ```sql
     CREATE TABLE jane_payments (
       payment_id UUID PRIMARY KEY,
       patient_id UUID REFERENCES patients(patient_id),
       clinicsync_patient_id TEXT,
       payment_date DATE NOT NULL,
       payment_amount NUMERIC(10,2) NOT NULL,
       membership_plan TEXT,
       payment_method TEXT,
       raw_payload JSONB,
       created_at TIMESTAMP DEFAULT NOW()
     );
     ```

2. **Use GHL to map/verify Jane payments**
   - GHL custom fields: `membership_balance`, `method_of_payment`
   - When GHL contact is updated with payment info, extract and store
   - Cross-reference with ClinicSync data for validation
   - Create mapping: `ghl_payment_mappings` table

3. **Calculate Jane revenue:**
   - Sum `payment_amount` from `jane_payments` by date range
   - Group by service type (from patient's `client_type_key`)
   - Calculate MRR from active memberships × monthly rate

#### B. QuickBooks Revenue
**Current State:**
- `quickbooks_payments` table exists but may not be fully populated
- QuickBooks API can fetch: Payments, Sales Receipts, Invoices
- `payment_issues` tracks failures but not successes

**Plan:**
1. **Enhance QuickBooks sync:**
   - Fetch all Payments and Sales Receipts (not just invoices)
   - Store in `quickbooks_payments` table with:
     - `payment_date`
     - `payment_amount`
     - `customer_id` (mapped to `patient_id`)
     - `payment_method`
     - `transaction_type` (Payment, SalesReceipt, Invoice)

2. **Calculate QuickBooks revenue:**
   - Sum payments by date range
   - Filter by patient_id (only GMH patients)
   - Group by service type

3. **Track recurring revenue:**
   - Use `QuickBooksRecurringTransaction` data
   - Calculate expected MRR from active recurring transactions
   - Compare expected vs actual

#### C. GHL Opportunities/Pipelines
**New Integration:**
- GHL has Opportunities API with `monetaryValue`
- Can track deals/payments through pipelines
- Use to supplement Jane/QuickBooks data

**Plan:**
1. **Fetch GHL opportunities:**
   - Query opportunities with monetary values
   - Map to patients via contact_id
   - Store in `ghl_opportunities` table

2. **Use for revenue tracking:**
   - Sum opportunity values by status (won, closed)
   - Track pipeline stages
   - Cross-reference with Jane/QuickBooks payments

### 3.2 Expense Data Sources

**Current State:** ❌ No expense tracking

**Plan:**
1. **QuickBooks Expenses:**
   - Fetch Vendor Bills, Expenses from QuickBooks API
   - Store in `quickbooks_expenses` table
   - Categorize: Inventory, Supplies, Staff, etc.

2. **Manual Expense Entry:**
   - Create expense entry form
   - Store in `manual_expenses` table

3. **Calculate Net Income:**
   - Revenue - Expenses = Net Income
   - Display on dashboard

### 3.3 Integration Status Display

#### QuickBooks Status Card:
```
┌─────────────────────────────────────┐
│ QuickBooks Integration              │
│ Status: ✅ Connected                 │
│ Last Sync: 5 minutes ago            │
│ Token Expires: 15 days               │
│                                     │
│ Active Recurring: 45                │
│ Expected MRR: $8,100                │
│ Collected (MTD): $7,200            │
│ Success Rate: 89%                   │
│                                     │
│ Overdue Invoices: 3 ($450)         │
│ Failed Payments: 2 ($180)          │
│                                     │
│ [View Details] [Sync Now]           │
└─────────────────────────────────────┘
```

#### Jane/ClinicSync Status Card:
```
┌─────────────────────────────────────┐
│ Jane EMR / ClinicSync              │
│ Status: ✅ Connected                 │
│ Last Webhook: 2 minutes ago         │
│ Last Sync: 10 minutes ago           │
│                                     │
│ Active Memberships: 120            │
│ Expected MRR: $18,000               │
│ Collected (MTD): $16,200            │
│ Success Rate: 90%                   │
│                                     │
│ Outstanding Balances: 8 ($1,440)   │
│ Failed Payments: 1 ($180)          │
│                                     │
│ [View Details] [Manual Sync]       │
└─────────────────────────────────────┘
```

#### GHL Status Card:
```
┌─────────────────────────────────────┐
│ GoHighLevel                        │
│ Status: ✅ Connected                 │
│ Last Sync: 1 minute ago             │
│                                     │
│ Total Contacts: 284                 │
│ Synced Patients: 284                │
│ Sync Success Rate: 100%             │
│                                     │
│ Opportunities Tracked: 45          │
│ Total Pipeline Value: $81,000      │
│                                     │
│ [View Details] [Sync All]          │
└─────────────────────────────────────┘
```

---

## 4. Database Schema Changes

### 4.1 New Tables

```sql
-- Jane payment tracking
CREATE TABLE jane_payments (
  payment_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID REFERENCES patients(patient_id),
  clinicsync_patient_id TEXT,
  payment_date DATE NOT NULL,
  payment_amount NUMERIC(10,2) NOT NULL,
  membership_plan TEXT,
  payment_method TEXT,
  raw_payload JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_jane_payments_patient ON jane_payments(patient_id);
CREATE INDEX idx_jane_payments_date ON jane_payments(payment_date);
CREATE INDEX idx_jane_payments_clinicsync ON jane_payments(clinicsync_patient_id);

-- GHL payment mappings (to verify Jane payments)
CREATE TABLE ghl_payment_mappings (
  mapping_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID REFERENCES patients(patient_id),
  ghl_contact_id TEXT NOT NULL,
  jane_payment_id UUID REFERENCES jane_payments(payment_id),
  payment_date DATE NOT NULL,
  payment_amount NUMERIC(10,2) NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_ghl_mappings_patient ON ghl_payment_mappings(patient_id);
CREATE INDEX idx_ghl_mappings_contact ON ghl_payment_mappings(ghl_contact_id);

-- GHL opportunities
CREATE TABLE ghl_opportunities (
  opportunity_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ghl_opportunity_id TEXT NOT NULL UNIQUE,
  patient_id UUID REFERENCES patients(patient_id),
  ghl_contact_id TEXT,
  title TEXT,
  monetary_value NUMERIC(10,2),
  status TEXT,
  pipeline_id TEXT,
  pipeline_stage_id TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  synced_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_ghl_opps_patient ON ghl_opportunities(patient_id);
CREATE INDEX idx_ghl_opps_contact ON ghl_opportunities(ghl_contact_id);

-- QuickBooks expenses
CREATE TABLE quickbooks_expenses (
  expense_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  qb_expense_id TEXT NOT NULL UNIQUE,
  expense_date DATE NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  category TEXT,
  vendor TEXT,
  description TEXT,
  synced_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_qb_expenses_date ON quickbooks_expenses(expense_date);

-- Manual expenses
CREATE TABLE manual_expenses (
  expense_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_date DATE NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  category TEXT,
  vendor TEXT,
  description TEXT,
  created_by UUID REFERENCES users(user_id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_manual_expenses_date ON manual_expenses(expense_date);
```

### 4.2 Enhanced Existing Tables

```sql
-- Add payment tracking to quickbooks_payments
ALTER TABLE quickbooks_payments
  ADD COLUMN IF NOT EXISTS payment_date DATE,
  ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS transaction_type TEXT; -- 'Payment', 'SalesReceipt', 'Invoice'

-- Add revenue tracking to clinicsync_memberships
ALTER TABLE clinicsync_memberships
  ADD COLUMN IF NOT EXISTS last_payment_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS expected_monthly_amount NUMERIC(10,2);
```

---

## 5. Implementation Phases

### Phase 1: Data Collection & Storage (Week 1)
**Goal:** Start collecting financial data

1. **Jane Payments:**
   - Modify ClinicSync webhook handler to extract payment amounts
   - Create `jane_payments` table
   - Backfill from existing `clinicsync_memberships` data (if available)

2. **QuickBooks Payments:**
   - Enhance QuickBooks sync to fetch all Payments and Sales Receipts
   - Populate `quickbooks_payments` table with payment data
   - Map to patients

3. **GHL Opportunities:**
   - Create GHL opportunities sync
   - Store in `ghl_opportunities` table
   - Map to patients via contact_id

### Phase 2: Revenue Calculations (Week 2)
**Goal:** Calculate and display revenue metrics

1. **Create revenue query functions:**
   - `getRevenueMTD()` - Revenue this month
   - `getRevenueYTD()` - Revenue this year
   - `getMRR()` - Monthly Recurring Revenue
   - `getARPP()` - Average Revenue Per Patient
   - `getRevenueBySource()` - Jane vs QuickBooks
   - `getRevenueByServiceType()` - Primary Care vs Men's Health

2. **Create financial metrics component:**
   - `FinancialMetricsCard` component
   - Display revenue, MRR, ARPP
   - Add trend indicators (↑↓)

### Phase 3: Integration Status (Week 2)
**Goal:** Show integration health on dashboard

1. **Create integration status queries:**
   - `getQuickBooksStatus()` - Connection, last sync, token expiry
   - `getClinicSyncStatus()` - Last webhook, last sync
   - `getGHLStatus()` - Connection, sync status

2. **Create integration status cards:**
   - Display on Financial Health Dashboard
   - Show sync status, metrics, action buttons

### Phase 4: Dashboard Redesign (Week 3)
**Goal:** Reorganize dashboard with new structure

1. **Remove redundancy:**
   - Remove duplicate metrics from Executive Summary
   - Consolidate Operational Metrics

2. **Add Financial Health Dashboard:**
   - Revenue Overview section
   - Payment Sources section
   - Outstanding Balances section (enhanced)
   - Payment Issues section

3. **Update Executive Summary:**
   - Focus on financial KPIs
   - Add revenue, MRR, ARPP
   - Keep Active Patients (unique)

### Phase 5: GHL Payment Mapping (Week 3-4)
**Goal:** Use GHL to verify/map Jane payments

1. **GHL Payment Extraction:**
   - Monitor GHL contact updates for payment info
   - Extract payment amounts from custom fields or opportunities
   - Store in `ghl_payment_mappings`

2. **Cross-Reference:**
   - Match GHL payments with Jane payments
   - Verify amounts and dates
   - Flag discrepancies

3. **Display:**
   - Show verified vs unverified payments
   - Highlight discrepancies

### Phase 6: Expense Tracking (Week 4)
**Goal:** Track expenses and calculate net income

1. **QuickBooks Expenses:**
   - Fetch expenses from QuickBooks
   - Store in `quickbooks_expenses`

2. **Manual Expenses:**
   - Create expense entry form
   - Store in `manual_expenses`

3. **Net Income:**
   - Calculate: Revenue - Expenses
   - Display on dashboard

---

## 6. API Endpoints Needed

### Financial Data:
- `GET /api/financials/revenue?period=mtd|ytd` - Get revenue data
- `GET /api/financials/mrr` - Get MRR
- `GET /api/financials/arpp` - Get ARPP
- `GET /api/financials/by-source?period=mtd` - Revenue by source
- `GET /api/financials/by-service-type?period=mtd` - Revenue by service type

### Integration Status:
- `GET /api/integrations/quickbooks/status` - QuickBooks status
- `GET /api/integrations/clinicsync/status` - ClinicSync status
- `GET /api/integrations/ghl/status` - GHL status
- `POST /api/integrations/quickbooks/sync` - Manual QuickBooks sync
- `POST /api/integrations/clinicsync/sync` - Manual ClinicSync sync

### Payments:
- `GET /api/payments/jane?start_date=&end_date=` - Jane payments
- `GET /api/payments/quickbooks?start_date=&end_date=` - QuickBooks payments
- `GET /api/payments/ghl?start_date=&end_date=` - GHL opportunities/payments

---

## 7. User Experience Improvements

### 7.1 Clickable Metrics
All financial metrics should link to detailed views:
- Revenue MTD → `/admin/financials?period=mtd&view=revenue`
- Outstanding Receivables → `/admin/membership-audit?filter=outstanding`
- MRR → `/admin/financials?view=mrr`
- Payment Success Rate → `/admin/financials?view=payments`

### 7.2 Real-Time Updates
- Auto-refresh financial metrics every 30 seconds (already implemented)
- Show "Last updated" timestamp
- Indicate when data is stale (>5 minutes old)

### 7.3 Visual Indicators
- Green/Red for positive/negative trends
- Up/Down arrows for changes
- Progress bars for success rates
- Color-coded status indicators

---

## 8. Success Metrics

### Data Quality:
- ✅ All revenue sources tracked (Jane, QuickBooks, GHL)
- ✅ Payment success rates calculated accurately
- ✅ MRR calculated from active memberships/recurring transactions
- ✅ Outstanding balances match source systems

### User Confidence:
- ✅ QuickBooks status visible and accurate
- ✅ Jane/ClinicSync status visible and accurate
- ✅ GHL integration status visible
- ✅ Financial metrics match expectations

### Dashboard Usability:
- ✅ No redundant metrics
- ✅ Clear financial vs operational separation
- ✅ All metrics clickable and actionable
- ✅ Real-time updates working

---

## 9. Risks & Mitigation

### Risk 1: Missing Payment Data
**Issue:** Jane/QuickBooks may not provide complete payment history  
**Mitigation:**
- Start tracking from today forward
- Backfill from available sources
- Use GHL as verification source

### Risk 2: Data Discrepancies
**Issue:** Different systems may show different amounts  
**Mitigation:**
- Show source system for each metric
- Flag discrepancies for review
- Allow manual reconciliation

### Risk 3: Performance Impact
**Issue:** Aggregating financial data may be slow  
**Mitigation:**
- Use materialized views for common queries
- Cache results for 1-5 minutes
- Use database indexes

### Risk 4: API Rate Limits
**Issue:** GHL/QuickBooks APIs may have rate limits  
**Mitigation:**
- Batch requests
- Cache results
- Use webhooks where possible

---

## 10. Next Steps

1. **Review this plan** with stakeholders
2. **Prioritize phases** based on business needs
3. **Create detailed technical specs** for Phase 1
4. **Set up development environment** for testing
5. **Begin Phase 1 implementation**

---

## Appendix: Current Database Tables Reference

### Financial-Related Tables:
- `jane_packages_import` - Jane membership data (outstanding_balance)
- `clinicsync_memberships` - ClinicSync membership data (balance_owing, amount_due)
- `quickbooks_payments` - QuickBooks payment data (needs enhancement)
- `payment_issues` - Payment failures/outstanding balances
- `memberships` - Patient membership records

### Integration Tables:
- `ghl_sync_history` - GHL sync log
- `quickbooks_oauth_tokens` - QuickBooks auth tokens
- `clinicsync_webhook_events` - ClinicSync webhook log

### Patient Tables:
- `patients` - Main patient table
- `patient_status_lookup` - Status definitions
- `payment_method_lookup` - Payment method definitions
- `client_type_lookup` - Client type definitions



