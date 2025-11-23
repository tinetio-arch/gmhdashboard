# GHL Integration - Ready for Server Deployment

## 🎯 What We've Built

A complete GoHighLevel management system accessible at **nowoptimal.com/ops/professional**

### Key Features
- ✅ **Dedicated GHL Management Center** (repurposed Professional page)
- ✅ **Safe testing environment** - explore before syncing real data
- ✅ **Visual dashboard** with sync statistics
- ✅ **Test sync capability** - try one patient first
- ✅ **Bulk sync** when ready
- ✅ **Sync history** - full audit trail
- ✅ **Tag configuration** viewer
- ✅ **NO changes to patient data** until you click sync

## 🚀 Where Everything Lives

### GHL Management Center: `/professional`
- **URL**: https://nowoptimal.com/ops/professional
- Replaces the old Professional dashboard you weren't using
- Safe sandbox environment to test GHL integration
- 4 tabs: Overview, Sync Management, Tag Configuration, Sync History

### Patient Page: Untouched
- `/patients` remains exactly as it was
- No GHL features added there
- Your workflow unchanged

## 📦 Files for Server Deployment

### New Files (need to be uploaded)
```
app/professional/GHLManagementClient.tsx
app/professional/page.tsx (replaced)
app/api/admin/ghl/sync/route.ts
app/api/admin/ghl/status/route.ts
app/api/admin/ghl/tags/route.ts
app/api/admin/ghl/history/route.ts
app/api/cron/sync-ghl/route.ts
lib/patientGHLSync.ts
lib/patientQueries.ts (updated with GHL fields)
components/GHLSyncBadge.tsx
components/GHLBulkSync.tsx
migrations/20251122_add_ghl_sync.sql
migrations/20251122_update_patient_views_ghl.sql
scripts/run-ghl-migration.js
next.config.js
```

### Updated Files
```
lib/patientQueries.ts - Added GHL field types
app/professional/page.tsx - Now shows GHL Management Center
```

## 🔧 Deployment Steps for Server

### 1. Upload Files to Server

```bash
# From local machine
cd "/Users/philschafer/Phils Fun Stuff/gmh-dashboard"

# Create deployment package
tar -czf ghl-integration.tar.gz \
  app/professional/ \
  app/api/admin/ghl/ \
  app/api/cron/sync-ghl/ \
  lib/patientGHLSync.ts \
  lib/patientQueries.ts \
  lib/ghl.ts \
  components/GHLSyncBadge.tsx \
  components/GHLBulkSync.tsx \
  migrations/20251122_add_ghl_sync.sql \
  migrations/20251122_update_patient_views_ghl.sql \
  scripts/run-ghl-migration.js \
  next.config.js

# Upload to server
scp -i ~/.ssh/nowserverk.pem ghl-integration.tar.gz ec2-user@3.141.49.8:~/
```

### 2. On the Server

```bash
ssh -i ~/.ssh/nowserverk.pem ec2-user@3.141.49.8

# Extract files
cd ~/gmh-dashboard
tar -xzf ~/ghl-integration.tar.gz

# Add GHL credentials to .env
nano .env
# Add these lines:
GHL_API_KEY=your_api_key_here
GHL_LOCATION_ID=your_location_id_here
GHL_BASE_URL=https://services.leadconnectorhq.com
NEXT_PUBLIC_BASE_PATH=/ops

# Run database migrations (SAFE - just adds tables/columns)
node scripts/run-ghl-migration.js

# Install any new dependencies
npm install

# Build application
npm run build

# Restart PM2
pm2 restart gmh-dashboard

# Check status
pm2 logs gmh-dashboard --lines 50
```

### 3. Test the Integration

1. Open browser: **https://nowoptimal.com/ops/professional**
2. You'll see the GHL Management Center
3. Review the Overview tab - see statistics
4. Look at Tag Configuration - see what tags will be applied
5. **DO NOT** click any sync buttons yet - just explore!

## 📊 What You'll See

### Overview Tab
- Dashboard with stats (Total, Synced, Pending, Errors)
- Quick action buttons (Test Sync, Sync All)
- Information cards explaining how it works
- Men's Health tag mapping display

### Sync Management Tab
- Table of all patients
- Shows email/phone for each
- Current sync status
- Last synced timestamp
- Any errors

### Tag Configuration Tab
- All tag rules displayed
- Shows which conditions trigger which tags
- Client types that get "existing" tag highlighted

### Sync History Tab
- Last 100 sync operations
- Timestamp, patient, type, result
- Full audit trail

## 🏷️ Tag Logic (What Will Happen)

### "existing" Tag
Applied to patients with these client types:
- `qbo_tcmh_180_month`
- `qbo_f_f_fr_veteran_140_month`
- `jane_tcmh_180_month`
- `jane_f_f_fr_veteran_140_month`
- `approved_disc_pro_bono_pt`
- `mens_health_qbo`

### Other Tags
- Status tags (Active, Inactive, Hold types)
- Condition tags (Labs Overdue, Has Balance, etc.)

## ⚠️ Important Notes

### Nothing Happens Until You Click Sync
- **Database migrations are SAFE** - only add new tables/columns
- **No patient data is touched**
- **No GHL contacts are modified**
- Everything is ready, but dormant until you test

### When You're Ready to Test
1. Click "Test Sync (1 Patient)" first
2. Watch the result
3. Check GHL to verify the contact
4. If successful, try "Sync All Patients"

### How Sync Works
1. Finds existing GHL contact by email/phone
2. Links it to patient record
3. Updates contact info
4. Applies tags
5. Does NOT create new contacts

## 🔍 Verification Checklist

After deployment, verify:
- [ ] App still accessible at https://nowoptimal.com/ops
- [ ] Can log in normally
- [ ] Patients page unchanged and working
- [ ] Professional page now shows GHL Management Center
- [ ] GHL Management Center loads without errors
- [ ] Stats show correct patient counts
- [ ] Tag Configuration tab displays rules
- [ ] No console errors in browser
- [ ] PM2 process running stable

## 📁 What Gets Created in Database

### New Tables (Migration creates these)
- `ghl_sync_history` - Audit trail
- `ghl_tag_mappings` - Tag rules

### New Columns in `patients`
- `ghl_contact_id` - Linked GHL contact
- `ghl_sync_status` - Current status
- `ghl_last_synced_at` - Last sync time
- `ghl_sync_error` - Error message if failed
- `ghl_tags` - Applied tags (JSON)

### New Views
- `patient_ghl_sync_v` - Sync status overview

## 🎓 Next Steps After Deployment

1. **Deploy** - Upload files and run migrations
2. **Verify** - Check everything loads correctly
3. **Explore** - Navigate the GHL Management Center
4. **Get Credentials** - Obtain GHL API key and Location ID
5. **Configure** - Add credentials to `.env`
6. **Test** - Try test sync with 1 patient
7. **Review** - Check result in GHL
8. **Deploy** - Sync all when confident

## 📞 Quick Reference

```bash
# SSH to server
ssh -i ~/.ssh/nowserverk.pem ec2-user@3.141.49.8

# Check logs
pm2 logs gmh-dashboard

# Restart app
pm2 restart gmh-dashboard

# Check database
psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME

# View sync history
psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME \
  -c "SELECT * FROM ghl_sync_history ORDER BY created_at DESC LIMIT 10;"
```

---

**Ready to deploy!** All files are prepared and safe to upload. The integration is completely isolated in the Professional page, so your existing workflows are untouched. 🚀
