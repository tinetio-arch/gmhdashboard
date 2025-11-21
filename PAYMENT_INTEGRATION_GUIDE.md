# Payment Integration Guide: QuickBooks & Go-High-Level

## Overview

This system integrates with **QuickBooks Online API** and **Go-High-Level (GHL) API** to automatically track patient payments, identify non-paying patients, and mark them as ineligible in your patient management system.

## QuickBooks API - Recurring Patients Support

**Yes, QuickBooks Online API fully supports tracking recurring patients!**

### What QuickBooks API Provides:

1. **Recurring Transactions (Templates)**
   - Track monthly, weekly, or custom interval subscriptions
   - Monitor next charge dates
   - See active vs inactive recurring subscriptions
   - Get customer-specific recurring transactions

2. **Generated Invoices**
   - See all invoices created from recurring templates
   - Track payment status (paid, partial, overdue, open)
   - Calculate days overdue automatically
   - Monitor balances owed

3. **Customer Balances**
   - Real-time balance tracking
   - Payment history
   - Outstanding invoice details

### How It Works:

1. **Recurring Transaction Templates**: In QuickBooks, you set up recurring invoices (e.g., "PrimeCare Elite $100/Month") that automatically generate invoices on a schedule.

2. **API Access**: Our integration queries:
   - `RecurringTransaction` - Gets all recurring templates
   - `Invoice` - Gets all invoices (including those generated from recurring templates)
   - `Customer` - Gets customer information and balances

3. **Automatic Tracking**: The system:
   - Syncs recurring transaction schedules → Updates `next_charge_date` in your database
   - Syncs invoice balances → Updates `membership_owes` and identifies overdue payments
   - Identifies non-paying patients → Automatically marks them as "Hold - Payment Research"

## Features

### 1. Automatic Payment Tracking
- Syncs QuickBooks invoices and balances daily
- Tracks recurring transaction schedules
- Updates patient membership data automatically

### 2. Non-Paying Patient Detection
- Identifies patients with overdue invoices (30+ days default)
- Calculates total balance owed
- Tracks days overdue per invoice

### 3. Automatic Status Updates
- Marks patients as ineligible when payment issues detected
- Updates status to "Hold - Payment Research"
- Creates payment issue records for audit trail

### 4. Go-High-Level Integration
- Syncs patient data to GHL contacts
- Adds "Payment Issue" tags to contacts with problems
- Updates contact status to "Ineligible - Payment Issue"
- Tracks balance and days overdue in custom fields

## Setup Instructions

### 1. Database Setup

Run the payment integration schema:
```bash
psql -d your_database -f payment_integration_schema.sql
```

### 2. Environment Variables

Add to your `.env` file:

```bash
# QuickBooks API
QUICKBOOKS_CLIENT_ID=your_client_id
QUICKBOOKS_CLIENT_SECRET=your_client_secret
QUICKBOOKS_REALM_ID=your_company_id
QUICKBOOKS_ACCESS_TOKEN=your_access_token
QUICKBOOKS_REFRESH_TOKEN=your_refresh_token
QUICKBOOKS_ENVIRONMENT=production  # or 'sandbox'

# Go-High-Level API
GHL_API_KEY=your_ghl_api_key
GHL_LOCATION_ID=your_location_id  # Optional
GHL_BASE_URL=https://services.leadconnectorhq.com  # Optional, defaults to this
```

### 3. QuickBooks OAuth Setup

1. Create an app at https://developer.intuit.com/
2. Get OAuth 2.0 credentials (Client ID, Client Secret)
3. Complete OAuth flow to get access/refresh tokens
4. Store tokens securely (consider token refresh automation)

### 4. Patient-to-QuickBooks Mapping

Map your patients to QuickBooks customers:

```sql
INSERT INTO patient_qb_mapping (patient_id, qb_customer_id, qb_customer_email, match_method)
VALUES 
  ('patient-uuid-1', 'qb-customer-id-1', 'patient@email.com', 'email'),
  ('patient-uuid-2', 'qb-customer-id-2', 'patient2@email.com', 'email');
```

Or use the API endpoint to create mappings automatically based on email matching.

## Usage

### Manual Sync

Trigger a full payment sync:

```typescript
import { runFullPaymentSync } from '@/lib/paymentTracking';

const result = await runFullPaymentSync();
console.log(`Processed: ${result.recordsProcessed}, Updated: ${result.recordsUpdated}`);
```

### Automated Sync

