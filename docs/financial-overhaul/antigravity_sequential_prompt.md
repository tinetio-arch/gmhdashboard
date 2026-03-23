# Financial Overhaul — Sequential Execution with Debug Gates

> **EXECUTION MODEL**: Do ONE step at a time. After each step, run the verification gate. If the gate FAILS, stop and debug using the /debug protocol. Do NOT proceed to the next step until the current gate PASSES. After each step passes, run `/compact` with progress summary before continuing.

> **READ FIRST**: The full audit and code reference is at `docs/financial-overhaul/financial_audit_report.md`. Use Grep to find specific sections — do NOT read the whole file at once.

---

## STEP 1: Backup + Remove Healthie Card Button

### 1.1 — Backup
```bash
cp public/ipad/app.js public/ipad/app.js.bak.$(date +%Y%m%d_%H%M%S)
```

### 1.2 — Remove the "Add Card to Healthie Stripe" button block

In `public/ipad/app.js`, search for `🏥 For Packages & Subscriptions`. You will find a `<div>` block that contains:
- A label div: `🏥 For Packages & Subscriptions`
- A green button: `➕ Add Card to Healthie Stripe` with `onclick="addNewCard()"`
- A helper text div: `Use this for recurring packages managed in Healthie`

Delete that entire `<div style="margin-bottom: 20px;">...</div>` block (the one wrapping all three elements). Leave the `💳 Bill Patient for Product/Service` section that comes after it — that stays.

### 1.3 — Remove the `addNewCard()` function

Search for `function addNewCard`. Delete the entire function. It opens the Healthie billing URL — no longer needed.

### 1.4 — Simplify the charge modal in `chargePatient()`

Search for `function chargePatient`. This function currently shows a modal asking the user to choose between "Healthie Stripe" and "Direct Stripe". 

Modify it so it:
1. Skips the Stripe account selection entirely
2. Defaults to `stripe_account = "direct"`
3. Instead of showing the selection modal, goes straight to `showProductSearchModal()` (we build this in Step 3)

For now (until Step 3 is built), make it call a temporary placeholder:
```javascript
async function chargePatient() {
    const patientId = chartPanelData?.demographics?.patient_id || chartPanelPatientId;
    const healthieId = chartPanelData?.healthie_id;
    const patientName = chartPanelData?.demographics?.full_name || 'Patient';
    const paymentMethods = chartPanelData?.payment_methods || [];

    // Check for a Direct Stripe card
    const directCards = paymentMethods.filter(pm => 
        pm.source_type === 'direct_stripe' || pm.id?.startsWith('direct_pm_')
    );
    
    if (directCards.length === 0) {
        showToast('No billing card on file. Add a card first.', 'error');
        return;
    }
    
    // Will be replaced with showProductSearchModal() in Step 3
    // For now, use the old prompt() flow but hardcode to direct
    const amount = prompt(`Enter amount to charge ${patientName}:`);
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) return;
    
    const description = prompt('Description/reason for charge:');
    if (!description) return;
    
    await processChargeRequest(patientId, healthieId, patientName, parseFloat(amount), description, 'direct', null);
}
```

Also rename the existing charge execution logic into a reusable function `processChargeRequest()` that the old flow and the new product search modal can both call. Search for `selectStripeAccount` — extract its core POST logic into:

```javascript
async function processChargeRequest(patientId, healthieId, patientName, amount, description, stripeAccount, productId) {
    try {
        const response = await fetch('/ops/api/ipad/billing/charge/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                patient_id: healthieId || patientId,
                amount: amount,
                description: description,
                stripe_account: stripeAccount,
                product_id: productId
            })
        });
        const result = await response.json();
        
        if (result.success) {
            showToast(`✅ Charged ${patientName} $${amount.toFixed(2)} for ${description}`, 'success');
            // Refresh payment data
            if (typeof loadPatientPaymentData === 'function') {
                loadPatientPaymentData(healthieId || patientId);
            }
            return result;
        } else {
            showToast(`❌ Charge failed: ${result.error || 'Unknown error'}`, 'error');
            return null;
        }
    } catch (err) {
        console.error('Charge error:', err);
        showToast('❌ Network error — check before retrying.', 'error');
        return null;
    }
}
```

