# Membership Audit System - Deep Dive Analysis & Fix Plan

## 🔍 Current Problem Analysis

### Where "9 Jane Patients" Payment Issue Count Comes From

**Source:** `lib/testosteroneInventory.ts` → `getPaymentFailureStats()`

**Query Logic:**
```sql
SELECT 
  COUNT(DISTINCT pn.patient_id) as count,
  COALESCE(SUM(pkg.outstanding_balance::numeric), 0) as total
FROM jane_packages_import pkg
INNER JOIN normalized_patients pn ON pn.normalized_name = lower(pkg.norm_name)
WHERE pn.patient_id IS NOT NULL
  AND COALESCE(pkg.outstanding_balance, 0)::numeric > 0
  AND NOT (
    COALESCE(pn.status_key, '') ILIKE 'inactive%'
    OR COALESCE(pn.status_key, '') ILIKE 'discharg%'
  )
```

**What This Counts:**
- Patients in `jane_packages_import` table with `outstanding_balance > 0`
- That have a matching patient in `patients` table (by normalized name)
- That are NOT inactive or discharged

**The Problem:**
- This counts **membership packages** with outstanding balances, NOT payment failures
- A patient can have multiple packages, so this may count the same patient multiple times
- It doesn't distinguish between:
  - Legitimate outstanding balances (normal billing cycle)
  - Actual payment failures/declines
  - Historical balances that should be written off

**Why It's Confusing:**
- "Payment Issues" implies failed payments, but this is just outstanding balances
- No distinction between "owed money" vs "can't collect money"
- Redundant with "Outstanding Balances" section

---

## 📊 Data Sources Overview

### 1. **`jane_packages_import` Table**
- **Source:** Imported from Jane EMR/ClinicSync system
- **Contains:** Membership packages, contracts, billing cycles
- **Key Fields:**
  - `patient_name`, `norm_name` (normalized)
  - `plan_name`, `status`, `remaining_cycles`
  - `outstanding_balance`, `contract_end_date`
  - `purchase_date`, `start_date`
- **Issues:**
  - May have duplicates (same patient, multiple packages)
  - May have orphaned records (patient deleted but package remains)
  - Status may not match GMH patient status

### 2. **`quickbooks_payments` Table**
- **Source:** QuickBooks Online API sync
- **Contains:** Invoices, payments, balances
- **Key Fields:**
  - `qb_customer_id`, `patient_id` (if mapped)
  - `invoice_number`, `balance`, `days_overdue`
  - `payment_status`
- **Issues:**
  - Not all QB customers are mapped to GMH patients
  - Balance may be stale if sync fails
  - Doesn't distinguish between active invoices vs old debt

### 3. **`payment_issues` Table**
- **Source:** Created when payment failures occur
- **Contains:** Payment decline/failure records
- **Key Fields:**
  - `patient_id`, `issue_type`, `amount_owed`
  - `resolved_at`, `notes`
- **Issues:**
  - May not be created for all payment failures
  - Resolution tracking may be incomplete
  - May have duplicates if same issue logged multiple times

### 4. **`patients` Table**
- **Source:** GMH Dashboard (master patient record)
- **Contains:** All patient data
- **Key Fields:**
  - `patient_id`, `full_name`, `status_key`
  - `payment_method_key`, `client_type_key`
  - `membership_balance`, `membership_program`
- **Issues:**
  - May have duplicates (same person, different records)
  - Status may not match external system status
  - Membership data may be stale

### 5. **`clinicsync_memberships` Table**
- **Source:** ClinicSync/Jane EMR API
- **Contains:** Active memberships from Jane
- **Key Fields:**
  - `clinicsync_patient_id`, `raw_payload` (JSON)
  - `membership_status`
- **Issues:**
  - May not sync regularly
  - JSON structure may change
  - May have duplicates

### 6. **Mapping Tables**
- **`patient_clinicsync_mapping`**: Links GMH patients to ClinicSync patients
- **`patient_qb_mapping`**: Links GMH patients to QuickBooks customers
- **`membership_audit_resolutions`**: Tracks resolved audit issues

