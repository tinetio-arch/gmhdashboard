# GoHighLevel Integration - Complete Setup Summary

## 🎯 What We've Built

A complete GoHighLevel integration for your GMH Control Center at **nowoptimal.com/ops** that:

1. ✅ Links existing GHL contacts with your dashboard patients
2. ✅ Automatically applies the **"existing"** tag to all Men's Health patients
3. ✅ Syncs patient data and applies intelligent tags based on status
4. ✅ Provides manual and automatic sync options
5. ✅ Tracks sync status with visual indicators
6. ✅ Works seamlessly with your `/ops` base path deployment

## 📦 Files Created

### Core Integration Files
- `lib/patientGHLSync.ts` - Main sync logic and tag management
- `app/api/admin/ghl/sync/route.ts` - Manual sync API endpoint
- `app/api/cron/sync-ghl/route.ts` - Automatic hourly sync endpoint
- `components/GHLSyncBadge.tsx` - Individual patient sync button
- `components/GHLBulkSync.tsx` - Bulk sync UI component

### Database & Configuration
- `migrations/20251122_add_ghl_sync.sql` - Core database schema
- `migrations/20251122_update_patient_views_ghl.sql` - View updates
- `scripts/run-ghl-migration.js` - Migration runner
- `next.config.js` - Next.js config with `/ops` base path support

### Deployment Files
- `deploy-ghl.sh` - Automated deployment script
- `prepare-deployment.sh` - Pre-deployment package creator
- `env.production` - Production environment template
- `DEPLOYMENT_GHL.md` - Detailed deployment instructions
- `GHL_QUICKSTART.md` - Quick start guide
- `GHL_ACCESS_GUIDE.md` - How to get GHL credentials
- `GHL_INTEGRATION_GUIDE.md` - Complete technical documentation

## 🚀 Quick Deployment Commands

### Option 1: Automated Deployment (Recommended)

From your local machine:

```bash
cd "/Users/philschafer/Phils Fun Stuff/gmh-dashboard"

# Prepare deployment package
./prepare-deployment.sh

# Upload to server
scp -i ~/.ssh/nowserverk.pem ghl-deployment-*.tar.gz ec2-user@3.141.49.8:~/

# SSH and deploy
ssh -i ~/.ssh/nowserverk.pem ec2-user@3.141.49.8

# On server:
cd ~/gmh-dashboard
tar -xzf ~/ghl-deployment-*.tar.gz --strip-components=1
chmod +x deploy-ghl.sh
./deploy-ghl.sh
```

### Option 2: Manual Sync via rsync

```bash
cd "/Users/philschafer/Phils Fun Stuff/gmh-dashboard"

rsync -avz --exclude 'node_modules' --exclude '.next' \
  -e "ssh -i ~/.ssh/nowserverk.pem" \
  ./ ec2-user@3.141.49.8:~/gmh-dashboard/
```

Then SSH in and run deploy-ghl.sh

## 🔑 Required Configuration

Before deploying, ensure these are in your server's `.env` file:

```bash
# Base Path (REQUIRED)
NEXT_PUBLIC_BASE_PATH=/ops

# GoHighLevel Credentials (REQUIRED)
GHL_API_KEY=your_api_key_here
GHL_LOCATION_ID=your_location_id_here
GHL_BASE_URL=https://services.leadconnectorhq.com

# Database (Already configured)
DATABASE_HOST=clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com
DATABASE_USER=clinicadmin
DATABASE_PASSWORD=your_password
# ... (other DB settings)
```

### Getting GHL Credentials

1. Go to **https://app.gohighlevel.com**
2. Navigate to: **Settings** → **Company Settings** → **Integrations** → **API**
3. Create API Key → Copy immediately
4. Get Location ID from URL: `https://app.gohighlevel.com/location/{LOCATION_ID}/contacts`

## 🏷️ Tag Management

### Men's Health Patients → "existing" Tag

These client types automatically get the **"existing"** tag:
- `qbo_tcmh_180_month` - QBO TCMH $180/Month
- `qbo_f_f_fr_veteran_140_month` - QBO F&F/FR/Veteran $140/Month
- `jane_tcmh_180_month` - Jane TCMH $180/Month
- `jane_f_f_fr_veteran_140_month` - Jane F&F/FR/Veteran $140/Month
- `approved_disc_pro_bono_pt` - Approved Disc / Pro-Bono PT
- `mens_health_qbo` - Men's Health (QBO)