### 1.5 — Improve card display labels

Search for `isDirectStripe` in the card rendering section. Where cards are displayed, update the label text:
- Direct Stripe cards: Add text `"💳 Billing Card (Direct)"` and subtitle `"For products, services, peptides"`
- Healthie cards: Add text `"🏥 Healthie Card"` and subtitle `"Managed in Healthie — subscriptions only"`

### GATE 1 — Verify Step 1
```bash
# Build must pass
cd /home/ec2-user/gmhdashboard && npx next build 2>&1 | tail -5

# Verify the Healthie button is gone
grep -c "Add Card to Healthie Stripe" public/ipad/app.js
# Expected: 0

# Verify addNewCard function is gone
grep -c "function addNewCard" public/ipad/app.js
# Expected: 0

# Verify the Bill Patient section still exists
grep -c "Bill Patient for Product" public/ipad/app.js
# Expected: at least 1

# Verify processChargeRequest exists
grep -c "function processChargeRequest" public/ipad/app.js
# Expected: 1

# Verify chargePatient still exists and uses direct
grep "stripe_account.*direct\|stripeAccount.*direct" public/ipad/app.js | head -3
# Expected: should see 'direct' references
```

**All checks must pass. If build fails, use /debug to fix. Do NOT proceed to Step 2 until all pass.**

After gate passes: `git add -A && git commit -m "fix: remove Healthie card button, simplify charge flow to Direct only"`

Then run `/compact "Step 1 DONE: Removed Healthie card button, removed addNewCard(), simplified chargePatient() to Direct-only, extracted processChargeRequest(), improved card labels. Next: Step 2 — product search API endpoint."`

---

## STEP 2: Create Product Search API Endpoint

### 2.1 — Create the route file

Create new file: `app/api/ipad/billing/products/route.ts`

**IMPORTANT**: Before writing this, first read the auth pattern from the existing charge route:
```bash
grep -A 10 "export async function" app/api/ipad/billing/charge/route.ts | head -15
```
Copy that exact auth pattern.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  await requireApiUser(request, 'read');
  
  const q = request.nextUrl.searchParams.get('q') || '';
  
  try {
    // Fuzzy search: strip dashes/spaces for matching
    // "bpc157" matches "Peptide - BPC-157 (10mg)"
    const result = await query<{
      product_id: number;
      name: string;
      price: number;
      cost: number;
      supplier: string;
      category: string;
    }>(
      `SELECT 
        product_id,
        name,
        sell_price as price,
        unit_cost as cost,
        supplier,
        category
      FROM peptide_products
      WHERE active = true
        AND REPLACE(REPLACE(REPLACE(LOWER(name), '-', ''), ' ', ''), '.', '') 
            ILIKE '%' || REPLACE(REPLACE(REPLACE(LOWER($1), '-', ''), ' ', ''), '.', '') || '%'
      ORDER BY name
      LIMIT 50`,
      [q || '']
    );
    
    return NextResponse.json({ success: true, products: result });
  } catch (error: any) {
    console.error('[billing/products] Error:', error.message);
    return NextResponse.json({ success: false, error: 'Failed to fetch products' }, { status: 500 });
  }
}
```

**NOTE on auth**: Check if `charge/route.ts` uses `requireApiUser` or a different auth check (cookie-based, internal-auth header). Match it exactly. If it checks `x-internal-auth` header OR cookies, do the same.

### GATE 2 — Verify Step 2
```bash
# Build must pass
cd /home/ec2-user/gmhdashboard && npx next build 2>&1 | tail -5

# Restart to pick up new route
pm2 restart gmh-dashboard

# Wait for startup
sleep 5

