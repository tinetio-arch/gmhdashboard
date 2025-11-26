# GHL Jane Financial Data Extraction Plan

## Current State Analysis

### What We're Currently Sending TO GHL:
From `patientGHLSync.ts`, we send these financial-related custom fields:
- `membership_balance` - Current balance owed
- `membership_owes` - Amount patient owes
- `method_of_payment` - Payment method (Jane, QBO, etc.)
- `last_charge_date` - Last charge date
- `next_charge_date` - Next charge date

### What We're NOT Doing:
- ❌ **NOT extracting payment data FROM GHL**
- ❌ **NOT querying GHL for opportunities/transactions**
- ❌ **NOT using GHL as a source of truth for Jane payments**
- ❌ **NOT tracking total revenue from Jane (only outstanding balances)**

### The Opportunity:
**Jane may be sending MORE financial data to GHL than we're getting from webhooks!**

If Jane has a GHL integration, they might be:
1. Sending payment transactions to GHL Opportunities
2. Updating custom fields with payment amounts
3. Creating transactions/events in GHL
4. Sending revenue data that we're not capturing

---

## Investigation Plan

### Phase 1: Explore GHL API Capabilities

#### 1.1 Query GHL Contacts for Custom Fields
**Goal:** See what financial data exists in GHL contacts

**Implementation:**
```typescript
// New function in ghl.ts
async getAllContactsWithFinancialData(): Promise<GHLContact[]> {
  // Search for all contacts with Jane-related tags or custom fields
  const contacts = await this.searchContacts([
    { field: 'tags', operator: 'contains', value: 'Jane' },
    // OR search by custom field
    { field: 'method_of_payment', operator: 'contains', value: 'Jane' }
  ], 1000); // Get up to 1000 contacts
  
  return contacts;
}

// Extract financial custom fields
function extractFinancialData(contact: GHLContact): {
  membershipBalance?: number;
  membershipOwes?: number;
  lastPaymentAmount?: number;
  lastPaymentDate?: string;
  totalRevenue?: number;
  paymentHistory?: Array<{ date: string; amount: number }>;
} {
  const customFields = contact.customFields || [];
  const financial: any = {};
  
  customFields.forEach(field => {
    const key = field.key || field.id || field.field;
    const value = field.value;
    
    // Look for payment-related fields
    if (key?.includes('payment') || key?.includes('revenue') || key?.includes('amount')) {
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        financial[key] = numValue;
      }
    }
    
    // Look for date fields
    if (key?.includes('date') || key?.includes('charge')) {
      financial[key] = value;
    }
  });
  
  return financial;
}
```

#### 1.2 Query GHL Opportunities
**Goal:** Find opportunities/transactions that represent Jane payments

**Implementation:**
```typescript
// Add to ghl.ts
async getOpportunities(filters?: {
  contactId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}): Promise<GHLOpportunity[]> {
  // GHL Opportunities API endpoint
  const endpoint = '/opportunities/';
  const params = new URLSearchParams();
  
  if (filters?.contactId) params.append('contactId', filters.contactId);
  if (filters?.status) params.append('status', filters.status);
  if (filters?.startDate) params.append('startDate', filters.startDate);
  if (filters?.endDate) params.append('endDate', filters.endDate);
  
  const url = params.toString() ? `${endpoint}?${params}` : endpoint;
  return this.request<GHLOpportunity[]>('GET', this.withLocation(url));
}

// Get opportunities for Jane patients
async getJaneOpportunities(patientIds: string[]): Promise<GHLOpportunity[]> {
  const opportunities: GHLOpportunity[] = [];
  
  for (const patientId of patientIds) {
    // Get GHL contact ID for this patient
    const patient = await query<{ ghl_contact_id: string }>(
      `SELECT ghl_contact_id FROM patients WHERE patient_id = $1`,
      [patientId]
    );
    
    if (patient[0]?.ghl_contact_id) {
      const opps = await this.getOpportunities({
        contactId: patient[0].ghl_contact_id,
        status: 'won' // Only get closed/won opportunities (completed payments)
      });
      opportunities.push(...opps);
    }
  }
  
  return opportunities;
}
```

#### 1.3 Query GHL Transactions/Events
**Goal:** Find payment events or transactions in GHL

**Note:** GHL may have a Transactions API or Events API. Need to check documentation.

