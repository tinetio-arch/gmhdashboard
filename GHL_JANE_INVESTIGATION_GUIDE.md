# GHL Jane Financial Data Investigation Guide

## 🎯 Purpose

This investigation will help us discover:
1. **What financial data Jane is sending to GHL**
2. **Where that data is stored** (Custom Fields, Opportunities, etc.)
3. **How complete the data is** (all payments vs. just memberships)
4. **How we can extract it** to calculate total Jane revenue

---

## 🔍 Investigation Endpoints

### 1. Quick Investigation (Sample of 10 patients)
**URL:** `https://nowoptimal.com/ops/api/admin/ghl/investigate-financials?action=investigate&limit=10`

**What it does:**
- Gets 10 Jane patients with GHL contacts
- Shows all custom fields for each patient
- Extracts financial-related fields
- Shows sample values

**Use this to:** Quickly see what data exists

---

### 2. Deep Dive (Comprehensive Analysis)
**URL:** `https://nowoptimal.com/ops/api/admin/ghl/investigate-financials?action=deep-dive&limit=20`

**What it does:**
- Investigates up to 20 Jane patients
- Analyzes ALL custom fields
- Queries GHL Opportunities API for each patient
- Calculates total revenue from opportunities
- Provides comprehensive analysis

**Returns:**
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalPatientsInvestigated": 20,
      "patientsWithGHLContacts": 18,
      "patientsWithFinancialData": 15,
      "patientsWithOpportunities": 8,
      "totalRevenueFromOpportunities": 12500.00
    },
    "customFieldsAnalysis": {
      "allFieldKeys": ["method_of_payment", "membership_balance", ...],
      "financialFieldKeys": ["membership_balance", "last_payment_amount", ...],
      "fieldFrequency": {
        "membership_balance": 15,
        "last_payment_amount": 8
      },
      "sampleValues": {
        "membership_balance": ["$0.00", "$180.00", "$360.00"],
        "last_payment_amount": ["$180.00", "$140.00"]
      }
    },
    "opportunitiesAnalysis": {
      "totalOpportunities": 24,
      "totalRevenue": 12500.00,
      "opportunitiesByStatus": {
        "won": 20,
        "open": 4
      },
      "sampleOpportunities": [...]
    },
    "patientDetails": [...]
  },
  "insights": {
    "hasFinancialData": true,
    "hasOpportunities": true,
    "revenueFromOpportunities": 12500.00,
    "financialFieldsFound": 5,
    "recommendation": "Extract revenue from GHL Opportunities API"
  }
}
```

**Use this to:** Get comprehensive understanding of what data exists

---

### 3. Find All Jane Contacts
**URL:** `https://nowoptimal.com/ops/api/admin/ghl/investigate-financials?action=find-contacts`

**What it does:**
- Searches GHL for ALL contacts with "Jane" in payment method
- Analyzes all custom fields across all contacts
- Shows field frequency and sample values

**Use this to:** See the big picture of what Jane is sending

---

### 4. Investigate Specific Contact
**URL:** `https://nowoptimal.com/ops/api/admin/ghl/investigate-financials?action=investigate&contactId=CONTACT_ID`

**What it does:**
- Deep dive into a single GHL contact
- Shows all custom fields
- Extracts financial data

**Use this to:** Debug specific patients

---

## 📊 What to Look For

### Financial Custom Fields
Look for fields containing:
- `payment` - Payment amounts, dates, methods
- `revenue` - Total revenue
- `amount` - Payment amounts
- `balance` - Outstanding balances
- `paid` - Amounts paid
- `charge` - Charge dates/amounts
- `total` - Total amounts
- `cost` - Costs
- `price` - Prices
- `fee` - Fees

### Opportunities
- **Status "won"** = Completed payments
- **Monetary Value** = Payment amount
- **Date** = Payment date
- **Multiple opportunities** = Multiple payments per patient

### Key Questions to Answer