# Test the endpoint
curl -s -H "x-internal-auth: 59c7ba5958b3c753f607a1bdeeb53ae36aabac6ebcf8729f6d411f43fc704122" \
  "https://www.nowoptimal.com/ops/api/ipad/billing/products/?q=bpc" | python3 -m json.tool | head -20

# Expected: JSON with success:true and products array containing BPC items

# Test fuzzy search
curl -s -H "x-internal-auth: 59c7ba5958b3c753f607a1bdeeb53ae36aabac6ebcf8729f6d411f43fc704122" \
  "https://www.nowoptimal.com/ops/api/ipad/billing/products/?q=tesamorelin" | python3 -m json.tool | head -20

# Expected: Tesamorelin products returned

# Test empty query returns all products
curl -s -H "x-internal-auth: 59c7ba5958b3c753f607a1bdeeb53ae36aabac6ebcf8729f6d411f43fc704122" \
  "https://www.nowoptimal.com/ops/api/ipad/billing/products/?q=" | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Count: {len(d.get(\"products\",[]))}')"

# Expected: Count should be > 0 if products exist. If 0, go to Step 6 first to insert products, then come back.

# Check PM2 error logs
pm2 logs gmh-dashboard --err --lines 10 --nostream
# Expected: No new errors related to billing/products
```

**If products count is 0**: Skip ahead to Step 6 (insert products), then come back and re-run this gate.

After gate passes: `git add -A && git commit -m "feat: add product search API endpoint for iPad billing"`

Then `/compact "Step 2 DONE: Created /api/ipad/billing/products/ with fuzzy search. Tested with curl — returns products. Next: Step 3 — product search modal in iPad app."`

---

## STEP 3: Build Product Search Modal in iPad App

### 3.1 — Add the product search modal function

In `public/ipad/app.js`, add the following functions. Place them near the `chargePatient()` function.

Read `docs/financial-overhaul/antigravity_prompt.md` sections 3A through 3F for the full code. Use Grep:
```bash
grep -n "### 3A\|### 3B\|### 3C\|### 3D\|### 3E\|### 3F" docs/financial-overhaul/antigravity_prompt.md
```

Then read each section and implement:

**3A** — `showProductSearchModal(patientData)` — Creates the modal overlay with search input, results area, and custom charge footer button.

**3B** — `handleProductSearch(query)` — Debounced search (300ms) that calls `/ops/api/ipad/billing/products/?q=` and renders product cards in the results area.

**3C** — `selectProduct(product)` — When a product is tapped, replaces the modal content with a charge confirmation view showing patient name, product name, editable amount field (pre-filled from product price), Cancel and Charge buttons.

**3D** — `showCustomChargeForm(patientId, healthieId, patientName)` — For non-product charges. Shows amount + description inputs.

**3E** — `executeProductCharge(productId, productName, amount)` and `executeCustomCharge(...)` — Both call `processChargeRequest()` from Step 1.

**3F** — `showChargeSuccess(...)` — Success modal with green checkmark, charge details, and a "Print Label" button if the charge was for a peptide product.

Also add:
```javascript
async function printPeptideLabel(dispenseId) {
    if (!dispenseId) {
        showToast('No dispense ID — cannot generate label', 'error');
        return;
    }
    const labelUrl = `/ops/api/ipad/billing/label/?dispense_id=${dispenseId}`;
    window.open(labelUrl, '_blank');
    showToast('Label opened — print from new tab', 'success');
}
```

### 3.2 — Update chargePatient() to use the new modal

Replace the temporary `prompt()` flow in `chargePatient()` (from Step 1) with:
```javascript
showProductSearchModal({
    patientId,
    healthieId,
    patientName,
    paymentMethods
});
```

### 3.3 — Update processChargeRequest to show success modal

After a successful charge in `processChargeRequest`, call `showChargeSuccess()` with the result data including `dispense_id` (if returned from the API — this comes in Step 4).

### GATE 3 — Verify Step 3
```bash
# Build must pass (static files don't need build, but verify no JS syntax errors)
cd /home/ec2-user/gmhdashboard && npx next build 2>&1 | tail -5

# Verify all new functions exist
grep -c "function showProductSearchModal" public/ipad/app.js
# Expected: 1

grep -c "function handleProductSearch" public/ipad/app.js
# Expected: 1

grep -c "function selectProduct" public/ipad/app.js
# Expected: 1

grep -c "function showCustomChargeForm" public/ipad/app.js
# Expected: 1

grep -c "function executeProductCharge" public/ipad/app.js
# Expected: 1

grep -c "function showChargeSuccess" public/ipad/app.js
# Expected: 1

grep -c "function printPeptideLabel" public/ipad/app.js
# Expected: 1

# Verify chargePatient calls showProductSearchModal
grep "showProductSearchModal" public/ipad/app.js
# Expected: should appear in chargePatient()

# Check for any obvious JS syntax issues
node -e "
const fs = require('fs');
const code = fs.readFileSync('public/ipad/app.js', 'utf8');
try { new Function(code); console.log('PASS: No syntax errors'); } 
catch(e) { console.log('FAIL:', e.message); }
"

# Quick curl to make sure the iPad page still loads
curl -s -o /dev/null -w "%{http_code}" https://www.nowoptimal.com/ipad/
# Expected: 200
```

After gate passes: `git add -A && git commit -m "feat: add product search modal to iPad billing flow"`

Then `/compact "Step 3 DONE: Built product search modal with fuzzy search, product selection, charge confirmation, custom charge, success modal, and label print button. Next: Step 4 — modify charge endpoint for auto-dispense."`

---

## STEP 4: Modify Charge Endpoint for Auto-Dispense

### 4.1 — Backup
```bash
cp app/api/ipad/billing/charge/route.ts app/api/ipad/billing/charge/route.ts.bak.$(date +%Y%m%d_%H%M%S)
```

### 4.2 — Add product_id to request body parsing

In `app/api/ipad/billing/charge/route.ts`, find where the request body is parsed (destructured). Add `product_id`:

```typescript
const { patient_id, amount, description, stripe_account, product_id } = await request.json();
```

### 4.3 — Add auto-dispense after successful charge

Find the section AFTER the charge succeeds (after `chargeViaDirectStripe()` or the equivalent returns success). Add this block BEFORE the return statement:

```typescript
// === AUTO-CREATE PEPTIDE DISPENSE ===
let dispenseId = null;

if (product_id) {
    try {
        const productCheck = await query<{ product_id: number; name: string }>(
            'SELECT product_id, name FROM peptide_products WHERE product_id = $1 AND active = true',
            [product_id]
        );
        
        if (productCheck.length > 0) {
            const product = productCheck[0];
            const dispenseResult = await query<{ sale_id: number }>(
                `INSERT INTO peptide_dispenses 
                    (product_id, quantity, patient_name, sale_date, status, education_complete, 
                     notes, paid, stripe_payment_intent_id, amount_charged)
                 VALUES ($1, 1, $2, CURRENT_DATE, 'Paid', true, $3, true, $4, $5)
                 RETURNING sale_id`,
                [
                    product_id,
                    patientName || 'Unknown',
                    `Auto-created from iPad billing. Charge: ${chargeResult?.charge_id || chargeResult?.id || 'N/A'}`,
                    chargeResult?.charge_id || chargeResult?.id || null,
                    amount
                ]
            );
            dispenseId = dispenseResult[0]?.sale_id || null;
            console.log(`[billing/charge] Auto-created peptide dispense #${dispenseId} for ${product.name}`);
        }
    } catch (dispenseError: any) {
        // Log but don't fail — the charge already succeeded
        console.error('[billing/charge] Failed to auto-create dispense:', dispenseError.message);
    }
}
```

**IMPORTANT**: Look at how `query()` returns data in this codebase. It might return `result.rows` directly (array) or a full result object. Match the pattern used in other queries in this same file. Adjust `productCheck.length` vs `productCheck.rows.length` accordingly.

### 4.4 — Add dispense_id to the success response

Find the success `return NextResponse.json(...)` and add `dispense_id`:

```typescript
return NextResponse.json({
    success: true,
    // ... existing fields ...
    dispense_id: dispenseId  // null if not a peptide
});
```

### GATE 4 — Verify Step 4
```bash
# Build must pass
cd /home/ec2-user/gmhdashboard && npx next build 2>&1 | tail -5

# Restart
pm2 restart gmh-dashboard
sleep 5

# Verify product_id is parsed
grep "product_id" app/api/ipad/billing/charge/route.ts
# Expected: should see product_id in destructuring and in the dispense INSERT

# Verify dispense_id is in response
grep "dispense_id" app/api/ipad/billing/charge/route.ts
# Expected: should appear in the return JSON

# Check PM2 logs for errors
pm2 logs gmh-dashboard --err --lines 10 --nostream
# Expected: No new errors

# Verify the charge endpoint still works WITHOUT product_id (backwards compatible)
# This is critical — existing charge flows should not break
curl -s -X POST \
  -H "x-internal-auth: 59c7ba5958b3c753f607a1bdeeb53ae36aabac6ebcf8729f6d411f43fc704122" \
  -H "Content-Type: application/json" \
  -d '{"patient_id": "test", "amount": 0.01, "description": "test", "stripe_account": "direct"}' \
  "https://www.nowoptimal.com/ops/api/ipad/billing/charge/" | python3 -m json.tool | head -10
# Expected: Should return an error about patient not found or no card — NOT a 500 or crash
# The important thing is it doesn't crash on missing product_id
```

After gate passes: `git add -A && git commit -m "feat: auto-create peptide dispense on billing charge, return dispense_id"`

Then `/compact "Step 4 DONE: Charge endpoint now accepts product_id, auto-creates peptide_dispenses record with status=Paid on successful charge, returns dispense_id. Backwards compatible. Next: Step 5 — label print endpoint."`

---

## STEP 5: Create Label Print Endpoint

### 5.1 — Check the existing label generator

```bash
grep -n "export.*function\|export.*const" lib/pdf/labelGenerator.ts | head -10
```

Read the exported function signature to understand its parameters.

### 5.2 — Create the label route

Create new file: `app/api/ipad/billing/label/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
// Import the label generator — check exact export name from Step 5.1
import { generateLabelPdf } from '@/lib/pdf/labelGenerator';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    await requireApiUser(request, 'read');
    
    const dispenseId = request.nextUrl.searchParams.get('dispense_id');
    if (!dispenseId) {
        return NextResponse.json({ error: 'dispense_id required' }, { status: 400 });
    }
    
    try {
        const result = await query<{
            sale_id: number;
            patient_name: string;
            patient_dob: string;
            sale_date: string;
            product_name: string;
            category: string;
        }>(`
            SELECT 
                d.sale_id, d.patient_name, d.patient_dob, d.sale_date,
                p.name as product_name, p.category
            FROM peptide_dispenses d
            JOIN peptide_products p ON p.product_id = d.product_id
            WHERE d.sale_id = $1
        `, [dispenseId]);
        
        if (result.length === 0) {
            return NextResponse.json({ error: 'Dispense not found' }, { status: 404 });
        }
        
        const dispense = result[0];
        
        // Call the label generator — match its exact parameter signature
        // from what you found in Step 5.1
        const pdfBuffer = await generateLabelPdf({
            type: 'peptide',
            patientName: dispense.patient_name,
            patientDob: dispense.patient_dob || '',
            medication: dispense.product_name,
            dateDispensed: dispense.sale_date
        });
        
        return new NextResponse(pdfBuffer, {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="label-${dispenseId}.pdf"`
            }
        });
    } catch (error: any) {
        console.error('[billing/label] Error:', error.message);
        return NextResponse.json({ error: 'Failed to generate label' }, { status: 500 });
    }
}
```

**CRITICAL**: The `generateLabelPdf` function signature may differ from what's shown above. Read the actual function in `lib/pdf/labelGenerator.ts` and match its exact parameters. If it expects different field names, adjust accordingly.

### GATE 5 — Verify Step 5
```bash
# Build must pass
cd /home/ec2-user/gmhdashboard && npx next build 2>&1 | tail -5

# Restart
pm2 restart gmh-dashboard
sleep 5

# Test with a real dispense ID from the database
DISPENSE_ID=$(psql -h clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com -U $(grep DB_USER .env.local | cut -d= -f2) -d $(grep DB_NAME .env.local | cut -d= -f2) -t -A -c "SELECT sale_id FROM peptide_dispenses ORDER BY sale_id DESC LIMIT 1" 2>/dev/null || echo "1")

echo "Testing with dispense_id: $DISPENSE_ID"

curl -s -o /tmp/test-label.pdf -w "%{http_code}" \
  -H "x-internal-auth: 59c7ba5958b3c753f607a1bdeeb53ae36aabac6ebcf8729f6d411f43fc704122" \
  "https://www.nowoptimal.com/ops/api/ipad/billing/label/?dispense_id=$DISPENSE_ID"
# Expected: 200 (or 404 if no dispenses exist yet — that's OK)

# If 200, verify it's a PDF
file /tmp/test-label.pdf
# Expected: PDF document

# Check errors
pm2 logs gmh-dashboard --err --lines 10 --nostream
```

After gate passes: `git add -A && git commit -m "feat: add label PDF generation endpoint for iPad billing"`

Then `/compact "Step 5 DONE: Created /api/ipad/billing/label/ endpoint. Generates PDF labels using existing labelGenerator. Next: Step 6 — ensure peptide products in database."`

---

## STEP 6: Ensure Peptide Products Exist in Database

### 6.1 — Check what already exists

```bash
psql -h clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com \
  -U $(grep DB_USER .env.local | cut -d= -f2) \
  -d $(grep DB_NAME .env.local | cut -d= -f2) \
  -c "SELECT product_id, name, sell_price, unit_cost, supplier, active FROM peptide_products WHERE active = true ORDER BY name;"
```

If the env vars don't work that way, read `.env.local` to find the DB connection details and use them directly.

### 6.2 — Create import script

Create file: `scripts/import-billing-peptides.ts`

This script should:
1. Read the 35 peptide products from `docs/financial-overhaul/antigravity_prompt.md` Section 12 (or use the data below)
2. For each product, check if it already exists by name (case-insensitive)
3. If missing, INSERT it
4. If exists but price changed, UPDATE the price
5. Log what was inserted/updated/skipped

The 35 products are listed in `docs/financial-overhaul/financial_audit_report.md` Section 12. Use Grep to find them:
```bash
grep -A 40 "## 12. Peptide Product Data" docs/financial-overhaul/financial_audit_report.md
```

**DO NOT include any inventory counts or quantities.** Only: name, sell_price, unit_cost, supplier, category='peptide', active=true.

### 6.3 — Run the import

```bash
npx tsx scripts/import-billing-peptides.ts
```

### GATE 6 — Verify Step 6
```bash
# Count active peptide products
psql -h clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com \
  -U $(grep DB_USER .env.local | cut -d= -f2) \
  -d $(grep DB_NAME .env.local | cut -d= -f2) \
  -t -A -c "SELECT COUNT(*) FROM peptide_products WHERE active = true;"
# Expected: at least 35

# Test the search API with a known product
curl -s -H "x-internal-auth: 59c7ba5958b3c753f607a1bdeeb53ae36aabac6ebcf8729f6d411f43fc704122" \
  "https://www.nowoptimal.com/ops/api/ipad/billing/products/?q=bpc" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'Success: {d.get(\"success\")}')
print(f'Product count: {len(d.get(\"products\", []))}')
for p in d.get('products', [])[:5]:
    print(f'  {p[\"name\"]} — \${p[\"price\"]}')
"
# Expected: Multiple BPC products with correct prices

# Test another search
curl -s -H "x-internal-auth: 59c7ba5958b3c753f607a1bdeeb53ae36aabac6ebcf8729f6d411f43fc704122" \
  "https://www.nowoptimal.com/ops/api/ipad/billing/products/?q=retatrutide" | python3 -m json.tool | head -15
# Expected: Retatrutide products
```

After gate passes: `git add -A && git commit -m "feat: import 35 peptide products into billing catalog"`

Then `/compact "Step 6 DONE: All 35 peptide products in database and searchable via API. Next: Step 7 — final build, restart, and end-to-end test."`

---

## STEP 7: Final Build + Restart + End-to-End Test

### 7.1 — Full build
```bash
cd /home/ec2-user/gmhdashboard && npm run build 2>&1 | tail -20
```

### 7.2 — Restart
```bash
pm2 restart gmh-dashboard
sleep 5
pm2 status
```

### 7.3 — End-to-end verification
```bash
echo "=== 1. iPad page loads ==="
curl -s -o /dev/null -w "HTTP %{http_code}" https://www.nowoptimal.com/ipad/
echo ""

echo "=== 2. Healthie button removed ==="
curl -s https://www.nowoptimal.com/ipad/app.js | grep -c "Add Card to Healthie Stripe"
echo " (expected: 0)"

echo "=== 3. Product search works ==="
curl -s -H "x-internal-auth: 59c7ba5958b3c753f607a1bdeeb53ae36aabac6ebcf8729f6d411f43fc704122" \
  "https://www.nowoptimal.com/ops/api/ipad/billing/products/?q=bpc" | python3 -c "
import json,sys; d=json.load(sys.stdin); print(f'Products found: {len(d.get(\"products\",[]))}')"

echo "=== 4. Charge endpoint accepts product_id ==="
grep -c "product_id" app/api/ipad/billing/charge/route.ts
echo " references to product_id (expected: 3+)"

echo "=== 5. Label endpoint exists ==="
ls -la app/api/ipad/billing/label/route.ts

echo "=== 6. No PM2 errors ==="
pm2 logs gmh-dashboard --err --lines 5 --nostream

echo "=== 7. All services healthy ==="
pm2 status | grep -E "online|errored|stopped"
```

### 7.4 — Final commit and push
```bash
git add -A
git diff --staged --stat
# Review the diff summary — make sure nothing unexpected is in there
git commit -m "feat: financial system overhaul — product search, auto-dispense, label printing

- Removed 'Add Card to Healthie Stripe' button from iPad app
- Simplified charge flow to Direct Stripe only
- Added product search API (/api/ipad/billing/products/)
- Built product search modal with fuzzy matching in iPad app
- Auto-creates peptide_dispenses on successful charge (status=Paid)
- Added label printing endpoint (/api/ipad/billing/label/)
- Imported 35 peptide products into billing catalog
- Improved card display distinction (Direct vs Healthie labels)"

git push origin master
```

### 7.5 — Report results

Output a summary:
```
## Financial Overhaul Complete

### Changes Made:
1. ✅ Removed Healthie card button
2. ✅ Simplified charge flow (Direct only)
3. ✅ Product search API with fuzzy matching
4. ✅ Product search modal in iPad app
5. ✅ Auto-dispense on peptide charge
6. ✅ Label printing endpoint
7. ✅ 35 peptide products imported

### Files Changed:
[list from git diff --stat]

### Test on iPad:
1. Go to https://www.nowoptimal.com/ops/ and log in
2. Go to https://www.nowoptimal.com/ipad/
3. Open a patient → Financial tab
4. Verify Healthie button is gone
5. Tap Charge Patient → search "bpc" → select product → charge
6. Check Peptides inventory — dispense should appear
7. Test Print Label button
```

---

## WHAT NOT TO TOUCH
- QuickBooks sync logic
- Healthie webhook handlers (except charge endpoint modification)
- Cron jobs or PM2 service configs
- DEA/controlled substance code
- Vial inventory system
- payment_transactions table structure
- Healthie GraphQL package/subscription logic
- nginx configuration
- Any .env files
