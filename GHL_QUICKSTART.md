# Quick Start: GoHighLevel Integration for GMH Dashboard

## What This Does

Links your existing GMH patients with their GoHighLevel contacts and automatically applies tags, especially the **"existing"** tag for all Men's Health Service patients.

## Prerequisites

✅ All your patients already exist in GoHighLevel
✅ Patient emails or phone numbers match between systems
✅ You have admin access to GoHighLevel

## Quick Setup (5 steps)

### 1. Get GoHighLevel Credentials

Follow the detailed guide in `GHL_ACCESS_GUIDE.md`, or quick version:

1. Go to https://app.gohighlevel.com
2. Navigate to: **Settings** → **Company Settings** → **Integrations** → **API**
3. Create a new API key (copy it immediately!)
4. Get your Location ID from the URL or Settings

### 2. Configure Environment Variables

Add to your `.env` file:

```bash
GHL_API_KEY=your_api_key_here
GHL_LOCATION_ID=your_location_id_here
GHL_BASE_URL=https://services.leadconnectorhq.com
```

### 3. Run Database Migration

```bash
cd /Users/philschafer/Phils\ Fun\ Stuff/gmh-dashboard
node scripts/run-ghl-migration.js
```

This adds the necessary database tables and default tag mappings.

### 4. Test the Connection

```bash
# Restart your application
npm run dev

# Or if using PM2
pm2 restart gmh-dashboard
```

### 5. Sync Your Patients

1. Go to your Patients page
2. Click **"Sync All Patients"** at the top
3. Watch the progress - it will show succeeded/failed counts
4. Check for errors and fix any email/phone mismatches

## What Tags Get Applied

### Men's Health Patients → "existing" Tag

These client types automatically get the **"existing"** tag:
- QBO TCMH $180/Month
- QBO F&F/FR/Veteran $140/Month
- Jane TCMH $180/Month
- Jane F&F/FR/Veteran $140/Month
- Approved Disc / Pro-Bono PT
- Men's Health (QBO)

### Additional Tags Applied

- **Active Patient** / **Inactive Patient** (based on status)
- **Active - Pending Labs** (for pending lab work)
- **Hold - Payment Issue** / **Hold - Service Change** / etc.
- **Labs Overdue** (when labs are past due)
- **Has Membership Balance** (when patient owes money)
- **Verified Patient** (for verified accounts)

## How Contact Matching Works

The system finds existing GHL contacts by:
1. Email address (primary)
2. Phone number (backup)
3. Previously stored GHL contact ID

**If no match is found**: The sync fails with an error. Fix the email/phone in either system and re-sync.

## Troubleshooting

### "Contact not found" errors

This means the patient's email/phone doesn't match any contact in GHL.

**Fix it**:
1. Find the patient in GHL by name
2. Compare email/phone between systems
3. Update whichever system has the wrong info
4. Click the sync button next to that patient again

### "GHL client not configured"

Your environment variables aren't set correctly.

**Fix it**:
1. Double-check `.env` file has GHL_API_KEY and GHL_LOCATION_ID
2. Restart your application
3. Try again

### Connection Test Failed

Your API credentials might be wrong.

**Test manually**:
```bash
curl -X GET 'https://services.leadconnectorhq.com/contacts/?limit=1' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Location-Id: YOUR_LOCATION_ID' \
  -H 'Version: 2021-07-28'
```

## Automatic Syncing (Optional)

Set up hourly automatic sync using a cron job:

### Option 1: Server Cron

```bash
# Edit crontab
crontab -e

# Add this line (runs every hour)
0 * * * * curl -X GET https://yourdomain.com/api/cron/sync-ghl
```

### Option 2: External Cron Service

Use a service like:
- Vercel Cron (if hosted on Vercel)
- AWS EventBridge
- EasyCron.com
- cron-job.org

Point it to: `https://yourdomain.com/api/cron/sync-ghl`

## Viewing Results

### In Your Dashboard
- Green checkmark = Successfully synced
- Red X = Error (click for details)
- Click the external link icon to view contact in GHL

### In GoHighLevel
1. Go to Contacts in GHL
2. Filter by tag: "existing"
3. You should see all your Men's Health patients
4. Each contact has updated info and all relevant tags

## Next Steps

1. ✅ Run initial sync to link all patients
2. ✅ Fix any email/phone mismatches for failed syncs
3. ✅ Verify "existing" tag was applied to Men's Health patients
4. ✅ Set up automatic hourly sync
5. ✅ Monitor sync history weekly

## Need Help?

- **GHL Access Issues**: See `GHL_ACCESS_GUIDE.md`
- **Integration Details**: See `GHL_INTEGRATION_GUIDE.md`
- **API Documentation**: https://highlevel.stoplight.io/docs/integrations
- **GHL Support**: https://help.gohighlevel.com

## Key Files Created

- `migrations/20251122_add_ghl_sync.sql` - Database schema
- `migrations/20251122_update_patient_views_ghl.sql` - View updates  
- `lib/patientGHLSync.ts` - Sync logic
- `app/api/admin/ghl/sync/route.ts` - Manual sync API
- `app/api/cron/sync-ghl/route.ts` - Automatic sync API
- `components/GHLSyncBadge.tsx` - Individual patient sync UI
- `components/GHLBulkSync.tsx` - Bulk sync UI