---

## 🎯 What Data We Actually Need to Audit

### Critical Audit Points:

1. **Patient-Membership Alignment**
   - Every active Jane membership should have a GMH patient
   - Every GMH patient with Jane payment method should have a membership
   - Duplicate memberships should be identified and merged

2. **Payment Status Accuracy**
   - Outstanding balances should reflect actual owed amounts
   - Payment failures should be tracked separately from balances
   - Resolved issues should be clearly marked

3. **Status Synchronization**
   - GMH patient status should match membership status
   - Inactive/discharged patients shouldn't show active memberships
   - Contract renewals should update patient status

4. **Data Completeness**
   - Missing patient records (membership exists, no GMH patient)
   - Missing memberships (GMH patient exists, no membership)
   - Incomplete mapping (patient exists but not linked)

5. **Duplicate Detection**
   - Same patient with multiple GMH records
   - Same patient with multiple memberships
   - Same patient with multiple QuickBooks customers

---

## 🛠️ Fix Plan

### Phase 1: Fix Dashboard Metrics (Immediate)

**Remove Redundant Metrics:**
- ❌ Remove "Payment Issues" card (redundant with Outstanding Balances)
- ❌ Remove "Renewals Due" (not actionable)
- ❌ Remove "Expired Memberships" (not actionable)

**Keep & Improve:**
- ✅ "Outstanding Balances" - Show actual actionable items
- ✅ Split by source (Jane vs QuickBooks)
- ✅ Only show patients that need action (not just any balance)

**New Metrics Needed:**
- ✅ "Payment Failures" - Actual failed charges (from `payment_issues` table)
- ✅ "Unmapped Memberships" - Memberships without GMH patients
- ✅ "Unmapped Patients" - GMH patients without memberships

### Phase 2: Enhanced Membership Audit System

#### 2.1 Data Source Visualization

**Show for each patient:**
- ✅ Which systems they exist in (GMH, Jane, QuickBooks)
- ✅ Mapping status (linked/unlinked)
- ✅ Data source for each field (where did this come from?)
- ✅ Last sync timestamp for each source

#### 2.2 Missing Patient Detection

**Identify:**
- Jane memberships without GMH patients
- QuickBooks customers without GMH patients
- GMH patients without any external system link

**Action:**
- One-click "Create Patient from Membership"
- Pre-fill form with data from membership
- Auto-link after creation

#### 2.3 Duplicate Detection & Merging

**Detect:**
- Multiple GMH records for same person (by name, phone, email)
- Multiple memberships for same person
- Multiple QuickBooks customers for same person

**Merge Tool:**
- Select primary record
- Show all data from all sources
- Choose which data to keep
- Merge into one profile
- Update all mappings

#### 2.4 Data Manipulation Tools