**Potential Endpoints:**
- `/transactions/` - If GHL tracks transactions
- `/events/` - If GHL tracks payment events
- `/payments/` - If GHL has a payments endpoint

---

## Phase 2: Data Extraction Strategy

### Strategy A: Extract from GHL Contact Custom Fields
**If Jane is updating custom fields in GHL with payment data:**

1. **Query all Jane patients in GHL:**
   ```typescript
   async extractJanePaymentsFromGHL(): Promise<JanePayment[]> {
     const ghlClient = createGHLClient();
     if (!ghlClient) return [];
     
     // Get all patients with Jane payment method
     const patients = await query<{ patient_id: string; ghl_contact_id: string }>(
       `SELECT patient_id, ghl_contact_id 
        FROM patients 
        WHERE payment_method_key IN ('jane', 'jane_quickbooks')
          AND ghl_contact_id IS NOT NULL`
     );
     
     const payments: JanePayment[] = [];
     
     for (const patient of patients) {
       try {
         const contact = await ghlClient.getContact(patient.ghl_contact_id);
         
         // Extract payment data from custom fields
         const financial = extractFinancialData(contact);
         
         // Look for payment history fields
         // Jane might be storing: last_payment_amount, total_paid, payment_history, etc.
         if (financial.lastPaymentAmount) {
           payments.push({
             patientId: patient.patient_id,
             paymentDate: financial.lastPaymentDate,
             paymentAmount: financial.lastPaymentAmount,
             source: 'GHL Custom Fields'
           });
         }
       } catch (error) {
         console.error(`Failed to get GHL contact for patient ${patient.patient_id}:`, error);
       }
     }
     
     return payments;
   }
   ```

### Strategy B: Extract from GHL Opportunities
**If Jane is creating opportunities for payments:**

1. **Query opportunities for Jane patients:**
   ```typescript
   async extractJanePaymentsFromOpportunities(): Promise<JanePayment[]> {
     const ghlClient = createGHLClient();
     if (!ghlClient) return [];
     
     // Get all Jane patients
     const patients = await query<{ patient_id: string; ghl_contact_id: string }>(
       `SELECT patient_id, ghl_contact_id 
        FROM patients 
        WHERE payment_method_key IN ('jane', 'jane_quickbooks')
          AND ghl_contact_id IS NOT NULL`
     );
     
     const payments: JanePayment[] = [];
     const startDate = new Date();
     startDate.setMonth(startDate.getMonth() - 12); // Last 12 months
     
     for (const patient of patients) {
       if (!patient.ghl_contact_id) continue;
       
       try {
         const opportunities = await ghlClient.getOpportunities({
           contactId: patient.ghl_contact_id,
           status: 'won', // Completed payments
           startDate: startDate.toISOString().split('T')[0]
         });
         
         opportunities.forEach(opp => {
           if (opp.monetaryValue) {
             payments.push({
               patientId: patient.patient_id,
               paymentDate: opp.createdAt || opp.updatedAt,
               paymentAmount: opp.monetaryValue,
               source: 'GHL Opportunities',
               opportunityId: opp.id
             });
           }
         });
       } catch (error) {
         console.error(`Failed to get opportunities for patient ${patient.patient_id}:`, error);
       }
     }
     
     return payments;
   }
   ```

### Strategy C: Monitor GHL Webhooks
**If GHL sends webhooks when Jane updates data:**

1. **Set up GHL webhook endpoint:**
   ```typescript
   // New API route: /api/integrations/ghl/webhook
   export async function POST(request: Request) {
     const payload = await request.json();
     
     // GHL webhook for contact updates
     if (payload.event === 'contact.updated') {
       const contact = payload.contact;
       
       // Check if this is a Jane patient
       const patient = await findPatientByGHLContactId(contact.id);
       
       if (patient && isJanePatient(patient)) {
         // Extract payment data from updated contact
         const financial = extractFinancialData(contact);
         
         // Store payment if new payment detected
         if (financial.lastPaymentAmount) {
           await storeJanePayment({
             patientId: patient.patient_id,
             paymentAmount: financial.lastPaymentAmount,
             paymentDate: financial.lastPaymentDate,
             source: 'GHL Webhook'
           });
         }
       }
     }
   }
   ```

---

## Phase 3: Database Schema for Extracted Data

