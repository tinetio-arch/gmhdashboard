# GMH to GoHighLevel - Field Mapping (Based on Your Patient Sheet)

## 🎯 Priority: Map ALL Fields from Your Patient_Data_Entry Sheet

Based on your actual patient table, here are ALL the important fields:

---

## 📋 COMPLETE FIELD MAPPING

### ✅ Core Identity (CRITICAL - Always Sync)

| GMH Field | Type | GHL Field | GHL Type | Currently Synced? |
|-----------|------|-----------|----------|-------------------|
| `patient_name` | string | `name` | Native | ✅ YES |
| `patient_name` (first) | string | `firstName` | Native | ✅ YES |
| `patient_name` (last) | string | `lastName` | Native | ✅ YES |
| `email` | string | `email` | Native | ✅ YES |
| `phone_number` | string | `phone` | Native | ✅ YES |
| `date_of_birth` | date | `dateOfBirth` | Native | ❌ **NEED TO ADD** |

### ✅ Address (CRITICAL - Always Sync)

| GMH Field | Type | GHL Field | GHL Type | Currently Synced? |
|-----------|------|-----------|----------|-------------------|
| `address_line1` | string | `address1` | Native | ✅ YES |
| `city` | string | `city` | Native | ✅ YES |
| `state` | string | `state` | Native | ✅ YES |
| `postal_code` | string | `postalCode` | Native | ✅ YES |

### ✅ Status & Client Info (CRITICAL - Drives Tags)

| GMH Field | Type | GHL Field | GHL Type | Currently Synced? |
|-----------|------|-----------|----------|-------------------|
| `alert_status` | string | Custom: `patient_status` | Text | ✅ YES |
| `status_key` | string | Custom: `patient_status_key` | Text | ✅ YES (as patient_status) |
| `type_of_client` | string | Custom: `client_type` | Text | ✅ YES |
| `client_type_key` | string | Custom: `client_type_key` | Text | ❌ **NEED TO ADD** |
| `method_of_payment` | string | Custom: `payment_method` | Text | ❌ **NEED TO ADD** |
| `is_primary_care` | boolean | Custom: `is_primary_care` | Checkbox | ❌ **NEED TO ADD** |

### ✅ Clinical & Treatment (IMPORTANT - Track Care)

| GMH Field | Type | GHL Field | GHL Type | Currently Synced? |
|-----------|------|-----------|----------|-------------------|
| `regimen` | string | Custom: `regimen` | Text | ✅ YES |
| `lab_status` | string | Custom: `lab_status` | Text | ❌ **NEED TO ADD** |
| `last_lab` | date | Custom: `last_lab_date` | Date | ✅ YES |
| `next_lab` | date | Custom: `next_lab_date` | Date | ✅ YES |
| `last_supply_date` | date | Custom: `last_supply_date` | Date | ❌ **NEED TO ADD** |
| `eligible_for_next_supply` | date | Custom: `eligible_for_next_supply` | Date | ❌ **NEED TO ADD** |
| `supply_status` | string | Custom: `supply_status` | Text | ❌ **NEED TO ADD** |
| `last_controlled_dispense_at` | date | Custom: `last_dea_dispense` | Date | ❌ **NEED TO ADD** |
| `last_dea_drug` | string | Custom: `last_dea_drug` | Text | ❌ **NEED TO ADD** |

### ✅ Dates & Lifecycle (IMPORTANT - Track Relationship)

| GMH Field | Type | GHL Field | GHL Type | Currently Synced? |
|-----------|------|-----------|----------|-------------------|
| `service_start_date` | date | Custom: `service_start_date` | Date | ✅ YES |
| `contract_end` | date | Custom: `contract_end_date` | Date | ❌ **NEED TO ADD** |
| `date_added` | date | Custom: `gmh_date_added` | Date | ❌ **NEED TO ADD** |
| `last_modified` | date | Custom: `gmh_last_modified` | Date | ❌ **NEED TO ADD** |

### ✅ Membership & Financial (IMPORTANT - Track Status)

| GMH Field | Type | GHL Field | GHL Type | Currently Synced? |
|-----------|------|-----------|----------|-------------------|
| `membership_program` | string | Custom: `membership_program` | Text | ❌ **NEED TO ADD** |
| `membership_status` | string | Custom: `membership_status` | Text | ❌ **NEED TO ADD** |
| `membership_owes` | string | Custom: `membership_balance` | Currency | ❌ **NEED TO ADD** |
| `membership_balance` | string | Custom: `membership_balance_amt` | Currency | ❌ **NEED TO ADD** |
| `next_charge_date` | date | Custom: `next_charge_date` | Date | ❌ **NEED TO ADD** |
| `last_charge_date` | date | Custom: `last_charge_date` | Date | ❌ **NEED TO ADD** |
| `regular_client` | boolean | Custom: `regular_client` | Checkbox | ❌ **NEED TO ADD** |
| `is_verified` | boolean | Custom: `verified_patient` | Checkbox | ❌ **NEED TO ADD** |

