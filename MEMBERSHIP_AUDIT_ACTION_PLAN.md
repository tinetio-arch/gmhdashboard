# Membership Audit - Actionable Interface Plan

## Problem Statement
The membership audit currently shows issues but doesn't allow the user to fix them:
- QuickBooks patients are listed but can't be mapped
- Duplicate patients are identified but can't be resolved
- "Needs Intake" patients can't be created from the audit page

## Solution Overview

### 1. QuickBooks Patient Mapping
**Action:** Map QuickBooks customers to GMH patients
- For each unmapped QuickBooks recurring/patient, show a "Map Patient" button
- Opens a searchable modal to find and select the correct GMH patient
- Creates entry in `patient_qb_mapping` table
- Updates patient payment method if needed

### 2. Duplicate Patient Resolution
**Actions:**
- **Select Primary:** Choose which patient record is correct
- **Merge:** Merge all duplicate records into the primary (transfer all data)
- **Remove:** Mark incorrect records as inactive/remove them
- Preserve DEA records and all historical data

### 3. Create Patient from Membership
**Action:** Create new GMH patient from "Needs Intake" membership data
- Pre-fills form with membership data
- Links to ClinicSync membership
- Creates patient record in one click

## Database Schema

### Existing Tables
- `patient_qb_mapping`: Maps GMH patients to QuickBooks customers
  - `patient_id` (UUID)
  - `qb_customer_id` (TEXT)
  - `qb_customer_email` (TEXT)
  - `qb_customer_name` (TEXT)
  - `match_method` (TEXT)
  - `is_active` (BOOLEAN)
  - `created_at`, `updated_at`

### New Tables Needed
- `membership_audit_resolutions`: Track resolved issues
  - `resolution_id` (UUID PRIMARY KEY)
  - `resolution_type` (TEXT) - 'quickbooks_mapped', 'duplicate_resolved', 'patient_created'
  - `issue_key` (TEXT) - Unique identifier for the issue
  - `patient_id` (UUID) - Related patient if applicable
  - `resolved_at` (TIMESTAMP)
  - `resolved_by` (TEXT)
  - `resolution_data` (JSONB) - Details of the resolution

- `patient_merges`: Track patient merges
  - `merge_id` (UUID PRIMARY KEY)
  - `primary_patient_id` (UUID)
  - `merged_patient_id` (UUID)
  - `merged_at` (TIMESTAMP)
  - `merged_by` (TEXT)
  - `merge_notes` (TEXT)

## API Endpoints

### 1. Map QuickBooks Patient
```
POST /api/admin/membership-audit/map-quickbooks
Body: {
  qbCustomerId: string,
  patientId: string,
  matchMethod?: string
}
```

### 2. Resolve Duplicate
```
POST /api/admin/membership-audit/resolve-duplicate
Body: {
  primaryPatientId: string,
  duplicatePatientIds: string[],
  action: 'merge' | 'remove'
}
```

### 3. Create Patient from Membership
```
POST /api/admin/membership-audit/create-patient
Body: {
  membershipData: {
    patient_name: string,
    plan_name: string,
    clinicsync_patient_id?: string,
    ...
  }
}
```

### 4. Search Patients (for mapping)
```
GET /api/admin/membership-audit/search-patients?q=searchTerm
Returns: List of matching patients with details
```

## UI Components

### 1. QuickBooks Mapping Modal
- Search input for GMH patients
- Results showing name, email, phone, status
- "Map" button to create mapping
- Shows existing mappings if any

### 2. Duplicate Resolution Modal
- Shows all duplicate records side-by-side
- Radio buttons to select primary
- Action buttons: "Merge into Primary" or "Remove Others"
- Shows what data will be preserved

### 3. Create Patient Modal
- Pre-filled form with membership data
- Editable fields
- "Create Patient" button

## Implementation Steps

1. Create database tables for tracking resolutions
2. Create API endpoints for actions
3. Update SimplifiedAuditClient with action buttons
4. Add modals for each action type
5. Add search functionality for patient lookup
6. Test and deploy







