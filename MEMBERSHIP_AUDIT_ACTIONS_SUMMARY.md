# Membership Audit - Actionable Interface Summary

## ✅ What's Been Created

### 1. API Endpoints
- **`POST /api/admin/membership-audit/map-quickbooks`** - Map QuickBooks customers to GMH patients
  - Creates entry in `patient_qb_mapping` table
  - Updates patient payment method
  - Tracks resolution in `membership_audit_resolutions`

- **`GET /api/admin/membership-audit/search-patients`** - Search for patients by name, email, or phone
  - Returns up to 20 matching patients
  - Used for patient selection in mapping modals

- **`POST /api/admin/membership-audit/resolve-duplicate`** - Resolve duplicate patient issues
  - Merge option: Transfers all data to primary patient, marks duplicates inactive
  - Remove option: Simply marks duplicates as inactive
  - Preserves DEA records and historical data
  - Tracks merge history in `patient_merges` table

### 2. Database Migration
- **`migrations/20250126_membership_audit_tables.sql`** - Creates necessary tables:
  - `membership_audit_resolutions` - Tracks resolved audit issues
  - `patient_merges` - Tracks patient merge history
  - Ensures `patient_qb_mapping` has required columns

### 3. Documentation
- **`MEMBERSHIP_AUDIT_ACTION_PLAN.md`** - Complete plan for actionable interface
- **`MEMBERSHIP_AUDIT_ACTIONS_SUMMARY.md`** - This file

## 🚧 Next Steps - UI Components Needed

### 1. Enhanced SimplifiedAuditClient Component
The current `SimplifiedAuditClient.tsx` needs to be enhanced with:

#### QuickBooks Mapping Actions
- Add "Map Patient" button next to each unmapped QuickBooks recurring/patient
- Open modal to search and select GMH patient
- Show confirmation before mapping
- Refresh data after successful mapping

#### Duplicate Resolution Actions  
- Add "Resolve" button for each duplicate group
- Open modal showing all duplicate records side-by-side
- Radio buttons to select primary patient
- Action buttons: "Merge into Primary" or "Remove Others"
- Show preview of what will happen
- Refresh data after resolution

#### Implementation Pattern
```tsx
// State for modals
const [mapModalOpen, setMapModalOpen] = useState(false);
const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
const [selectedItem, setSelectedItem] = useState(null);

// Action handlers
const handleMapQuickBooks = async (qbCustomerId: string, patientId: string) => {
  const response = await fetch('/api/admin/membership-audit/map-quickbooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ qbCustomerId, patientId, matchMethod: 'manual' })
  });
  if (response.ok) {
    // Refresh page or reload data
    window.location.reload();
  }
};

const handleResolveDuplicate = async (primaryId: string, duplicateIds: string[], action: 'merge' | 'remove') => {
  const response = await fetch('/api/admin/membership-audit/resolve-duplicate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ primaryPatientId: primaryId, duplicatePatientIds: duplicateIds, action, normName })
  });
  if (response.ok) {
    window.location.reload();
  }
};
```

### 2. Modal Components
Create reusable modal components:

- **`MapQuickBooksModal.tsx`** - For QuickBooks patient mapping
  - Search input for GMH patients
  - Results list with patient details
  - Select and map button

- **`ResolveDuplicateModal.tsx`** - For duplicate resolution
  - Display all duplicates side-by-side
  - Radio buttons for primary selection
  - Action buttons (merge/remove)
  - Confirmation dialog

## 📋 Testing Checklist

After implementing the UI:

- [ ] Can map QuickBooks recurring customers to GMH patients
- [ ] Can map QuickBooks unmapped patients to existing GMH patients  
- [ ] Patient search works correctly in mapping modal
- [ ] Mapping updates `patient_qb_mapping` table correctly
- [ ] Can select primary patient in duplicate resolution
- [ ] Can merge duplicates (transfers all data)
- [ ] Can remove duplicates (marks inactive)
- [ ] DEA records preserved during merge
- [ ] Resolution tracking works
- [ ] Page refreshes after actions complete
- [ ] Errors are displayed to user

## 🔄 Future Enhancements

1. **Create Patient from Membership** - Add ability to create new patients from "Needs Intake" data
2. **Bulk Actions** - Select multiple items and resolve at once
3. **Audit History** - Show history of all resolutions
4. **Undo Functionality** - Ability to undo recent resolutions
5. **Auto-matching** - Suggest matches based on fuzzy name/email matching