### ❌ Internal/Metadata (DO NOT SYNC - Keep Private)

| GMH Field | Type | Reason to Keep Private |
|-----------|------|------------------------|
| `patient_notes` | text | **HIPAA/Privacy** - Clinical notes |
| `lab_notes` | text | **HIPAA/Privacy** - Clinical notes |
| `added_by` | string | Internal staff tracking |
| `qbo_customer_email` | string | Internal accounting (use email instead) |

---

## 🏷️ TAG RULES

### Special Rule: Inactive Patients

```javascript
IF status_key === 'inactive' THEN:
  1. Update all contact fields in GHL
  2. REMOVE ALL TAGS (complete wipe)
  3. Add single tag: "Inactive Patient"
  4. Keep contact in GHL (don't delete - keep history)
```

### Tag Application for Active Patients

**Status-Based Tags:**
- `active` → "Active Patient"
- `active_pending` → "Active - Pending Labs"
- `hold_payment_research` → "Hold - Payment Issue"
- `hold_service_change` → "Hold - Service Change"
- `hold_contract_renewal` → "Hold - Contract Renewal"
- `hold_patient_research` → "Hold - Patient Research"

**Men's Health "existing" Tag:**
- Applied when `client_type_key` matches:
  - `qbo_tcmh_180_month`
  - `qbo_f_f_fr_veteran_140_month`
  - `jane_tcmh_180_month`
  - `jane_f_f_fr_veteran_140_month`
  - `approved_disc_pro_bono_pt`
  - `mens_health_qbo`

**Primary Care Tag:**
- `is_primary_care = true` → "PrimeCare Patient"

**Condition Tags:**
- Lab status contains "overdue" → "Labs Overdue"
- `membership_owes > 0` → "Has Membership Balance"
- `is_verified = true` → "Verified Patient"
- Supply status = "Pending" → "Supply Request Pending"
- All GMH patients → "GMH Patient"

---

## 🔄 SYNC BEHAVIOR

### GMH is the Parent (Source of Truth)

```
GMH Patient Updated → Automatically Update GHL Contact
```

**What Gets Synced:**
1. All contact fields (name, email, phone, address, DOB)
2. All custom fields (status, membership, clinical data)
3. Tags recalculated based on current status
4. Last modified timestamp

**What NEVER Gets Synced:**
- Patient notes (clinical privacy)
- Lab notes (clinical privacy)
- Internal staff fields

### Sync Triggers

1. **Manual**: Click sync button in dashboard
2. **On Save**: When patient record updated (future)
3. **Scheduled**: Hourly cron job (already configured)
4. **Bulk**: Sync all button

---

## 📊 SUMMARY OF CHANGES NEEDED

### Currently Syncing (10 fields):
✅ Name, Email, Phone, Address (4 core)
✅ Status, Client Type, Regimen (3 clinical)
✅ Service Start, Last Lab, Next Lab (3 dates)

### Need to Add (21 fields):
❌ Date of Birth
❌ Client Type Key
❌ Payment Method
❌ Is Primary Care
❌ Lab Status
❌ Last Supply Date
❌ Eligible for Next Supply
❌ Supply Status
❌ Last DEA Dispense
❌ Last DEA Drug
❌ Contract End Date
❌ Date Added (GMH)
❌ Last Modified (GMH)
❌ Membership Program
❌ Membership Status
❌ Membership Balance (2 fields)
❌ Next Charge Date
❌ Last Charge Date
❌ Regular Client
❌ Verified Patient

### Special Logic to Add:
❌ Inactive patients → Remove all tags
❌ Primary Care flag → Add PrimeCare tag

---

## ✅ YOUR APPROVAL NEEDED

Should I proceed to update the sync code to include:

1. **All 21 additional fields** listed above?
2. **Inactive patient logic** (remove all tags)?
3. **Primary care tag** logic?

Once you approve, I'll:
1. Update the sync code
2. Test with 1 patient
3. Deploy to server
4. Then you can sync all patients!

**Do you want me to add ALL these fields to the sync?**