Set up a cron job or scheduled task to run daily:

```typescript
// Example: Run every day at 2 AM
import { runFullPaymentSync } from '@/lib/paymentTracking';

// In your scheduled job
await runFullPaymentSync();
```

### API Endpoints

Create API routes to trigger syncs:

- `POST /api/payments/sync` - Run full payment sync
- `GET /api/payments/status` - Get payment status summary
- `GET /api/payments/issues` - Get list of payment issues

## Payment Rules Configuration

Configure when patients should be marked ineligible:

```sql
UPDATE payment_rules 
SET min_days_overdue = 30,  -- Mark ineligible after 30 days overdue
    min_amount_threshold = 0.00,  -- Any amount triggers check
    auto_update_status = TRUE,
    target_status_key = 'hold_payment_research'
WHERE rule_name = 'Default Overdue Rule';
```

## Monitoring

### View Payment Issues

```sql
SELECT 
  p.full_name,
  pi.issue_type,
  pi.amount_owed,
  pi.days_overdue,
  pi.created_at
FROM payment_issues pi
JOIN patients p ON p.patient_id = pi.patient_id
WHERE pi.resolved_at IS NULL
ORDER BY pi.days_overdue DESC;
```

### View Sync History

```sql
SELECT 
  sync_type,
  sync_status,
  records_processed,
  records_updated,
  started_at,
  completed_at
FROM payment_sync_log
ORDER BY started_at DESC
LIMIT 10;
```

### Payment Status Summary

```sql
SELECT * FROM payment_status_summary_v
WHERE total_balance_owed > 0
ORDER BY max_days_overdue DESC;
```

## Recurring Patient Tracking

### How Recurring Patients Are Tracked

1. **QuickBooks Setup**: Create recurring invoice templates in QuickBooks for each patient's membership (e.g., "John Doe - PrimeCare Elite Monthly")

2. **Automatic Sync**: The system syncs:
   - Recurring transaction templates → Membership records
   - Next charge date → `next_charge_date` field
   - Generated invoices → Payment tracking
   - Balances → `membership_owes` field

3. **Status Updates**: When a recurring invoice becomes overdue:
   - Patient status automatically changes to "Hold - Payment Research"
   - Payment issue record created
   - GHL contact tagged and status updated

### Example Recurring Transaction Flow

```
QuickBooks Recurring Template:
  Name: "PrimeCare Elite - Monthly"
  Customer: John Doe
  Amount: $100
  Schedule: Monthly, 1st of month
  Next Due: 2024-02-01

↓ Sync runs daily

Your Database:
  membership.program_name = "PrimeCare Elite - Monthly"
  membership.next_charge_date = 2024-02-01
  membership.fee_amount = 100.00
  membership.status = "active"

↓ Invoice generated on 2024-02-01

QuickBooks Invoice:
  Customer: John Doe
  Amount: $100
  Due Date: 2024-02-15
  Status: Open

↓ Patient doesn't pay by 2024-03-15 (30 days overdue)

Your System:
  patient.status_key = "hold_payment_research"
  payment_issues.issue_type = "overdue_invoice"
  payment_issues.days_overdue = 30
  GHL contact.status = "Ineligible - Payment Issue"
```

## Troubleshooting

### QuickBooks API Issues

- **401 Unauthorized**: Refresh your access token
- **403 Forbidden**: Check OAuth scopes (need `com.intuit.quickbooks.accounting`)
- **429 Rate Limit**: Implement rate limiting/retry logic

### Mapping Issues

- **Patients not syncing**: Check `patient_qb_mapping` table for correct customer IDs
- **Email mismatch**: Use manual mapping or fuzzy name matching

### Status Not Updating

- **Check payment rules**: Ensure `auto_update_status = TRUE`
- **Check thresholds**: Verify `min_days_overdue` and `min_amount_threshold`
- **Check sync logs**: Review `payment_sync_log` for errors

## Next Steps

1. Set up QuickBooks OAuth credentials
2. Run database migrations
3. Create patient-to-QB customer mappings
4. Test with a small subset of patients
5. Set up automated daily sync
6. Monitor sync logs and payment issues

## Support

For issues or questions:
- Check sync logs: `SELECT * FROM payment_sync_log ORDER BY started_at DESC`
- Review payment issues: `SELECT * FROM payment_issues WHERE resolved_at IS NULL`
- Check API client configuration in `lib/quickbooks.ts` and `lib/ghl.ts`