```sql
-- Table to store Jane payments extracted from GHL
CREATE TABLE jane_payments_ghl (
  payment_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID REFERENCES patients(patient_id),
  ghl_contact_id TEXT,
  ghl_opportunity_id TEXT, -- If from opportunities
  payment_date DATE NOT NULL,
  payment_amount NUMERIC(10,2) NOT NULL,
  payment_type TEXT, -- 'membership', 'one-time', 'refund', etc.
  source TEXT NOT NULL, -- 'GHL Custom Fields', 'GHL Opportunities', 'GHL Webhook'
  raw_data JSONB, -- Store full GHL response for debugging
  extracted_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(patient_id, payment_date, payment_amount, source) -- Prevent duplicates
);

CREATE INDEX idx_jane_payments_ghl_patient ON jane_payments_ghl(patient_id);
CREATE INDEX idx_jane_payments_ghl_date ON jane_payments_ghl(payment_date);
CREATE INDEX idx_jane_payments_ghl_contact ON jane_payments_ghl(ghl_contact_id);

-- Table to track what we've extracted (for incremental syncs)
CREATE TABLE ghl_extraction_log (
  extraction_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  extraction_type TEXT NOT NULL, -- 'contacts', 'opportunities', 'webhook'
  contact_id TEXT,
  opportunity_id TEXT,
  extracted_at TIMESTAMP DEFAULT NOW(),
  data_hash TEXT -- Hash of extracted data to detect changes
);

CREATE INDEX idx_ghl_extraction_contact ON ghl_extraction_log(contact_id);
CREATE INDEX idx_ghl_extraction_opportunity ON ghl_extraction_log(opportunity_id);
```

---

## Phase 4: Revenue Calculation

### Total Jane Revenue (All Sources)
```typescript
async getTotalJaneRevenue(startDate: Date, endDate: Date): Promise<{
  totalRevenue: number;
  membershipRevenue: number;
  oneTimeRevenue: number;
  byMonth: Array<{ month: string; revenue: number }>;
  byPatient: Array<{ patientId: string; patientName: string; revenue: number }>;
}> {
  // Get payments from GHL
  const ghlPayments = await query<{
    payment_amount: string;
    payment_date: string;
    payment_type: string;
    patient_id: string;
  }>(
    `SELECT payment_amount, payment_date, payment_type, patient_id
     FROM jane_payments_ghl
     WHERE payment_date BETWEEN $1 AND $2
     ORDER BY payment_date DESC`,
    [startDate, endDate]
  );
  
  // Get payments from ClinicSync webhooks (if we add that)
  const webhookPayments = await query<{
    payment_amount: string;
    payment_date: string;
    patient_id: string;
  }>(
    `SELECT payment_amount, payment_date, patient_id
     FROM jane_payments
     WHERE payment_date BETWEEN $1 AND $2
     ORDER BY payment_date DESC`,
    [startDate, endDate]
  );
  
  // Combine and deduplicate (prefer GHL data if duplicate)
  const allPayments = [...ghlPayments, ...webhookPayments];
  const uniquePayments = deduplicatePayments(allPayments);
  
  // Calculate totals
  const totalRevenue = uniquePayments.reduce((sum, p) => sum + parseFloat(p.payment_amount), 0);
  const membershipRevenue = uniquePayments
    .filter(p => p.payment_type === 'membership' || !p.payment_type)
    .reduce((sum, p) => sum + parseFloat(p.payment_amount), 0);
  const oneTimeRevenue = uniquePayments
    .filter(p => p.payment_type === 'one-time')
    .reduce((sum, p) => sum + parseFloat(p.payment_amount), 0);
  
  // Group by month
  const byMonth = groupByMonth(uniquePayments);
  
  // Group by patient
  const byPatient = await groupByPatient(uniquePayments);
  
  return {
    totalRevenue,
    membershipRevenue,
    oneTimeRevenue,
    byMonth,
    byPatient
  };
}
```

---

## Phase 5: Implementation Steps

### Step 1: Explore GHL API (No Code Changes)
1. **Manual GHL API Test:**
   - Use Postman/curl to query GHL API
   - Get a few Jane patient contacts
   - Check what custom fields exist
   - Look for payment-related fields

2. **Check GHL Opportunities:**
   - Query opportunities for Jane patients
   - See if Jane is creating opportunities for payments
   - Check monetary values

3. **Review GHL Webhooks:**
   - Check if GHL sends webhooks for contact updates
   - See what data is in webhook payloads

