# GMH to GoHighLevel Data Mapping

## 🎯 Sync Architecture

**GMH Control Center = PARENT (Source of Truth)**
- All patient data managed in GMH
- Changes in GMH → Automatically sync to GHL
- GHL is read-only mirror (display/marketing tool)

## 📊 Current Data Mappings

### Patient Core Fields → GHL Contact Fields

| GMH Field | GHL Field | Notes |
|-----------|-----------|-------|
| `patient_name` (full) | `name` | Full name |
| `patient_name` (split) | `firstName` | First word |
| `patient_name` (split) | `lastName` | Remaining words |
| `email` | `email` | Primary identifier for matching |
| `qbo_customer_email` | `email` (fallback) | If primary email missing |
| `phone_number` | `phone` | With + formatting |
| `address_line1` | `address1` | Street address |
| `city` | `city` | City |
| `state` | `state` | State code |
| `postal_code` | `postalCode` | ZIP |
| - | `source` | Set to "GMH Dashboard" |

### GMH Extended Fields → GHL Custom Fields

| GMH Field | GHL Custom Field | Value |
|-----------|------------------|-------|
| `status_key` | `patient_status` | active, inactive, hold_*, etc. |
| `alert_status` | `patient_status` (display) | "Active", "Inactive", etc. |
| `type_of_client` | `client_type` | Full client type name |
| `regimen` | `regimen` | Treatment regimen |
| `service_start_date` | `service_start_date` | ISO date format |
| `last_lab` | `last_lab_date` | ISO date format |
| `next_lab` | `next_lab_date` | ISO date format |

### Additional Fields Available (Not Currently Synced)

| GMH Field | Suggested GHL Field | Should We Add? |
|-----------|---------------------|----------------|
| `date_of_birth` | `dateOfBirth` (native) | ⚠️ YES - Important for identity |
| `method_of_payment` | `payment_method` (custom) | ? Your choice |
| `contract_end` | `contract_end_date` (custom) | ? Your choice |
| `regular_client` | `regular_client` (custom) | ? Your choice |
| `is_verified` | `verified_patient` (custom) | ? Already as tag |
| `membership_owes` | `membership_balance` (custom) | ? Your choice |
| `membership_program` | `membership_program` (custom) | ? Your choice |
| `patient_notes` | Not synced (private) | ❌ Keep in GMH only |
| `lab_notes` | Not synced (private) | ❌ Keep in GMH only |

## 🏷️ Tag Logic

### Automatic Tags Based on Status

| GMH Status | GHL Tags Applied |
|------------|------------------|
| `active` | "Active Patient" |
| `active_pending` | "Active - Pending Labs" |
| `inactive` | **ALL TAGS REMOVED** ⚠️ |
| `hold_payment_research` | "Hold - Payment Issue" |
| `hold_service_change` | "Hold - Service Change" |
| `hold_contract_renewal` | "Hold - Contract Renewal" |

### Men's Health "existing" Tag

Applied when `client_type_key` is:
- `qbo_tcmh_180_month`
- `qbo_f_f_fr_veteran_140_month`
- `jane_tcmh_180_month`
- `jane_f_f_fr_veteran_140_month`
- `approved_disc_pro_bono_pt`
- `mens_health_qbo`

### Condition Tags (Automatic)

| Condition | Tag Applied |
|-----------|-------------|
| Labs overdue | "Labs Overdue" |
| `membership_owes > 0` | "Has Membership Balance" |
| `is_verified = true` | "Verified Patient" |
| Any patient from GMH | "GMH Patient" |

## 🔄 Sync Behavior

### When Patient Updated in GMH:
1. Find contact in GHL by email/phone
2. Update all contact fields with latest GMH data
3. Recalculate tags based on current status
4. If inactive → Remove ALL tags
5. If active → Apply appropriate tags
6. Log sync in history

### Sync Triggers (Future):
- [ ] Manual: Click sync button
- [ ] Auto: When patient record saved
- [ ] Scheduled: Hourly cron job
- [ ] Webhook: On specific events

## ⚠️ Special Rules

### Inactive Patients
```
IF status_key = 'inactive' THEN
  - Update contact info in GHL
  - Remove ALL tags (clean slate)
  - Mark as inactive in custom field
  - Do NOT delete contact (keep for history)
```

### Contact Matching
```
Priority order:
1. Existing ghl_contact_id (if already linked)
2. Match by email (primary)
3. Match by phone (fallback)
4. If no match → Log error (don't create new)
```

## 📝 Fields You Should Review

### High Priority - Add to Sync?
- ✅ `date_of_birth` - Important for identity verification
- ? `contract_end` - Useful for renewal tracking
- ? `membership_program` - Track membership types

### Medium Priority
- ? `method_of_payment` - Marketing segmentation
- ? `regular_client` - Loyalty tracking
- ? `membership_owes` - Follow-up on balances

### Keep Private (Don't Sync)
- ❌ `patient_notes` - Clinical privacy
- ❌ `lab_notes` - HIPAA concerns
- ❌ Internal staff notes

## 🎯 Questions for You

1. **Date of Birth**: Add to sync? (Recommended YES)
2. **Contract End Date**: Sync for renewal campaigns?
3. **Membership Balance**: Show in GHL for follow-up?
4. **Payment Method**: Useful for segmentation?
5. **Other fields**: Any specific fields you want synced?

## 📋 Proposed Final Mapping

Based on best practices, I recommend:

### Core Contact Info (Always Sync)
- Name, Email, Phone, Address ✅ Current
- Date of Birth ⚠️ Add this

### Clinical Info (Sync)
- Status, Client Type, Regimen ✅ Current
- Service dates, Lab dates ✅ Current

### Membership Info (Sync)
- Membership program
- Contract end date
- Balance owed (for follow-up)

### Private Info (Never Sync)
- Patient notes
- Lab notes
- Internal comments

---

**Next Steps:**
1. Review this mapping
2. Tell me which additional fields to add
3. I'll update the sync code
4. Then we test with 1 patient
5. Then bulk sync when perfect!

What additional fields do you want synced to GHL?
