# GHL Field Mapping Audit

## Master Copy Confirmation
✅ **GMH Dashboard is the MASTER copy** - Comment in code: "GMH DATA ALWAYS OVERWRITES GHL - NO MERGE!"
✅ **Sync uses PUT** - This should overwrite, but need to verify GHL API behavior

## Current Field Mapping Status

### Standard GHL Contact Fields (Mapped ✅)
- `firstName` ← `patient_name` (parsed)
- `lastName` ← `patient_name` (parsed)
- `name` ← `patient_name`
- `email` ← `email` or `qbo_customer_email`
- `phone` ← `phone_number` (normalized)
- `address1` ← `address_line1` (from parsed address)
- `city` ← `city` (from parsed address)
- `state` ← `state` (from parsed address, validated)
- `postalCode` ← `postal_code` (from parsed address)
- `country` ← Always "US"
- `source` ← "GMH Dashboard"

### Standard GHL Contact Fields (NOT Mapped ❌)
- `dateOfBirth` ← `date_of_birth` (MISSING - should be standard field)

### Custom Fields (Mapped ✅)
- `last_lab_date` ← `last_lab` (GMH ALWAYS wins, even if empty)
- `next_lab_date` ← `next_lab` (GMH ALWAYS wins, even if empty)
- `method_of_payment` ← `method_of_payment`
- `patient_status` ← `alert_status` or `status_key`
- `client_type` ← `type_of_client`
- `regimen` ← `regimen`
- `service_start_date` ← `service_start_date`

### Custom Fields (NOT Mapped ❌)
- `contract_end` ← `contract_end` (MISSING)
- `patient_notes` ← `patient_notes` (MISSING)
- `lab_notes` ← `lab_notes` (MISSING)
- `membership_owes` ← `membership_owes` (MISSING)
- `last_supply_date` ← `last_supply_date` (MISSING)
- `eligible_for_next_supply` ← `eligible_for_next_supply` (MISSING)
- `supply_status` ← `supply_status` (MISSING)
- `membership_program` ← `membership_program` (MISSING)
- `membership_status` ← `membership_status` (MISSING)
- `membership_balance` ← `membership_balance` (MISSING)
- `next_charge_date` ← `next_charge_date` (MISSING)
- `last_charge_date` ← `last_charge_date` (MISSING)
- `last_controlled_dispense_at` ← `last_controlled_dispense_at` (MISSING)
- `last_dea_drug` ← `last_dea_drug` (MISSING)

## Sync Behavior Verification Needed
1. Does PUT `/contacts/{id}` fully overwrite or merge?
2. Are custom fields fully replaced or merged?
3. Should we clear custom fields not in the payload?

## Action Items
1. Add missing `dateOfBirth` standard field
2. Add all missing custom fields
3. Verify PUT overwrite behavior
4. Ensure custom fields are fully replaced (not merged)