### Step 2: Create Extraction Functions
1. **Add GHL API methods:**
   - `getOpportunities()` - Query opportunities
   - `getAllContactsWithFinancialData()` - Bulk query contacts
   - `extractFinancialData()` - Parse custom fields

2. **Create extraction service:**
   - `extractJanePaymentsFromGHL()` - Main extraction function
   - `storeJanePayments()` - Save to database
   - `deduplicatePayments()` - Prevent duplicates

### Step 3: Database Setup
1. **Create tables:**
   - `jane_payments_ghl`
   - `ghl_extraction_log`

2. **Run initial extraction:**
   - Extract all historical data from GHL
   - Store in database

### Step 4: Set Up Continuous Sync
1. **Scheduled extraction:**
   - Run daily/hourly to get new payments
   - Use `ghl_extraction_log` to track what's been extracted

2. **Webhook handler (if available):**
   - Set up GHL webhook endpoint
   - Process real-time updates

### Step 5: Revenue Dashboard
1. **Create revenue queries:**
   - `getTotalJaneRevenue()` - Total revenue
   - `getJaneRevenueByMonth()` - Monthly breakdown
   - `getJaneRevenueByPatient()` - Per-patient breakdown

2. **Add to dashboard:**
   - Display total Jane revenue
   - Show revenue trends
   - Compare GHL data vs webhook data

---

## Expected Outcomes

### What We'll Discover:
1. **Does Jane send payment data to GHL?**
   - If yes: We can extract it!
   - If no: We'll need to rely on webhooks or manual entry

2. **What format is the data in?**
   - Custom fields? Opportunities? Transactions?
   - This determines extraction strategy

3. **How complete is the data?**
   - All payments? Only recent? Only memberships?
   - This affects revenue calculation accuracy

### Benefits:
- ✅ **Total Jane Revenue** - Not just memberships
- ✅ **More accurate data** - GHL may have data webhooks don't
- ✅ **Real-time updates** - If webhooks are available
- ✅ **Historical data** - Can backfill from GHL

---

## Next Steps

### ✅ COMPLETED:
1. **Created Investigation Tools:**
   - `lib/ghlFinancialExtraction.ts` - Functions to investigate GHL financial data
   - `app/api/admin/ghl/investigate-financials/route.ts` - API endpoint for investigation
   - Added `getOpportunities()` method to GHL client

### 🔍 IMMEDIATE NEXT STEPS (Investigation):

1. **Run Investigation API:**
   ```bash
   # Investigate 10 Jane patients
   GET /api/admin/ghl/investigate-financials?action=investigate&limit=10
   
   # Find all Jane contacts in GHL
   GET /api/admin/ghl/investigate-financials?action=find-contacts
   
   # Investigate specific contact
   GET /api/admin/ghl/investigate-financials?action=investigate&contactId=CONTACT_ID
   ```

2. **Review Results:**
   - Check what custom fields Jane is populating
   - Look for payment amounts, dates, revenue fields
   - See if opportunities contain payment data
   - Identify which fields contain financial information

3. **Test Opportunities API:**
   - Query opportunities for Jane patients
   - See if payments are tracked there
   - Check monetary values

### 📋 AFTER INVESTIGATION:

4. **Create Proof of Concept:**
   - Extract data from 5-10 Jane patients
   - Compare with webhook data
   - Validate accuracy

5. **Full Implementation:**
   - Build extraction functions
   - Set up database tables
   - Create revenue dashboard

---

## Questions to Answer

1. **Does Jane have a GHL integration?**
   - If yes, what data do they send?
   - If no, can we set one up?

2. **What GHL API endpoints are available?**
   - Opportunities? Transactions? Events?
   - What's the rate limit?

3. **What custom fields does Jane populate?**
   - Payment amounts? Payment dates?
   - Total revenue? Payment history?

4. **Can we get webhooks from GHL?**
   - Real-time updates when Jane sends data?
   - What's the webhook payload structure?

---

## Risk Mitigation

### Risk 1: GHL API Rate Limits
**Mitigation:**
- Batch requests
- Cache results
- Use incremental syncs

### Risk 2: Data Duplication
**Mitigation:**
- Use unique constraints
- Hash-based deduplication
- Prefer GHL data over webhooks

### Risk 3: Missing Historical Data
**Mitigation:**
- One-time backfill from GHL
- Keep webhook data as backup
- Manual entry for gaps

### Risk 4: GHL Data Format Changes
**Mitigation:**
- Store raw JSON
- Version extraction logic
- Alert on format changes

