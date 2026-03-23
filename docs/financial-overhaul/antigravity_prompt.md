# AntiGravity Single-Command: Financial System Overhaul + Peptide Inventory Integration

## CRITICAL SAFETY RULES
- **BACKUP FIRST**: Before modifying ANY file, create a backup: `cp <file> <file>.bak.$(date +%Y%m%d_%H%M%S)`
- **DO NOT** modify QuickBooks, Healthie webhook, or cron job code unless explicitly stated below
- **DO NOT** restart PM2 services until ALL changes are verified
- **TEST** each API endpoint with curl after creation before moving to next step
- Work in this exact order: Step 1 → Step 2 → Step 3 → Step 4 → Step 5 → Step 6 → Step 7

---

## STEP 1: Remove "Add Card to Healthie Stripe" Button from iPad App

**File:** `public/ipad/app.js`

### 1A. Remove the Healthie card button block

Find and DELETE this entire block (around lines 9987-10002 — search for `🏥 For Packages & Subscriptions`):

```javascript
            <div style="margin-bottom: 20px;">
                <div style="font-size: 12px; font-weight: 600; color: #10b981; text-transform: uppercase; margin-bottom: 8px;">
                    🏥 For Packages & Subscriptions
                </div>
                <button onclick="addNewCard()" style="
                    width: 100%; padding: 14px;
                    background: linear-gradient(135deg, #10b981, #059669);
                    color: white; border: none; border-radius: 8px;
                    font-size: 14px; font-weight: 600; cursor: pointer;
                ">
                    ➕ Add Card to Healthie Stripe
                </button>
                <div style="font-size: 11px; color: var(--text-tertiary); margin-top: 6px; padding: 0 4px;">
                    Use this for recurring packages managed in Healthie
                </div>
            </div>
```

DELETE that entire block. Leave no gap — the "Bill Patient for Product/Service" section below it should move up naturally.

### 1B. Remove the `addNewCard()` function

Find the `addNewCard()` function (around line ~10039 — search for `function addNewCard`). It opens the Healthie billing URL. DELETE the entire function:

```javascript
function addNewCard() {
    // ... entire function body that opens Healthie billing page
}
```

### 1C. Clean up the charge modal — remove Healthie Stripe option

In the `chargePatient()` function (around line 10232), find the Stripe account selection modal. It currently shows TWO options:
1. "For Packages & Subscriptions" (Healthie Stripe) — around line 10259
2. "For Products/Services" (Direct Stripe) — around line 10273

**REMOVE** the Healthie Stripe option from this modal. Instead of showing a selection modal, the charge flow should now:
- Skip the account selection entirely
- Default to Direct Stripe (`stripe_account = "direct"`)
- Go straight to the product selection (which we build in Step 3)

Replace the `chargePatient()` function logic so it no longer asks which Stripe account — it just calls the new product selection modal directly. The function should:
1. Get the patient data (ID, healthie_id, name, payment_methods)
2. Check they have a Direct Stripe card on file
3. If no card, show error: "No card on file. Please add a card first."
4. If card exists, call the new `showProductSearchModal()` (built in Step 3)

### 1D. Enhance card display distinction

In the card display logic (around lines 9964-9985 where `isDirectStripe` is determined), improve the visual labels:

- **Direct Stripe cards**: Keep pink styling. Change label from generic to: `"💳 Billing Card (Direct)"` with a small subtitle: `"Used for products, services, peptides"`
- **Healthie Stripe cards**: Keep green styling. Change label to: `"🏥 Healthie Card"` with subtitle: `"Managed in Healthie — for subscriptions only"`
- Make the distinction MORE obvious — add a small text tag on each card showing which system it belongs to

---

## STEP 2: Create Product Search API Endpoint

