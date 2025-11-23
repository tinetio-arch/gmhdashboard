# GoHighLevel Integration Guide

This guide explains how to set up and use the GoHighLevel (GHL) integration with your GMH Control Center.

## Overview

The integration syncs patient data from your GMH dashboard to GoHighLevel CRM, automatically:
- **Linking existing contacts** in GHL with patients in your dashboard
- Applying tags based on patient status, membership type, and conditions
- **Adding "existing" tag** to all Men's Health Service patients
- Tracking sync status in the dashboard
- Providing manual and automatic sync options

**Important**: This integration is designed to link and update existing GHL contacts, NOT create new ones. All contacts must already exist in GoHighLevel before syncing.

## Setup

### 1. Environment Variables

Add the following to your `.env` file:

```bash
# Go-High-Level API Credentials
GHL_API_KEY=your_ghl_api_key_here
GHL_LOCATION_ID=your_location_id_here
GHL_BASE_URL=https://services.leadconnectorhq.com
```

To get these credentials:
1. Log in to GoHighLevel
2. Go to Settings > Integrations > API
3. Create a new API key with full permissions
4. Copy your Location ID from the location settings

### 2. Run Database Migrations

Run the GHL sync migrations to add the necessary database tables and columns:

```bash
# Using the provided script
node scripts/run-ghl-migration.js

# Or manually run both migrations
psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -f migrations/20251122_add_ghl_sync.sql
psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -f migrations/20251122_update_patient_views_ghl.sql
```

### 3. Set Up Automatic Sync (Optional)

To enable automatic hourly syncing, set up a cron job that calls the sync endpoint:

```bash
# Add to your crontab (crontab -e)
0 * * * * curl -X GET https://yourdomain.com/api/cron/sync-ghl

# Or use a service like Vercel Cron or AWS EventBridge
```

For added security, set a `CRON_SECRET` environment variable and include it in the Authorization header:

```bash
CRON_SECRET=your-secret-key

# Cron command with auth
0 * * * * curl -X GET -H "Authorization: Bearer your-secret-key" https://yourdomain.com/api/cron/sync-ghl
```

## Features

### Automatic Tag Management

The system automatically applies tags based on:

#### Men's Health Patients - "existing" Tag

All patients with these client types receive the **"existing"** tag in GoHighLevel:
- **QBO TCMH $180/Month**
- **QBO F&F/FR/Veteran $140/Month** 
- **Jane TCMH $180/Month**
- **Jane F&F/FR/Veteran $140/Month**
- **Approved Disc / Pro-Bono PT**
- **Men's Health (QBO)**

This "existing" tag identifies all Men's Health Service patients in your GHL system.

#### Patient Status Tags
- **Active Patient** - Status is "active"
- **Active - Pending Labs** - Status is "active_pending"
- **Inactive Patient** - Status is "inactive"
- **Hold - Payment Issue** - Status is "hold_payment_research"
- **Hold - Service Change** - Status is "hold_service_change"
- **Hold - Contract Renewal** - Status is "hold_contract_renewal"

#### Membership Tags
- **Men's Health Service** - For Men's Health patients
- **PrimeCare Elite** - For PrimeCare Elite members
- **PrimeCare Premier** - For PrimeCare Premier members
- **TCMH Member** - For TCMH program members

#### Client Type Tags
- **PrimeCare Elite $100** - Monthly PrimeCare Elite
- **PrimeCare Premier $50** - Monthly PrimeCare Premier
- **Jane TCMH $180** - Jane-based TCMH members
- **QBO TCMH $180** - QuickBooks-based TCMH members
- **Men's Health Patient** - Men's Health QBO patients

#### Condition Tags
- **Labs Overdue** - Applied when labs are overdue
- **Has Membership Balance** - Applied when patient owes membership fees
- **Verified Patient** - Applied for verified patients
- **GMH Patient** - Applied to ALL synced patients for easy filtering

### Manual Sync Options