**For Each Patient:**
- ✅ Edit membership data directly
- ✅ Override sync data (mark as "manual override")
- ✅ Add notes explaining discrepancies
- ✅ Force re-sync from source
- ✅ Mark as resolved (don't show in audit)

**Bulk Actions:**
- ✅ Export all audit issues to CSV
- ✅ Bulk resolve (mark multiple as resolved)
- ✅ Bulk link (link multiple patients to memberships)
- ✅ Bulk create (create multiple patients from memberships)

#### 2.5 Data Source Tracking

**For Each Field:**
- Show source system (Jane, QuickBooks, Manual)
- Show last updated timestamp
- Show if it's a manual override
- Show sync status (synced, pending, error)

**Example:**
```
Outstanding Balance: $150.00
  Source: Jane EMR
  Last Synced: 2025-01-23 10:30 AM
  Status: ✅ Synced
  
Contract End Date: 2025-06-30
  Source: Manual Override
  Last Updated: 2025-01-20 2:15 PM
  Note: "Extended contract per patient request"
```

---

## 📋 Implementation Steps

### Step 1: Fix Payment Issues Query
- Change from counting `outstanding_balance > 0` to counting actual `payment_issues` records
- Only count unresolved payment issues
- Distinguish between Jane and QuickBooks payment failures

### Step 2: Remove Redundant Dashboard Metrics
- Remove "Payment Issues" card
- Remove "Renewals Due" and "Expired Memberships"
- Keep only actionable metrics

### Step 3: Enhance Membership Audit Page
- Add data source visualization
- Add missing patient detection with one-click create
- Add duplicate detection with merge tool
- Add data manipulation tools

### Step 4: Add Data Source Tracking
- Track source system for each field
- Track last sync timestamp
- Track manual overrides

### Step 5: Add Bulk Operations
- Bulk export
- Bulk resolve
- Bulk link
- Bulk create

---

## 🔧 Technical Implementation Details

### New Database Tables Needed

```sql
-- Track data source for each patient field
CREATE TABLE patient_field_sources (
  patient_id UUID REFERENCES patients(patient_id),
  field_name TEXT,
  source_system TEXT, -- 'jane', 'quickbooks', 'manual'
  source_value TEXT,
  last_synced_at TIMESTAMP,
  is_override BOOLEAN DEFAULT FALSE,
  override_note TEXT,
  PRIMARY KEY (patient_id, field_name)
);

-- Track merge history
CREATE TABLE patient_merge_history (
  merge_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  primary_patient_id UUID REFERENCES patients(patient_id),
  merged_patient_id UUID REFERENCES patients(patient_id),
  merged_at TIMESTAMP DEFAULT NOW(),
  merged_by TEXT,
  merge_notes TEXT
);

-- Enhanced audit resolution tracking
CREATE TABLE membership_audit_resolutions_enhanced (
  resolution_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  resolution_type TEXT, -- 'missing_patient', 'duplicate', 'unmapped', etc.
  patient_id UUID REFERENCES patients(patient_id),
  membership_id TEXT, -- reference to jane_packages_import or QB
  resolved_at TIMESTAMP DEFAULT NOW(),
  resolved_by TEXT,
  resolution_notes TEXT,
  is_permanent BOOLEAN DEFAULT FALSE -- if true, don't show in audit again
);
```

### New API Endpoints Needed

```
GET  /api/admin/memberships/audit/sources/:patientId
     - Get data source info for all patient fields

POST /api/admin/memberships/audit/create-patient
     - Create patient from membership data

POST /api/admin/memberships/audit/merge-patients
     - Merge duplicate patients

POST /api/admin/memberships/audit/bulk-resolve
     - Bulk resolve audit issues

POST /api/admin/memberships/audit/bulk-link
     - Bulk link patients to memberships

GET  /api/admin/memberships/audit/export
     - Export all audit issues to CSV

POST /api/admin/memberships/audit/override-field
     - Manually override a field value
```

---

## ✅ Success Criteria

1. **Clear Data Sources**
   - Can see where every piece of data came from
   - Can see when it was last synced
   - Can see if it's been manually overridden

2. **Easy Patient Management**
   - Can create patient from membership in one click
   - Can merge duplicates easily
   - Can bulk resolve issues

3. **Accurate Metrics**
   - Payment failures only show actual failures
   - Outstanding balances only show actionable items
   - No redundant metrics

4. **Complete Audit Trail**
   - Every action is logged
   - Can see history of changes
   - Can undo mistakes

---

## 🚀 Next Steps

1. **Immediate:** Fix payment issues query and remove redundant metrics
2. **Short-term:** Enhance membership audit page with data source tracking
3. **Medium-term:** Add duplicate detection and merge tools
4. **Long-term:** Add bulk operations and advanced data manipulation

---

## 📝 Notes

- The "9 Jane patients" count is misleading - it's counting membership packages with balances, not payment failures
- Need to distinguish between "owed money" (normal) vs "can't collect" (problem)
- Membership audit system needs to be the single source of truth for data reconciliation
- All data manipulation should be logged and reversible