**New file:** `app/api/ipad/billing/products/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// Authenticate using the same pattern as other ipad/billing routes in this codebase
// Look at app/api/ipad/billing/charge/route.ts for the auth pattern and copy it exactly

export async function GET(request: NextRequest) {
  // === AUTH: Copy the exact auth check from charge/route.ts ===
  // It uses either cookie-based auth (gmh_session_v2) or x-internal-auth header
  // Do the same here. If the auth pattern uses requireApiUser, use that.
  // If it checks cookies directly, do the same.

  const q = request.nextUrl.searchParams.get('q') || '';
  const category = request.nextUrl.searchParams.get('category') || '';

  try {
    let query = `
      SELECT 
        product_id,
        name,
        sell_price as price,
        unit_cost as cost,
        supplier,
        category,
        sku,
        CASE WHEN sell_price > 0 THEN true ELSE false END as has_price
      FROM peptide_products
      WHERE active = true
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (q) {
      // Support fuzzy search: "bpc157" should match "Peptide - BPC-157 (10mg)"
      // Remove common separators and search broadly
      const searchTerm = q.replace(/[-_\s]/g, '%');
      query += ` AND REPLACE(REPLACE(LOWER(name), '-', ''), ' ', '') ILIKE REPLACE(REPLACE(LOWER($${paramIndex}), '-', ''), ' ', '')`;
      params.push(`%${searchTerm}%`);
      paramIndex++;
    }

    if (category) {
      query += ` AND category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    query += ` ORDER BY name LIMIT 50`;

    const result = await pool.query(query, params);

    return NextResponse.json({ 
      success: true, 
      products: result.rows,
      count: result.rows.length
    });
  } catch (error: any) {
    console.error('[billing/products] Error:', error.message);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch products' },
      { status: 500 }
    );
  }
}
```

**IMPORTANT SEARCH LOGIC NOTE:** The search needs to be forgiving. Staff will type "bpc157" or "bpc 157" or "tesamorelin ipam" and expect results. The query strips dashes, spaces, and does case-insensitive ILIKE matching. Test it after creation.

**Test after creating:**
```bash
curl -s -H "x-internal-auth: 59c7ba5958b3c753f607a1bdeeb53ae36aabac6ebcf8729f6d411f43fc704122" \
  "https://www.nowoptimal.com/ops/api/ipad/billing/products/?q=bpc" | jq .
```

---

## STEP 3: Build Product Search Modal in iPad App

**File:** `public/ipad/app.js`

Add a new function `showProductSearchModal(patientData)` that replaces the old `prompt()` dialogs in the charge flow. This function should:

### 3A. Create the modal HTML

```javascript
function showProductSearchModal(patientData) {
    const { patientId, healthieId, patientName, paymentMethods } = patientData;
    
    // Find the default Direct Stripe card
    const directCards = paymentMethods.filter(pm => 
        pm.source_type === 'direct_stripe' || pm.id?.startsWith('direct_pm_')
    );
    const defaultCard = directCards.find(c => c.is_default) || directCards[0];
    
    if (!defaultCard) {
        showToast('No billing card on file. Please add a card first.', 'error');
        return;
    }

    const modal = document.createElement('div');
    modal.id = 'product-search-modal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.7); z-index: 10000;
        display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(4px);
    `;
    
    modal.innerHTML = `
        <div style="
            background: var(--bg-primary, #1a1a2e); border-radius: 16px;
            width: 90%; max-width: 500px; max-height: 85vh;
            overflow: hidden; border: 1px solid var(--border-color, #2d2d4a);
            display: flex; flex-direction: column;
        ">
            <!-- Header -->
            <div style="padding: 20px 24px 16px; border-bottom: 1px solid var(--border-color, #2d2d4a);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-size: 18px; font-weight: 700; color: var(--text-primary, #fff);">
                            💳 Bill Patient
                        </div>
                        <div style="font-size: 13px; color: var(--text-secondary, #aaa); margin-top: 4px;">
                            ${patientName} • Card ending ${defaultCard.last4 || '****'}
                        </div>
                    </div>
                    <button onclick="document.getElementById('product-search-modal')?.remove()" style="
                        background: none; border: none; color: var(--text-secondary, #aaa);
                        font-size: 24px; cursor: pointer; padding: 4px;
                    ">✕</button>
                </div>
                
                <!-- Search Input -->
                <div style="margin-top: 16px; position: relative;">
                    <input 
                        type="text" 
                        id="product-search-input"
                        placeholder="Search peptides... (e.g. bpc157, tesamorelin)"
                        oninput="handleProductSearch(this.value)"
                        autocomplete="off"
                        style="
                            width: 100%; padding: 12px 16px; padding-left: 40px;
                            background: var(--bg-secondary, #16162a); 
                            border: 1px solid var(--border-color, #2d2d4a);
                            border-radius: 10px; color: var(--text-primary, #fff);
                            font-size: 15px; outline: none; box-sizing: border-box;
                        "
                    />
                    <span style="position: absolute; left: 14px; top: 50%; transform: translateY(-50%); font-size: 16px;">🔍</span>
                </div>
            </div>
            
            <!-- Product Results -->
            <div id="product-search-results" style="
                flex: 1; overflow-y: auto; padding: 8px 16px;
                max-height: 45vh;
            ">
                <div style="text-align: center; padding: 40px 20px; color: var(--text-tertiary, #666);">
                    Type to search products or choose Custom Charge below
                </div>
            </div>
            
            <!-- Footer: Custom Charge Option -->
            <div style="padding: 16px 24px; border-top: 1px solid var(--border-color, #2d2d4a);">
                <button onclick="showCustomChargeForm('${patientId}', '${healthieId}', '${patientName}')" style="
                    width: 100%; padding: 12px;
                    background: transparent; 
                    border: 1px dashed var(--border-color, #2d2d4a);
                    border-radius: 8px; color: var(--text-secondary, #aaa);
                    font-size: 13px; cursor: pointer;
                ">
                    ✏️ Custom Charge (enter amount manually)
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Focus search input
    setTimeout(() => document.getElementById('product-search-input')?.focus(), 100);
    
    // Store patient data for use in charge function
    window._currentChargePatient = patientData;
}
```

### 3B. Add product search handler with debounce

```javascript
let _productSearchTimeout = null;

function handleProductSearch(query) {
    clearTimeout(_productSearchTimeout);
    
    if (!query || query.length < 2) {
        document.getElementById('product-search-results').innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: var(--text-tertiary, #666);">
                Type at least 2 characters to search
            </div>
        `;
        return;
    }
    
    // Show loading
    document.getElementById('product-search-results').innerHTML = `
        <div style="text-align: center; padding: 20px; color: var(--text-secondary, #aaa);">
            Searching...
        </div>
    `;
    
    _productSearchTimeout = setTimeout(async () => {
        try {
            const resp = await fetch(`/ops/api/ipad/billing/products/?q=${encodeURIComponent(query)}`, {
                credentials: 'include'
            });
            const data = await resp.json();
            
            if (!data.success || !data.products?.length) {
                document.getElementById('product-search-results').innerHTML = `
                    <div style="text-align: center; padding: 40px 20px; color: var(--text-tertiary, #666);">
                        No products found for "${query}"
                    </div>
                `;
                return;
            }
            
            const resultsHtml = data.products.map(p => `
                <div onclick="selectProduct(${JSON.stringify(p).replace(/"/g, '&quot;')})" style="
                    padding: 14px 16px; margin: 6px 0;
                    background: var(--bg-secondary, #16162a);
                    border: 1px solid var(--border-color, #2d2d4a);
                    border-radius: 10px; cursor: pointer;
                    transition: all 0.15s ease;
                " onmouseover="this.style.borderColor='#f093fb'" onmouseout="this.style.borderColor='var(--border-color, #2d2d4a)'">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="flex: 1;">
                            <div style="font-size: 14px; font-weight: 600; color: var(--text-primary, #fff);">
                                ${p.name}
                            </div>
                            <div style="font-size: 11px; color: var(--text-tertiary, #666); margin-top: 4px;">
                                ${p.supplier || 'No supplier'} ${p.category ? '• ' + p.category : ''}
                            </div>
                        </div>
                        <div style="
                            font-size: 18px; font-weight: 700; color: #f093fb;
                            min-width: 70px; text-align: right;
                        ">
                            $${parseFloat(p.price || 0).toFixed(2)}
                        </div>
                    </div>
                </div>
            `).join('');
            
            document.getElementById('product-search-results').innerHTML = resultsHtml;
        } catch (err) {
            console.error('Product search error:', err);
            document.getElementById('product-search-results').innerHTML = `
                <div style="text-align: center; padding: 20px; color: #ef4444;">
                    Search failed. Please try again.
                </div>
            `;
        }
    }, 300); // 300ms debounce
}
```

### 3C. Add product selection and charge confirmation

```javascript
function selectProduct(product) {
    const patient = window._currentChargePatient;
    if (!patient) return;
    
    const modal = document.getElementById('product-search-modal');
    if (!modal) return;
    
    // Replace modal content with charge confirmation
    modal.querySelector('div').innerHTML = `
        <div style="padding: 24px;">
            <div style="font-size: 18px; font-weight: 700; color: var(--text-primary, #fff); margin-bottom: 20px;">
                Confirm Charge
            </div>
            
            <div style="
                background: var(--bg-secondary, #16162a); border-radius: 12px;
                padding: 16px; margin-bottom: 16px;
                border: 1px solid var(--border-color, #2d2d4a);
            ">
                <div style="font-size: 11px; text-transform: uppercase; color: var(--text-tertiary, #666); margin-bottom: 6px;">Patient</div>
                <div style="font-size: 15px; color: var(--text-primary, #fff); font-weight: 600;">${patient.patientName}</div>
            </div>
            
            <div style="
                background: var(--bg-secondary, #16162a); border-radius: 12px;
                padding: 16px; margin-bottom: 16px;
                border: 1px solid var(--border-color, #2d2d4a);
            ">
                <div style="font-size: 11px; text-transform: uppercase; color: var(--text-tertiary, #666); margin-bottom: 6px;">Product</div>
                <div style="font-size: 15px; color: var(--text-primary, #fff); font-weight: 600;">${product.name}</div>
                <div style="font-size: 12px; color: var(--text-secondary, #aaa); margin-top: 4px;">${product.supplier || ''}</div>
            </div>
            
            <div style="
                background: var(--bg-secondary, #16162a); border-radius: 12px;
                padding: 16px; margin-bottom: 16px;
                border: 1px solid var(--border-color, #2d2d4a);
            ">
                <div style="font-size: 11px; text-transform: uppercase; color: var(--text-tertiary, #666); margin-bottom: 6px;">Amount</div>
                <input type="number" id="charge-amount" value="${product.price || ''}" step="0.01" min="0.01" style="
                    width: 100%; padding: 10px; background: var(--bg-primary, #1a1a2e);
                    border: 1px solid var(--border-color, #2d2d4a); border-radius: 8px;
                    color: var(--text-primary, #fff); font-size: 20px; font-weight: 700;
                    box-sizing: border-box;
                " />
                <div style="font-size: 11px; color: var(--text-tertiary, #666); margin-top: 4px;">
                    Default: $${parseFloat(product.price || 0).toFixed(2)} — edit if needed
                </div>
            </div>
            
            <div style="display: flex; gap: 12px; margin-top: 24px;">
                <button onclick="document.getElementById('product-search-modal')?.remove()" style="
                    flex: 1; padding: 14px; background: var(--bg-secondary, #16162a);
                    border: 1px solid var(--border-color, #2d2d4a); border-radius: 10px;
                    color: var(--text-secondary, #aaa); font-size: 14px; font-weight: 600; cursor: pointer;
                ">
                    Cancel
                </button>
                <button onclick="executeProductCharge(${product.product_id}, '${product.name.replace(/'/g, "\\'")}', document.getElementById('charge-amount').value)" style="
                    flex: 2; padding: 14px;
                    background: linear-gradient(135deg, #f093fb, #f5576c);
                    border: none; border-radius: 10px;
                    color: white; font-size: 14px; font-weight: 700; cursor: pointer;
                ">
                    💳 Charge $${parseFloat(product.price || 0).toFixed(2)}
                </button>
            </div>
        </div>
    `;
    
    // Update charge button dynamically when amount changes
    const amountInput = document.getElementById('charge-amount');
    if (amountInput) {
        amountInput.addEventListener('input', function() {
            const btn = modal.querySelector('button[onclick*="executeProductCharge"]');
            if (btn) {
                const amt = parseFloat(this.value) || 0;
                btn.textContent = '💳 Charge $' + amt.toFixed(2);
            }
        });
    }
}
```

### 3D. Add custom charge form (for non-product charges)

```javascript
function showCustomChargeForm(patientId, healthieId, patientName) {
    const modal = document.getElementById('product-search-modal');
    if (!modal) return;
    
    modal.querySelector('div').innerHTML = `
        <div style="padding: 24px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                <button onclick="document.getElementById('product-search-modal')?.remove(); showProductSearchModal(window._currentChargePatient);" style="
                    background: none; border: none; color: var(--text-secondary, #aaa);
                    font-size: 18px; cursor: pointer;
                ">← </button>
                <div style="font-size: 18px; font-weight: 700; color: var(--text-primary, #fff);">
                    Custom Charge
                </div>
            </div>
            
            <div style="margin-bottom: 16px;">
                <label style="font-size: 12px; color: var(--text-secondary, #aaa); text-transform: uppercase;">Amount ($)</label>
                <input type="number" id="custom-charge-amount" step="0.01" min="0.01" placeholder="0.00" style="
                    width: 100%; padding: 12px; margin-top: 6px;
                    background: var(--bg-secondary, #16162a);
                    border: 1px solid var(--border-color, #2d2d4a); border-radius: 8px;
                    color: var(--text-primary, #fff); font-size: 18px; font-weight: 700;
                    box-sizing: border-box;
                " />
            </div>
            
            <div style="margin-bottom: 24px;">
                <label style="font-size: 12px; color: var(--text-secondary, #aaa); text-transform: uppercase;">Description</label>
                <input type="text" id="custom-charge-description" placeholder="Reason for charge..." style="
                    width: 100%; padding: 12px; margin-top: 6px;
                    background: var(--bg-secondary, #16162a);
                    border: 1px solid var(--border-color, #2d2d4a); border-radius: 8px;
                    color: var(--text-primary, #fff); font-size: 14px;
                    box-sizing: border-box;
                " />
            </div>
            
            <div style="display: flex; gap: 12px;">
                <button onclick="document.getElementById('product-search-modal')?.remove()" style="
                    flex: 1; padding: 14px; background: var(--bg-secondary, #16162a);
                    border: 1px solid var(--border-color, #2d2d4a); border-radius: 10px;
                    color: var(--text-secondary, #aaa); font-size: 14px; font-weight: 600; cursor: pointer;
                ">Cancel</button>
                <button onclick="executeCustomCharge('${patientId}', '${healthieId}', '${patientName.replace(/'/g, "\\'")}')" style="
                    flex: 2; padding: 14px;
                    background: linear-gradient(135deg, #f093fb, #f5576c);
                    border: none; border-radius: 10px;
                    color: white; font-size: 14px; font-weight: 700; cursor: pointer;
                ">💳 Charge</button>
            </div>
        </div>
    `;
    
    setTimeout(() => document.getElementById('custom-charge-amount')?.focus(), 100);
}