### Additional Auto-Applied Tags
- Status tags (Active Patient, Inactive, Hold types)
- Condition tags (Labs Overdue, Has Membership Balance, Verified Patient)

## 🔄 How Sync Works

1. **Finds existing contact** in GHL by email or phone
2. **Links** the contact to the patient record
3. **Updates** contact info with latest dashboard data
4. **Applies tags** based on patient status and type
5. **Tracks** sync status in database

**Important**: Only links existing contacts - does NOT create new ones

## 📋 Post-Deployment Checklist

After deployment:

1. ✅ Visit: https://nowoptimal.com/ops/patients
2. ✅ Look for "Sync All Patients" button at top
3. ✅ Click sync and monitor progress
4. ✅ Verify successful syncs (green indicators)
5. ✅ Check GHL for "existing" tag on Men's Health patients
6. ✅ Review any sync errors and fix email/phone mismatches
7. ✅ Set up hourly cron: `0 * * * * curl -X GET https://nowoptimal.com/ops/api/cron/sync-ghl`

## 🛠️ Troubleshooting

### Common Issues

**"Contact not found"**
- Patient's email/phone doesn't match GHL
- Fix: Update email/phone in either system, re-sync

**"GHL client not configured"**
- Environment variables not set
- Fix: Check `.env` has GHL_API_KEY and GHL_LOCATION_ID, restart app

**Sync fails silently**
- Check PM2 logs: `pm2 logs gmh-dashboard`
- Check database connection
- Verify GHL API permissions

### Support Commands

```bash
# View logs
pm2 logs gmh-dashboard

# Restart application
pm2 restart gmh-dashboard

# Check status
pm2 status

# Monitor resources
pm2 monit

# Test database
node scripts/run-ghl-migration.js
```

## 📊 Database Changes

New tables created:
- `ghl_sync_history` - Audit trail of all sync operations
- `ghl_tag_mappings` - Configurable tag rules

New columns added to `patients`:
- `ghl_contact_id` - Linked GHL contact ID
- `ghl_sync_status` - Current sync status
- `ghl_last_synced_at` - Last sync timestamp
- `ghl_sync_error` - Error message if failed
- `ghl_tags` - Applied tags (JSON)

New views:
- `patient_ghl_sync_v` - Patient sync status overview

## 🔐 Security Notes

- API keys stored securely in `.env` (never committed to git)
- Cron endpoint can be secured with `CRON_SECRET` env var
- All API calls use HTTPS
- Database connections use SSL
- PM2 manages process security

## 📝 Documentation Structure

```
GHL_QUICKSTART.md          → Start here for quick setup
GHL_ACCESS_GUIDE.md        → Getting GHL credentials
GHL_INTEGRATION_GUIDE.md   → Complete technical details
DEPLOYMENT_GHL.md          → Server deployment guide
SUMMARY.md                 → This file
```

## 🎯 Success Criteria

✅ All Men's Health patients have "existing" tag in GHL
✅ Patient info syncs between systems
✅ Status tags update automatically
✅ Dashboard shows sync status indicators
✅ Automatic hourly sync running
✅ No sync errors (or errors resolved)

## 📞 Next Steps

1. **Deploy**: Run `./prepare-deployment.sh` locally, then deploy to server
2. **Configure**: Add GHL credentials to server `.env`
3. **Migrate**: Run database migrations
4. **Test**: Sync a single patient first
5. **Bulk Sync**: Sync all patients
6. **Verify**: Check GHL for "existing" tags
7. **Automate**: Set up hourly cron job
8. **Monitor**: Check logs weekly for errors

## 🌟 Features

- **Zero data loss**: Only links existing contacts
- **Smart matching**: Finds contacts by email/phone
- **Tag preservation**: Adds tags without removing others
- **Error handling**: Clear error messages for troubleshooting
- **Audit trail**: Complete sync history in database
- **Manual override**: Sync individual patients anytime
- **Bulk operations**: Sync hundreds of patients efficiently
- **Rate limiting**: Built-in delays to avoid API limits
- **Base path support**: Works with `/ops` subdirectory

---

**Ready to deploy?** Start with `./prepare-deployment.sh` 🚀
