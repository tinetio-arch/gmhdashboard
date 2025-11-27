# Membership Audit - Actionable Interface READY! ✅

## What's Complete

### ✅ Backend (100% Ready)
- **API Endpoints**:
  - `POST /api/admin/membership-audit/map-quickbooks` - Map QB customers to GMH patients
  - `GET /api/admin/membership-audit/search-patients` - Search for patients
  - `POST /api/admin/membership-audit/resolve-duplicate` - Resolve duplicate patients
  
- **Database Migration**: `migrations/20250126_membership_audit_tables.sql`
  - Creates `membership_audit_resolutions` table
  - Creates `patient_merges` table
  - Ensures `patient_qb_mapping` has required columns

### ✅ Frontend (Ready to Use)
- **Modal Components**:
  - `MapQuickBooksModal.tsx` - Search and map QB customers to GMH patients
  - `ResolveDuplicateModal.tsx` - Select primary and merge/remove duplicates
  
- **Enhanced Audit Page**:
  - ✅ "Map Patient" buttons on unmapped QuickBooks recurring customers
  - ✅ "Resolve" buttons on duplicate patient groups
  - ✅ Integrated modals with search functionality
  - ✅ Auto-refresh after actions complete

## How to Use

### 1. Run the Database Migration
```bash
# On your server, run:
cd /home/ec2-user/apps/gmh-dashboard
node scripts/run-migration.js migrations/20250126_membership_audit_tables.sql
```

### 2. Map QuickBooks Customers
1. Go to Membership Audit page
2. Click "QuickBooks Issues" tab
3. Find unmapped recurring customers
4. Click "Map Patient" button
5. Search for the GMH patient by name, email, or phone
6. Select the correct patient
7. Click "Map Patient" to create the mapping

### 3. Resolve Duplicate Patients
1. Go to Membership Audit page
2. Click "Duplicates" tab
3. Find a duplicate group
4. Click "Resolve" button
5. Select which patient record is the primary (correct one)
6. Choose action:
   - **Merge into Primary**: All data from other records transferred to primary
   - **Remove Others**: Other records marked inactive
7. Click the action button to complete

## What Each Action Does

### Map QuickBooks Customer
- Creates entry in `patient_qb_mapping` table
- Updates patient payment method if needed
- Deactivates any existing mappings for that customer/patient
- Tracks resolution in audit log

### Resolve Duplicate (Merge)
- Transfers all dispenses to primary patient
- Transfers all memberships to primary patient
- Transfers GHL sync history
- Consolidates patient mappings
- Marks duplicate records as inactive
- Preserves DEA records (they reference patient_id)
- Creates merge history record

### Resolve Duplicate (Remove)
- Marks duplicate records as inactive
- Tracks resolution in audit log
- Does not transfer data (use Merge for that)

## Next Steps / Future Enhancements

1. **Unmapped GMH Patients** - Currently shows "Need QB Customer Search" placeholder
   - Need to add QB customer search functionality
   - Then allow mapping GMH patient → QB customer

2. **Create Patient from Membership** - For "Needs Intake" tab
   - One-click patient creation from membership data
   - Pre-fills form with membership info

3. **Bulk Actions** - Select multiple items to resolve at once

4. **Audit History** - View history of all resolutions

## Notes

- All actions are logged for auditing
- Patient merges preserve DEA compliance records
- Page auto-refreshes after actions to show updated data
- Errors are displayed in modals if something fails