async function executeCustomCharge(patientId, healthieId, patientName) {
    const amount = parseFloat(document.getElementById('custom-charge-amount')?.value);
    const description = document.getElementById('custom-charge-description')?.value?.trim();
    
    if (!amount || amount <= 0) {
        showToast('Please enter a valid amount', 'error');
        return;
    }
    if (!description) {
        showToast('Please enter a description', 'error');
        return;
    }
    
    await processCharge({
        patientId,
        healthieId,
        patientName,
        amount,
        description,
        productId: null,
        stripeAccount: 'direct'
    });
}
```

### 3E. Add the core charge execution function

```javascript
async function executeProductCharge(productId, productName, amount) {
    const patient = window._currentChargePatient;
    if (!patient) return;
    
    const chargeAmount = parseFloat(amount);
    if (!chargeAmount || chargeAmount <= 0) {
        showToast('Please enter a valid amount', 'error');
        return;
    }
    
    await processCharge({
        patientId: patient.patientId,
        healthieId: patient.healthieId,
        patientName: patient.patientName,
        amount: chargeAmount,
        description: productName,
        productId: productId,
        stripeAccount: 'direct'
    });
}

async function processCharge({ patientId, healthieId, patientName, amount, description, productId, stripeAccount }) {
    // Show loading state
    const modal = document.getElementById('product-search-modal');
    if (modal) {
        const buttons = modal.querySelectorAll('button');
        buttons.forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });
    }
    
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
                product_id: productId  // NEW: links to peptide inventory
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Remove the search modal
            modal?.remove();
            
            // Show success with label print option if peptide
            showChargeSuccess({
                patientName,
                amount,
                description,
                chargeId: result.charge_id,
                productId: productId,
                dispenseId: result.dispense_id,  // NEW: returned from charge endpoint
                paymentMethod: result.payment_method
            });
            
            showToast(`✅ Charged ${patientName} $${amount.toFixed(2)} for ${description}`, 'success');
            
            // Refresh the financial tab data
            if (typeof loadPatientPaymentData === 'function') {
                loadPatientPaymentData(healthieId || patientId);
            }
        } else {
            showToast(`❌ Charge failed: ${result.error || 'Unknown error'}`, 'error');
            if (modal) {
                const buttons = modal.querySelectorAll('button');
                buttons.forEach(b => { b.disabled = false; b.style.opacity = '1'; });
            }
        }
    } catch (err) {
        console.error('Charge error:', err);
        showToast('❌ Network error — charge may not have processed. Check before retrying.', 'error');
        if (modal) {
            const buttons = modal.querySelectorAll('button');
            buttons.forEach(b => { b.disabled = false; b.style.opacity = '1'; });
        }
    }
}
```

### 3F. Add charge success modal with label printing

```javascript
function showChargeSuccess({ patientName, amount, description, chargeId, productId, dispenseId, paymentMethod }) {
    const isPeptide = productId != null;
    
    const successModal = document.createElement('div');
    successModal.id = 'charge-success-modal';
    successModal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.7); z-index: 10001;
        display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(4px);
    `;
    
    successModal.innerHTML = `
        <div style="
            background: var(--bg-primary, #1a1a2e); border-radius: 16px;
            width: 90%; max-width: 420px; padding: 32px 24px;
            border: 1px solid rgba(16, 185, 129, 0.3);
            text-align: center;
        ">
            <div style="font-size: 48px; margin-bottom: 16px;">✅</div>
            <div style="font-size: 20px; font-weight: 700; color: #10b981; margin-bottom: 8px;">
                Payment Successful
            </div>
            <div style="font-size: 14px; color: var(--text-secondary, #aaa); margin-bottom: 24px;">
                ${patientName} — $${parseFloat(amount).toFixed(2)}
                <br/>${description}
                ${paymentMethod ? `<br/>Card ending ${paymentMethod.last4}` : ''}
            </div>
            
            ${isPeptide ? `
                <div style="margin-bottom: 16px;">
                    <div style="
                        background: rgba(240, 147, 251, 0.08); border: 1px solid rgba(240, 147, 251, 0.2);
                        border-radius: 10px; padding: 12px; margin-bottom: 12px;
                        font-size: 12px; color: var(--text-secondary, #aaa);
                    ">
                        📦 Peptide inventory updated automatically<br/>
                        Dispense logged for ${patientName}
                    </div>
                    <button onclick="printPeptideLabel(${dispenseId})" style="
                        width: 100%; padding: 14px;
                        background: linear-gradient(135deg, #3b82f6, #2563eb);
                        border: none; border-radius: 10px;
                        color: white; font-size: 14px; font-weight: 600; cursor: pointer;
                    ">
                        🏷️ Print Label
                    </button>
                </div>
            ` : ''}
            
            <button onclick="document.getElementById('charge-success-modal')?.remove()" style="
                width: 100%; padding: 14px;
                background: var(--bg-secondary, #16162a);
                border: 1px solid var(--border-color, #2d2d4a);
                border-radius: 10px; color: var(--text-primary, #fff);
                font-size: 14px; font-weight: 600; cursor: pointer;
            ">
                Done
            </button>
        </div>
    `;
    
    document.body.appendChild(successModal);
}
```

---

## STEP 4: Modify Charge Endpoint to Create Peptide Dispense

**File:** `app/api/ipad/billing/charge/route.ts`

This is the most critical change. After a successful charge, if `product_id` is provided and maps to a peptide product, auto-create a dispense record.

### 4A. Add product_id to the request body parsing

In the POST handler, where the request body is parsed, add `product_id`:

```typescript
const { patient_id, amount, description, stripe_account, product_id } = await request.json();
```

### 4B. After successful charge, create dispense record

Find the section AFTER the charge succeeds (after `chargeViaDirectStripe()` or `chargeViaHealthie()` returns success). Add this block:

```typescript
// === AUTO-CREATE PEPTIDE DISPENSE IF PRODUCT IS A PEPTIDE ===
let dispenseId = null;

if (product_id) {
    try {
        // Verify this product exists and is a peptide
        const productCheck = await pool.query(
            'SELECT product_id, name, category FROM peptide_products WHERE product_id = $1 AND active = true',
            [product_id]
        );
        
        if (productCheck.rows.length > 0) {
            const product = productCheck.rows[0];
            
            // Get patient name from the resolved patient data
            // (use the patientName variable that already exists in this function scope)
            
            const dispenseResult = await pool.query(
                `INSERT INTO peptide_dispenses 
                    (product_id, quantity, patient_name, sale_date, status, education_complete, 
                     notes, paid, stripe_payment_intent_id, amount_charged)
                 VALUES ($1, 1, $2, CURRENT_DATE, 'Paid', true, $3, true, $4, $5)
                 RETURNING sale_id`,
                [
                    product_id,
                    patientName || 'Unknown',
                    `Auto-created from iPad billing. Charge: ${chargeResult.charge_id || 'N/A'}`,
                    chargeResult.charge_id || null,
                    amount
                ]
            );
            
            dispenseId = dispenseResult.rows[0]?.sale_id;
            console.log(`[billing/charge] Auto-created peptide dispense ${dispenseId} for product ${product.name}`);
        }
    } catch (dispenseError) {
        // Log but don't fail the charge — the charge already succeeded
        console.error('[billing/charge] Failed to auto-create peptide dispense:', dispenseError);
    }
}
```

### 4C. Include dispense_id in the response

In the success response object, add:

```typescript
return NextResponse.json({
    success: true,
    stripe_account: stripe_account,
    patient_name: patientName,
    amount: amount,
    charge_id: chargeResult.charge_id,
    status: chargeResult.status,
    payment_method: chargeResult.payment_method,
    dispense_id: dispenseId  // NEW: null if not a peptide, integer if dispense was created
});
```

**IMPORTANT NOTES:**
- The dispense creation is wrapped in try/catch — if it fails, the charge still succeeds. This is intentional: a billing charge should never fail because the inventory logging had an issue.
- `status: 'Paid'` and `education_complete: true` are set because the patient is paying right now at the clinic. This causes the inventory formula to auto-decrement stock.
- The `stripe_payment_intent_id` field links the dispense to the Stripe charge for audit trail.

---

## STEP 5: Create Label Print API Endpoint

**New file:** `app/api/ipad/billing/label/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
// Import the existing label generator — check exact path:
// It's at lib/pdf/labelGenerator.ts — import the generateLabelPdf function
import { generateLabelPdf } from '@/lib/pdf/labelGenerator';

export async function GET(request: NextRequest) {
    // === AUTH: Same auth pattern as charge endpoint ===
    
    const dispenseId = request.nextUrl.searchParams.get('dispense_id');
    if (!dispenseId) {
        return NextResponse.json({ error: 'dispense_id required' }, { status: 400 });
    }
    
    try {
        // Get dispense + product + patient info
        const result = await pool.query(`
            SELECT 
                d.sale_id, d.patient_name, d.patient_dob, d.sale_date,
                d.quantity, d.amount_charged,
                p.name as product_name, p.category
            FROM peptide_dispenses d
            JOIN peptide_products p ON p.product_id = d.product_id
            WHERE d.sale_id = $1
        `, [dispenseId]);
        
        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Dispense not found' }, { status: 404 });
        }
        
        const dispense = result.rows[0];
        
        // Generate the label PDF using existing generator
        // IMPORTANT: Check the exact function signature in lib/pdf/labelGenerator.ts
        // and match the parameters exactly. The function likely expects:
        const pdfBuffer = await generateLabelPdf({
            type: 'peptide',
            patientName: dispense.patient_name,
            patientDob: dispense.patient_dob || '',
            medication: dispense.product_name,
            dateDispensed: dispense.sale_date
            // Check if there are additional required params like lot number, expiration, etc.
            // If so, add them or use sensible defaults
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

### Add label print function to iPad app

**File:** `public/ipad/app.js`

```javascript
async function printPeptideLabel(dispenseId) {
    if (!dispenseId) {
        showToast('No dispense ID — cannot generate label', 'error');
        return;
    }
    
    try {
        // Open the label PDF in a new tab for printing
        const labelUrl = `/ops/api/ipad/billing/label/?dispense_id=${dispenseId}`;
        window.open(labelUrl, '_blank');
        showToast('Label opened in new tab — print from there', 'success');
    } catch (err) {
        console.error('Label print error:', err);
        showToast('Failed to open label', 'error');
    }
}
```

---

## STEP 6: Ensure All 35 Peptide Products Exist in Database

Run this verification query first:

```sql
SELECT product_id, name, sell_price, unit_cost, supplier, active 
FROM peptide_products 
WHERE active = true 
ORDER BY name;
```

Compare the results against this list of 35 products. For any products that are MISSING, insert them using this pattern:

```sql
-- Template for inserting missing peptide products
-- DO NOT include inventory quantities — only product catalog data
INSERT INTO peptide_products (name, sell_price, unit_cost, supplier, category, active)
VALUES 
-- Only insert rows for products NOT already in the table
-- Check each name before inserting to avoid duplicates

('Peptide - AOD 9604 (3mg)', 150.00, 60.00, 'Alpha BioMed', 'peptide', true),
('Peptide - AOD 9604 (5mg)', 150.00, 150.00, 'Alpha BioMed', 'peptide', true),
('Peptide - BPC-157 (10mg)', 130.00, 130.00, 'Alpha BioMed', 'peptide', true),
('Peptide - BPC-157 (10mg) / TB 500 ( 10mg)', 196.00, 83.00, 'Alpha BioMed', 'peptide', true),
('Peptide - BPC-157 (20mg)', 180.00, 75.00, 'Alpha BioMed', 'peptide', true),
('Peptide - BPC-157 (5mg)', 120.00, 45.00, 'Alpha BioMed', 'peptide', true),
('Peptide - CJC 1295 without DAC (10mg)', 150.00, NULL, 'Alpha BioMed', 'peptide', true),
('Peptide - CJC w/ DAC (10mg)', 170.00, 170.00, 'Alpha BioMed', 'peptide', true),
('Peptide - CJC-1295 with Ipamorelin (5mg)', 140.00, NULL, 'Alpha BioMed', 'peptide', true),
('Peptide - Gonadorelin (10mg)', 150.00, 60.00, 'Alpha BioMed', 'peptide', true),
('Peptide - HCG ( 10,000 iu)', 198.00, 84.00, 'Alpha BioMed', 'peptide', true),
('Peptide - PT 141 (10 mg)', 130.00, 50.00, 'Alpha BioMed', 'peptide', true),
('Peptide - PT 141 (5mg)', 110.00, 40.00, 'Alpha BioMed', 'peptide', true),
('Peptide - Retatrutide (10 mg)', 375.00, NULL, 'Alpha BioMed', 'peptide', true),
('Peptide - Retatrutide (24 mg)', 664.00, NULL, 'Alpha BioMed', 'peptide', true),
('Peptide - Semax (30mg)', 120.00, 45.00, 'Alpha BioMed', 'peptide', true),
('Peptide - Semorelin (10mg)', 160.00, 65.00, 'Alpha BioMed', 'peptide', true),
('Peptide - TB500 Thymosin Beta 4 (10mg)', 150.00, 60.00, 'Alpha BioMed', 'peptide', true),
('Peptide - TB500 Thymosin Beta 4 (5mg)', 130.00, 50.00, 'Alpha BioMed', 'peptide', true),
('Peptide - Tesamorelin (10mg)', 160.00, 65.00, 'Alpha BioMed', 'peptide', true),
('Peptide - Tesamorelin (10mg) / Ipamorelin (5mg)', 160.00, 65.00, 'Alpha BioMed', 'peptide', true),
('Peptide- 2x blend CJC 1295 no DAC (5mg)/ Ipamorelin (5mg)', 140.00, 55.00, 'Alpha BioMed', 'peptide', true),
('Peptide- 2x blend Tesamorelin (10mg)/ Ipamorelin (5mg)', 160.00, 65.00, 'Alpha BioMed', 'peptide', true),
('Peptide- 2x blend Tesamorelin (5mg)/ Ipamorelin (5mg)', 140.00, 55.00, 'Alpha BioMed', 'peptide', true),
('Peptide- 3x blend Tesamorelin (5mg)/ MGF (500mcg)/ Ipamorelin (2.5mg)', 150.00, 60.00, 'Alpha BioMed', 'peptide', true),
('Peptide- 4x blend GHRP-2 (5mg)/ Tesamorelin (5mg)/ MGF (500mcg)/ Ipamorelin (2.5mg)', 160.00, 65.00, 'Alpha BioMed', 'peptide', true),
('Peptide- Gondorellin (5mg)', 120.00, 45.00, 'Alpha BioMed', 'peptide', true),
('Peptide- HCG (5000iu)', 128.00, 49.00, 'Alpha BioMed', 'peptide', true),
('Peptide- Ipamorellin (10mg)', 120.00, 45.00, 'Alpha BioMed', 'peptide', true),
('Peptide- Semorelin (5mg)', 120.00, 45.00, 'Alpha BioMed', 'peptide', true),
('Peptide- Tesamorelin (8mg)', 148.00, 59.00, 'Alpha BioMed', 'peptide', true),
('Peptide - GHRP-6 (5mg)', 90.00, 90.00, NULL, 'peptide', true),
('Peptide - Staff 2x CJC/Ipamorelin', 75.00, NULL, NULL, 'peptide', true),
('Peptide- GHK-CU 100mg', 130.00, 52.00, NULL, 'peptide', true),
('Peptide- GHK-CU 50mg', 100.00, 40.00, NULL, 'peptide', true)
ON CONFLICT (name) DO UPDATE SET
    sell_price = EXCLUDED.sell_price,
    unit_cost = EXCLUDED.unit_cost,
    supplier = EXCLUDED.supplier,
    category = EXCLUDED.category,
    active = true;
```

**NOTE:** If the `peptide_products` table does NOT have a unique constraint on `name`, add one first or use a different dedup approach:

```sql
-- Check if unique constraint exists
SELECT conname FROM pg_constraint WHERE conrelid = 'peptide_products'::regclass AND contype = 'u';

-- If no unique constraint on name, use this approach instead:
-- For each product, check if it exists first, then INSERT only if missing
```

Write a proper migration script that:
1. Checks what products already exist (by name, case-insensitive)
2. Only inserts the ones that are missing
3. Updates prices on existing ones if they've changed
4. Logs what was inserted/updated

---

## STEP 7: Restart and Test

### 7A. Build and verify

```bash
cd /home/ec2-user/gmhdashboard
npm run build
```

If the build fails, fix the errors before proceeding. Do NOT restart PM2 with a broken build.

### 7B. Restart the Next.js app service

```bash
pm2 restart gmh-dashboard  # or whatever the PM2 process name is — check with: pm2 list
```

### 7C. Test each endpoint

```bash
# Test 1: Product search
curl -s -H "x-internal-auth: 59c7ba5958b3c753f607a1bdeeb53ae36aabac6ebcf8729f6d411f43fc704122" \
  "https://www.nowoptimal.com/ops/api/ipad/billing/products/?q=bpc" | jq .

# Test 2: Product search with different query
curl -s -H "x-internal-auth: 59c7ba5958b3c753f607a1bdeeb53ae36aabac6ebcf8729f6d411f43fc704122" \
  "https://www.nowoptimal.com/ops/api/ipad/billing/products/?q=tesamorelin" | jq .

# Test 3: Label endpoint (use a valid dispense_id from the DB)
# First find one:
# SELECT sale_id FROM peptide_dispenses ORDER BY sale_id DESC LIMIT 1;
```

### 7D. Verify on iPad

1. Go to https://www.nowoptimal.com/ops/ — log in
2. Go to https://www.nowoptimal.com/ipad/
3. Open a patient chart → Financial tab
4. Verify: "Add Card to Healthie Stripe" button is GONE
5. Verify: "Bill Patient for Product/Service" section is still there
6. Verify: Cards show clear "Billing Card (Direct)" vs "Healthie Card" labels
7. Tap "Charge Patient" → verify product search modal appears
8. Search "bpc" → verify BPC-157 products appear
9. Select a product → verify amount auto-fills
10. Process a test charge on a test patient
11. Verify dispense was auto-created in the Peptides inventory
12. Test "Print Label" button

---

## WHAT NOT TO TOUCH

- **DO NOT** modify any QuickBooks sync logic
- **DO NOT** modify any Healthie webhook handlers (except the charge endpoint modifications above)
- **DO NOT** change any cron jobs or PM2 service configurations
- **DO NOT** modify the controlled substance / DEA compliance code
- **DO NOT** change the vial inventory system
- **DO NOT** alter the payment_transactions table structure
- **DO NOT** change how the Healthie GraphQL integration works for packages/subscriptions
- **DO NOT** modify nginx configuration

---

## FILE CHANGE SUMMARY

| File | Action | What Changes |
|------|--------|-------------|
| `public/ipad/app.js` | MODIFY | Remove Healthie card button, remove addNewCard(), simplify charge flow, add product search modal, add label printing |
| `app/api/ipad/billing/products/route.ts` | NEW | Product search API endpoint |
| `app/api/ipad/billing/label/route.ts` | NEW | Label PDF generation endpoint |
| `app/api/ipad/billing/charge/route.ts` | MODIFY | Add product_id param, auto-create peptide dispense on charge |
| `peptide_products` table | DATA | Ensure all 35 peptide products exist |
