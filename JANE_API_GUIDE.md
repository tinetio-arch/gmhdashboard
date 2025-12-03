# Jane API Integration Guide

## Overview
This guide documents how to sync membership/package data from Jane via the ClinicSync API.

## API Configuration

### Authentication
- **API Key**: `39b51e86-6b00-439b-aaab-986ee30b038d` (stored in `CLINICSYNC_API_KEY`)
- **Headers Required**:
  - `x-api-key`: Your API key
  - `Content-Type`: application/json

### Primary Endpoints

#### 1. Purchases Endpoint (Recommended)
**URL**: `https://jane-api.clinikoconnect.com/api/purchases`  
**Method**: GET  
**Purpose**: Fetch all package/membership purchases

**Response Format**:
```json
{
  "purchase_id": "12345",
  "sale_id": "67890",
  "patient_id": "11111",
  "patient": {
    "id": "11111",
    "name": "John Doe"
  },
  "package_type": "membership",
  "product_name": "PrimeCare Premier",
  "purchase_date": "2024-01-01",
  "expiry_date": "2024-12-31",
  "purchase_state": "active",
  "sessions_redeemed": 5,
  "patient_paid": true,
  "has_notes": false
}
```

#### 2. Other Available Endpoints
- `/api/patients` - Patient list (may not include membership details)
- `/api-book-appointment` - Book appointments
- `/api-update-appointment` - Update appointments  
- `/api-cancel-appointment` - Cancel appointments

## Sync Implementation

The sync endpoint (`/app/api/admin/clinicsync/sync/route.ts`) automatically:
1. Tries the purchases endpoint first
2. Falls back to other endpoints if needed
3. Transforms purchase data into patient-centric format
4. Processes through existing ClinicSync logic

## Manual Sync Process

1. **Login to Admin Dashboard**:
   ```
   https://nowoptimal.com/ops/admin/quickbooks
   ```

2. **Click "Sync Jane Data"**
   - This triggers the sync process
   - Check console for results

3. **Monitor Results**:
   - Processed count
   - Updated count
   - Failed count
   - Which endpoint succeeded

## Automated Sync Setup

### 1. Environment Variables
Add to `.env.production`:
```env
CLINICSYNC_API_KEY=39b51e86-6b00-439b-aaab-986ee30b038d
CRON_SECRET=your-strong-secret-here
INTERNAL_AUTH_SECRET=another-strong-secret
```

### 2. Cron Job Setup
SSH into server and add cron job:
```bash
crontab -e
```

Add line (runs every 4 hours):
```cron
0 */4 * * * curl -H "x-cron-secret: your-strong-secret" http://localhost:3400/api/cron/sync-all > /dev/null 2>&1
```

## Data Mapping

### Pass IDs to Membership Types
| Pass ID | Membership Name | Price | Type |
|---------|----------------|-------|------|
| 1 | PrimeCare Premier | $50/mo | primary_care |
| 2 | PrimeCare Elite | $100/mo | primary_care |
| 3 | Insurance Supplemental | $60/mo | supplemental |
| 7 | Dependent Membership | $30/mo | dependent |
| 52 | Phil's F&F Testosterone | $140/mo | f_and_f_trt |
| 65 | TCMH Family | $50/mo | family_tcmh |
| 72 | TCMH New Patient (Peptides) | $180/mo | new_patient_peptides |
| 128 | Primary Care Premier Annual | Annual | annual_premier |

### Purchase State Mapping
- `active` → Active membership
- `expired` → Expired membership
- `cancelled` → Cancelled membership
- `unpaid` → Payment issue

## Troubleshooting

### Common Issues

1. **"No endpoint found" error**:
   - Check API key is correct
   - Verify endpoints in sync route
   - Check server logs for specific errors

2. **"Unauthorized" errors**:
   - API key may be expired
   - Check environment variables
   - Restart PM2 after updating .env

3. **No membership data returned**:
   - Purchases endpoint may require parameters
   - Try adding date range filters
   - Contact ClinicSync support

### Debug Commands

Check logs:
```bash
ssh -i ~/.ssh/nowserverk.pem ec2-user@3.141.49.8
pm2 logs gmh-dashboard --lines 100
```

Test API manually:
```bash
curl -H "x-api-key: 39b51e86-6b00-439b-aaab-986ee30b038d" \
     -H "Content-Type: application/json" \
     https://jane-api.clinikoconnect.com/api/purchases
```

## Next Steps

1. **Test Manual Sync**: Click "Sync Jane Data" button
2. **Verify Data**: Check if purchases are being imported
3. **Set Up Cron**: Configure automated syncing
4. **Monitor**: Use reconciliation page to track missing patients

## Support

For API issues, contact ClinicSync support with:
- Your API key (first 8 chars)
- Error messages from logs
- Endpoint you're trying to access











