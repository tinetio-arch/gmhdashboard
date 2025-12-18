# GHL Mapping Verification & Master Copy Confirmation

## ✅ Master Copy Confirmation

**GMH Dashboard is the MASTER copy** - All changes flow ONE WAY: GMH → GHL

### Evidence:
1. **Code Comment**: `formatPatientForGHL` explicitly states: "GMH DATA ALWAYS OVERWRITES GHL - NO MERGE!"
2. **Sync Function**: `syncPatientToGHL` documentation confirms: "GMH Dashboard is the MASTER copy"
3. **API Method**: Uses `PUT /contacts/{id}` which should fully replace contact data
4. **No Reverse Sync**: There is NO code that reads from GHL and updates GMH

## ✅ Complete Field Mapping

### Standard GHL Contact Fields (All Mapped)
- ✅ `firstName` ← parsed from `patient_name`
- ✅ `lastName` ← parsed from `patient_name`
- ✅ `name` ← `patient_name`
- ✅ `email` ← `email` or `qbo_customer_email` (fallback)
- ✅ `phone` ← `phone_number` (normalized)
- ✅ `address1` ← `address_line1` (from parsed address)
- ✅ `city` ← `city` (from parsed address)
- ✅ `state` ← `state` (validated, defaults to AZ if invalid)
- ✅ `postalCode` ← `postal_code` (cleaned to 5 digits)
- ✅ `country` ← Always "US"
- ✅ `source` ← "GMH Dashboard"

### Custom Fields (All Mapped - 20 fields)
- ✅ `date_of_birth` ← `date_of_birth`
- ✅ `last_lab_date` ← `last_lab` (**GMH ALWAYS WINS, even if empty**)
- ✅ `next_lab_date` ← `next_lab` (**GMH ALWAYS WINS, even if empty**)
- ✅ `method_of_payment` ← `method_of_payment`
- ✅ `patient_status` ← `alert_status` or `status_key`
- ✅ `client_type` ← `type_of_client`
- ✅ `regimen` ← `regimen`
- ✅ `service_start_date` ← `service_start_date`
- ✅ `contract_end` ← `contract_end`
- ✅ `patient_notes` ← `patient_notes`
- ✅ `lab_notes` ← `lab_notes`
- ✅ `membership_owes` ← `membership_owes`
- ✅ `membership_program` ← `membership_program`
- ✅ `membership_status` ← `membership_status`
- ✅ `membership_balance` ← `membership_balance`
- ✅ `last_supply_date` ← `last_supply_date`
- ✅ `eligible_for_next_supply` ← `eligible_for_next_supply`
- ✅ `supply_status` ← `supply_status`
- ✅ `next_charge_date` ← `next_charge_date`
- ✅ `last_charge_date` ← `last_charge_date`
- ✅ `last_controlled_dispense_at` ← `last_controlled_dispense_at`
- ✅ `last_dea_drug` ← `last_dea_drug`

## ⚠️ Important Notes

### Lab Dates Priority
The user specifically requested that **Last Lab** and **Next Lab** dates from GMH should **ALWAYS TRUMP** (overwrite) any corresponding data in GoHighLevel, even if the GMH value is empty. This is implemented.

### PUT Overwrite Behavior
- GHL's `PUT /contacts/{id}` endpoint should fully replace the contact
- However, **custom fields behavior may vary**:
  - If GHL merges custom fields (keeps fields not in payload), we may need to explicitly clear unused fields
  - If GHL fully replaces custom fields, current implementation is correct
- **Recommendation**: Test with a contact that has custom fields not in our payload to verify they get cleared

### Tags Behavior
- Tags are explicitly set in the payload: `contactData.tags = shouldClearTags ? [] : tagNames`
- For inactive patients: ALL tags are removed (empty array)
- For active patients: Only tags calculated from GMH data are applied
- This ensures GHL tags match GMH patient state

## 🔄 Sync Flow

1. **Find Contact**: Search GHL by email or phone (does NOT create new contacts)
2. **Format Data**: Build complete contact payload with ALL fields from GMH
3. **Calculate Tags**: Determine tags based on GMH patient status/type
4. **Update Contact**: PUT to GHL with complete payload (should overwrite)
5. **Log Sync**: Record sync history in database

## ✅ Verification Checklist

- [x] GMH confirmed as master copy in code comments
- [x] All patient fields mapped to GHL
- [x] Lab dates always overwrite (even if empty)
- [x] Tags match GMH patient state
- [x] Inactive patients have all tags removed
- [x] One-way sync (GMH → GHL only)
- [ ] **TODO**: Test PUT behavior with custom fields (verify full overwrite vs merge)














