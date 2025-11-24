# GMH Dashboard Backup Manifest

## Backup Date: November 22, 2024

### Server Backup Location
- **Path**: `/home/ec2-user/apps/backups/20251122_032140/`
- **Contents**:
  - `gmh-dashboard-code.tar.gz` - Complete application code (excluding node_modules, .next, .git)
  - `pm2-processes.json` - PM2 process configuration
  - `backup_info.txt` - Backup metadata

### Local Backup
- **Location**: `/Users/philschafer/Phils Fun Stuff/`
- **File**: `gmh-dashboard-local-backup-[timestamp].tar.gz`

### Key Files Backed Up

#### Configuration Files
- `.env.production` (on server)
- `pm2.config.js`
- `next.config.js`
- `package.json`
- `tsconfig.json`

#### Database Migrations
1. `migrations/add_pass_fields.sql` - Added pass_id and membership_tier to clinicsync_memberships
2. `migrations/20251122_add_quickbooks_receipts.sql` - Added QuickBooks sales receipts tables
3. `migrations/20241123_multi_membership_support.sql` - Added multi-membership support

#### Critical Application Files
- `lib/clinicsync.ts` - Core ClinicSync integration logic
- `lib/quickbooks.ts` - QuickBooks API integration
- `lib/auth.ts` - Authentication system
- `lib/db.ts` - Database connection management
- `lib/patientFinancials.ts` - Financial data aggregation
- `lib/mixedPaymentDetection.ts` - Mixed payment method detection

#### API Routes
- `/api/admin/quickbooks/*` - QuickBooks sync and metrics
- `/api/admin/clinicsync/*` - ClinicSync/Jane integration
- `/api/admin/memberships/*` - Membership audit and metrics
- `/api/admin/update-mixed-payments` - Mixed payment detection
- `/api/integrations/clinicsync/webhook` - Jane webhook handler

#### UI Components
- `app/admin/financials/` - Renamed from QuickBooks
- `app/admin/membership-audit/` - Membership reconciliation
- `app/patients/[id]/page.tsx` - Enhanced patient detail page
- `components/MultiMembershipBadge.tsx` - Multi-membership display

### Recent Changes Summary

1. **Multi-Membership Support**
   - Patients can have multiple active memberships
   - Expired memberships shown in patient profiles
   - Pass ID-based membership detection

2. **Mixed Payment Methods**
   - "Jane & QuickBooks" payment method
   - Light blue row highlighting
   - Automatic detection and updates

3. **UI Improvements**
   - QuickBooks page renamed to Financials
   - Membership Audit can now map QuickBooks patients
   - Payment issues filtered to exclude inactive patients

4. **Data Quality**
   - Enhanced membership detection logic
   - Pro-bono patient mapping
   - Improved patient matching algorithms

### Restoration Instructions

#### To Restore on Server:
```bash
# 1. Stop the application
pm2 stop gmh-dashboard

# 2. Backup current state (if needed)
cd /home/ec2-user/apps
mv gmh-dashboard gmh-dashboard.old

# 3. Extract backup
tar -xzf backups/20251122_032140/gmh-dashboard-code.tar.gz

# 4. Install dependencies
cd gmh-dashboard
npm install

# 5. Build application
npm run build

# 6. Restore PM2 process
pm2 delete gmh-dashboard
pm2 start pm2.config.js

# 7. Save PM2 state
pm2 save
```

#### To Restore Database:
```bash
# Note: Database connection details needed from .env.production
# psql -h [host] -U [user] -d [database] < gmh_dashboard_backup.sql
```

### Important Notes

1. **Database Backup**: The database backup attempt failed due to missing connection details. You should:
   - Manually backup the RDS instance through AWS Console
   - Use AWS RDS automated backups
   - Document the connection string securely

2. **Environment Variables**: Ensure all environment variables are documented:
   - `DATABASE_URL`
   - `CLINICSYNC_API_KEY`
   - `QUICKBOOKS_CLIENT_ID`
   - `QUICKBOOKS_CLIENT_SECRET`
   - `QUICKBOOKS_REDIRECT_URI`
   - `NEXT_PUBLIC_BASE_PATH`
   - `CRON_SECRET`

3. **External Dependencies**:
   - QuickBooks OAuth tokens (stored in database)
   - Jane/ClinicSync API configuration
   - AWS EC2 instance configuration
   - PM2 ecosystem configuration

### Verification Steps

After restoration:
1. Check PM2 status: `pm2 status`
2. Verify application: `curl http://localhost:3400/ops/api/admin/system-health`
3. Test login functionality
4. Verify QuickBooks connection
5. Check ClinicSync webhook endpoint
6. Confirm patient data displays correctly

### Contact for Recovery
- AWS EC2: Instance ID and region needed
- RDS: Database endpoint and credentials
- QuickBooks: App credentials and company ID
- ClinicSync: API key and webhook URL

---

*This manifest should be stored securely and updated after each major change.*