1. **Individual Patient Sync**: Click the sync button next to any patient in the dashboard
2. **Bulk Sync All**: Use the "Sync All Patients" button at the top of the patients page
3. **API Endpoints**: Direct API calls for custom integrations

### Custom Fields Synced

The following patient data is synced as custom fields in GHL:
- Patient Status
- Client Type
- Regimen
- Service Start Date
- Last Lab Date
- Next Lab Date

## Usage

### Dashboard Integration

1. **Sync Status Indicators**: Each patient row shows their GHL sync status
   - Gray: Not linked to GHL yet
   - Blue: Syncing/Linking in progress
   - Green: Successfully linked and synced
   - Red: Error (likely contact not found in GHL)

2. **Bulk Sync Component**: At the top of the patients page
   - Shows sync progress and results
   - Displays any errors for troubleshooting
   - **Note**: Patients without matching email/phone in GHL will show errors

3. **Direct GHL Links**: Successfully synced patients have a link icon to view them in GHL

### How Contact Matching Works

The system finds existing GHL contacts by:
1. First checking if we already have a stored GHL contact ID
2. If not, searching GHL by the patient's email address
3. If no email match, searching by phone number
4. **If no match found**, the sync fails with an error (we don't create new contacts)

**To ensure successful matching**:
- Make sure patient emails in your dashboard match those in GHL
- Ensure phone numbers are properly formatted
- Update email/phone in either system if they don't match

### API Endpoints

#### Manual Sync Endpoints

```bash
# Sync single patient
POST /api/admin/ghl/sync
{
  "patientId": "uuid-here"
}

# Sync multiple patients
POST /api/admin/ghl/sync
{
  "patientIds": ["uuid1", "uuid2", "uuid3"]
}

# Sync all patients needing update
POST /api/admin/ghl/sync
{
  "syncAll": true
}
```

#### Cron Endpoint

```bash
# Automatic sync (for cron jobs)
GET /api/cron/sync-ghl
```

## Troubleshooting

### Common Issues

1. **"GHL client not configured"**
   - Ensure GHL_API_KEY is set in your environment
   - Restart your application after adding environment variables

2. **"Contact not found in GHL"**
   - This is expected when email/phone doesn't match
   - Check the patient's email and phone in both systems
   - Update one system to match the other
   - Re-sync after updating contact info

3. **Rate Limiting**
   - The sync includes built-in delays to avoid rate limits
   - For large databases, sync in batches

4. **Tag Creation Failures**
   - Ensure your API key has full permissions in GHL
   - Check GHL tag limits (usually 500 tags max)

5. **Multiple patients showing same error**
   - Verify your GHL_LOCATION_ID is correct
   - Test API connection manually (see GHL_ACCESS_GUIDE.md)

### Viewing Sync History

Check sync history in the database:

```sql
-- View recent sync attempts
SELECT * FROM ghl_sync_history 
ORDER BY created_at DESC 
LIMIT 20;

-- View patients with sync errors
SELECT patient_id, patient_name, ghl_sync_error 
FROM patient_ghl_sync_v 
WHERE ghl_sync_status = 'error';
```

## Best Practices

1. **Initial Sync**: Run a full sync during off-peak hours
2. **Regular Updates**: Enable hourly cron sync for automatic updates
3. **Monitor Errors**: Check sync history weekly for any persistent errors
4. **Tag Management**: Review and update tag mappings as your business evolves
5. **Data Quality**: Ensure patients have valid email or phone for best matching

## Customization

### Adding New Tag Rules

To add custom tag rules, insert into the `ghl_tag_mappings` table:

```sql
INSERT INTO ghl_tag_mappings (condition_type, condition_value, ghl_tag_name)
VALUES ('custom', 'your_condition', 'Your Tag Name');
```

Then update the `calculatePatientTags` function in `lib/patientGHLSync.ts` to implement the logic.

### Extending Sync Fields

To sync additional fields to GHL:
1. Update the `formatPatientForGHL` function
2. Add new custom fields to the GHL contact data
3. Test with a single patient before bulk sync