1. **Does Jane populate custom fields with payment data?**
   - Look for: `last_payment_amount`, `total_paid`, `revenue`, etc.
   - If yes → Extract from custom fields

2. **Does Jane create opportunities for payments?**
   - Look for: Opportunities with monetary values
   - If yes → Extract from opportunities API

3. **What's the data format?**
   - Numbers? Currency strings? Dates?
   - This affects extraction logic

4. **How complete is the data?**
   - All payments? Only recent? Only memberships?
   - This affects revenue calculation accuracy

---

## 🎯 Next Steps Based on Findings

### Scenario A: Jane Populates Custom Fields
**If you see:** Custom fields like `last_payment_amount`, `total_paid`, `revenue`

**Action:** Build extraction from custom fields
- Query all Jane patients
- Extract payment fields
- Store in database
- Calculate total revenue

### Scenario B: Jane Creates Opportunities
**If you see:** Opportunities with monetary values for Jane patients

**Action:** Build extraction from opportunities
- Query opportunities for Jane patients
- Filter by status "won" (completed payments)
- Sum monetary values
- Store in database

### Scenario C: Both Custom Fields AND Opportunities
**If you see:** Both custom fields AND opportunities

**Action:** Combine both sources
- Extract from custom fields (for current balances)
- Extract from opportunities (for payment history)
- Deduplicate
- Use opportunities as source of truth for revenue

### Scenario D: No Financial Data in GHL
**If you see:** No payment-related custom fields or opportunities

**Action:** Rely on webhooks
- Continue using ClinicSync webhooks
- GHL is not a source of financial data
- Focus on improving webhook data

---

## 🚀 Running the Investigation

### Step 1: Run Deep Dive
```bash
# Visit in browser or use curl:
curl "https://nowoptimal.com/ops/api/admin/ghl/investigate-financials?action=deep-dive&limit=20" \
  -H "Cookie: your-session-cookie"
```

### Step 2: Review Results
- Check `summary` section
- Review `customFieldsAnalysis.financialFieldKeys`
- Check `opportunitiesAnalysis.totalRevenue`
- Read `insights.recommendation`

### Step 3: Share Findings
Share the results so we can:
- Build extraction functions
- Create database schema
- Implement revenue calculation
- Add to dashboard

---

## 📝 Expected Findings

### What We Might Discover:

1. **Custom Fields Jane Populates:**
   - `last_payment_amount` - Last payment received
   - `total_paid` - Lifetime total paid
   - `revenue` - Total revenue
   - `payment_history` - JSON array of payments
   - `membership_balance` - Current balance (we already send this)

2. **Opportunities:**
   - One opportunity per payment
   - Status "won" = completed payment
   - Monetary value = payment amount
   - Date = payment date

3. **Data Completeness:**
   - All payments? Or just memberships?
   - Historical data? Or just recent?
   - One-time payments included?

---

## 🔧 Troubleshooting

### If API Returns 403 (Unauthorized)
- Make sure you're logged in as admin
- Check session cookie

### If No Data Found
- Verify GHL API key is configured
- Check that Jane patients have `ghl_contact_id` set
- Verify Jane is actually sending data to GHL

### If Opportunities API Fails
- GHL Opportunities API might require different permissions
- Check GHL API documentation
- May need to use different endpoint

---

## 📈 After Investigation

Once we have the findings, we'll:
1. **Build extraction functions** based on what data exists
2. **Create database tables** to store extracted payments
3. **Implement revenue calculation** queries
4. **Add to dashboard** for real-time revenue tracking
5. **Set up continuous sync** to keep data updated

---

## 🎉 Success Criteria

The investigation is successful if we can answer:
- ✅ What financial data does Jane send to GHL?
- ✅ Where is it stored (Custom Fields, Opportunities, etc.)?
- ✅ How can we extract it?
- ✅ How complete is it (all payments vs. just memberships)?
- ✅ What's the total revenue we can calculate?

---

**Ready to investigate?** Run the deep dive endpoint and share the results! 🚀









