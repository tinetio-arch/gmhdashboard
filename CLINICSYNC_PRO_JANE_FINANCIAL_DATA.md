# ClinicSync Pro → GHL Financial Data Mapping

## 🎯 Key Discovery

**ClinicSync Pro is the service that syncs Jane data to GHL!**

According to [ClinicSync Pro documentation](https://clinicsyncpro.com/documentation#jane-api), they sync:

1. **Contacts** - Patient/client data
2. **Appointments** - Booking information
3. **Invoices/Payments** - **Revenue, payment source, outstanding balances** ✅
4. **Purchases** - Packages, products
5. **Custom Fields** - Enriched GHL contacts with:
   - Total visits
   - Last/next appointment
   - Status
   - Retention
   - **ROI fields**
   - **Revenue information**

---

## 💰 Financial Data That Gets Synced

### From ClinicSync Pro Documentation:

**What Gets Synced:**
- ✅ **Invoices/Payments:** Revenue, payment source, outstanding balances
- ✅ **Custom Fields:** Enriched GHL contacts with ROI fields and revenue information

### Jane Webhook Payload (via ClinicSync Pro)

Based on the documentation, the webhook payload includes financial fields like:

```json
{
  "total_amount_paid": 1200,
  "total_unpaid_balance": 0,
  // ... other fields
}
```

### Custom Fields ClinicSync Pro Adds to GHL

The documentation mentions they enrich GHL contacts with:
- **Total visits**
- **Last/next appointment**
- **Status**
- **Retention**
- **ROI fields** ← Financial!
- **Revenue information** ← Financial!

---

## 🔍 What We Need to Find

### Custom Field Names to Look For

Based on ClinicSync Pro's description, we should look for custom fields like:

1. **Revenue Fields:**
   - `total_amount_paid` / `totalAmountPaid` / `total_revenue`
   - `total_unpaid_balance` / `totalUnpaidBalance` / `outstanding_balance`
   - `revenue` / `total_revenue` / `lifetime_value`
   - `roi` / `roi_fields` / `return_on_investment`

2. **Payment Fields:**
   - `payment_source` / `paymentSource`
   - `last_payment_amount` / `lastPaymentAmount`
   - `last_payment_date` / `lastPaymentDate`

3. **Visit/Retention Fields (may contain revenue data):**
   - `total_visits` / `totalVisits`
   - `appointments_count` / `appointmentsCount`
   - `retention` / `patient_retention`

4. **Invoice Fields:**
   - `invoices` / `invoice_count`
   - `total_invoiced` / `totalInvoiced`

---

## 📊 Sync Frequency

According to ClinicSync Pro:
- **Near real-time syncing every 5-45 minutes**
- Contacts, appointments, invoices, purchases all sync
- **100% hands-off once connected**

---

## 🔧 Investigation Strategy

### Step 1: Check GHL Custom Fields for ClinicSync Pro Fields

We should look for custom fields that ClinicSync Pro creates. The field names might be:
- In snake_case (e.g., `total_amount_paid`)
- In camelCase (e.g., `totalAmountPaid`)
- Prefixed with `clinicsync_` or `cs_`
- Or just the field name directly

### Step 2: Check the Live Sync Map

The documentation mentions a **Live Sync Map** (Google Sheets) that shows what gets synced:
- **URL:** They mention "View Live Sync Map (Google Sheets)" but don't provide the link
- This would show us exactly which fields ClinicSync Pro syncs

### Step 3: Query GHL for All Custom Fields

Since ClinicSync Pro syncs custom fields, we should:
1. Get all custom fields for Jane patients
2. Look for fields containing: `amount`, `paid`, `balance`, `revenue`, `payment`, `invoice`, `roi`, `visit`
3. These might not be in the `customFields` array - they might be top-level fields or in a different structure

### Step 4: Check Webhook Payload Structure

From the documentation, ClinicSync Pro webhooks include:
- `total_amount_paid`
- `total_unpaid_balance`
- Other financial fields

We should check if these are being synced to GHL as custom fields.

---

## 🎯 Next Steps

### 1. Update Debug Tool to Look for ClinicSync Pro Fields

We need to update our investigation to look for:
- All custom fields (not just financial ones)
- Fields that might match ClinicSync Pro naming conventions
- Check if there's a "Custom Fields" section in GHL that we're not querying

### 2. Check GHL API for Custom Field Definitions

GHL might have an endpoint to get all custom field definitions:
- `/custom-fields/` or `/fields/` endpoint
- This would show us what custom fields exist and their IDs

### 3. Query Jane Patients with More Comprehensive Field Extraction

Instead of just looking for `customFields`, we should:
- Get the full contact object
- Check all top-level fields
- Look for any field containing financial keywords
- Check nested objects (like `metadata`, `attributes`, etc.)

### 4. Contact ClinicSync Pro Support

If we can't find the fields, we could:
- Ask for the exact custom field names they use
- Request access to the Live Sync Map
- Get documentation on field naming conventions

---

## 💡 Key Insights

1. **ClinicSync Pro syncs financial data** - They explicitly mention "Revenue, payment source, outstanding balances"

2. **Custom fields are enriched** - They add ROI fields and revenue information to GHL contacts

3. **Sync happens automatically** - Every 5-45 minutes, so data should be up-to-date

4. **Field names might be standardized** - ClinicSync Pro likely uses consistent naming across all clinics

5. **We might need to look in different places** - Custom fields might be stored differently in GHL than we expect

---

## 🔄 Updated Investigation Plan

1. ✅ **Understand ClinicSync Pro's role** - They're the intermediary
2. ⏳ **Update debug tool** - Look for ClinicSync Pro field patterns
3. ⏳ **Check GHL custom field definitions** - See what fields actually exist
4. ⏳ **Query comprehensive field list** - Not just `customFields` array
5. ⏳ **Map ClinicSync Pro fields** - Create a mapping of what they sync
6. ⏳ **Extract financial data** - Build extraction based on actual field names

---

## 📝 Reference

- **ClinicSync Pro Documentation:** https://clinicsyncpro.com/documentation#jane-api
- **Key Section:** "What Gets Synced?" mentions "Invoices/Payments: Revenue, payment source, outstanding balances"
- **Custom Fields:** Mentions "ROI fields" and "revenue information" in enriched GHL contacts

---

**Next Action:** Update our investigation tools to look for ClinicSync Pro-specific field names and structures!



