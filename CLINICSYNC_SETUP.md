# ClinicSync (Jane) Setup Guide

## Current Status
The ClinicSync integration is set up to automatically sync membership data from Jane, but we need the correct API endpoint from Jane/ClinicSync support.

## What's Working
1. ✅ Webhook integration - Jane sends updates to: `https://nowoptimal.com/ops/api/integrations/clinicsync/webhook`
2. ✅ Pass-based membership detection (Pass IDs: 1, 2, 3, 7, 52, 65, 72, 128)
3. ✅ Pro-bono patient mapping
4. ✅ Mixed payment method handling (Jane & QuickBooks)
5. ✅ Automatic patient status updates based on payment issues

## What Needs Configuration

### 1. Find the Correct Jane API Endpoint
Contact ClinicSync support and ask:
> "What is the API endpoint to pull a list of all patients with their membership/package data? We have the webhook working but need to do an initial sync and periodic updates."

They should provide an endpoint like:
- `https://jane-api.clinikoconnect.com/api/patients/with-memberships`
- `https://jane-api.clinikoconnect.com/api/memberships/active`
- Or similar

### 2. Update the Sync Endpoint
Once you have the correct endpoint, update `/app/api/admin/clinicsync/sync/route.ts`:
```typescript
const JANE_API_ENDPOINTS = [
  'YOUR_ACTUAL_ENDPOINT_HERE',  // Add the real endpoint here
  // ... existing endpoints
];
```

### 3. Test the Sync
1. Go to: https://nowoptimal.com/ops/admin/quickbooks
2. Click "Sync Jane Data" button
3. Check the response for success/errors

### 4. Set Up Automated Syncing
Add these environment variables to your `.env.production`:
```
CRON_SECRET=your-secret-key-here
INTERNAL_AUTH_SECRET=another-secret-key
```

Then set up a cron job to call:
```
curl -H "x-cron-secret: your-secret-key-here" https://nowoptimal.com/ops/api/cron/sync-all
```

Recommended schedule: Every 4 hours

## API Key Information
Your ClinicSync API Key: `39b51e86-6b00-439b-aaab-986ee30b038d`

## Known Pass IDs and Mappings
- Pass 1: PrimeCare Premier $50/month
- Pass 2: PrimeCare Elite $100/month  
- Pass 3: Insurance Supplemental $60/month
- Pass 7: Dependent Membership $30/month (Bunger children)
- Pass 52: Phil's F&F Testosterone $140/month
- Pass 65: TCMH Family $50/month
- Pass 72: TCMH New Patient (Peptides) $180/month
- Pass 128: Primary Care Premier Annual

## Troubleshooting

### If sync fails with "No endpoint found"
The API endpoints we're trying might be wrong. Check the server logs:
```bash
ssh -i ~/.ssh/nowserverk.pem ec2-user@3.141.49.8
pm2 logs gmh-dashboard --lines 100 | grep ClinicSync
```

### If patients aren't matching
1. Check the membership detection test endpoint:
```bash
curl -X POST https://nowoptimal.com/ops/api/admin/clinicsync/test-detection \
  -H "Cookie: gmh_session=YOUR_SESSION" \
  -H "Content-Type: application/json" \
  -d '{"passes":[{"id":1}],"appointmentsObject":[]}'
```

2. Use the Membership Audit page to manually match patients

### Payment Status Updates
- Sales receipts with 'unknown' or 'declined' status automatically move patients to "Hold - Payment Research"
- QuickBooks invoices 30+ days overdue create payment issues
- Mixed payment patients (Jane & QuickBooks) are tracked in both systems















