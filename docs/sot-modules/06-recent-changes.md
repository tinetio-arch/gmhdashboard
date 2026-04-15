**Essential PM2 Commands:**
```bash
# Start a service (CORRECT way)
pm2 start /home/ec2-user/ecosystem.config.js --only <service-name>

# Restart after code changes (SAFE - preserves env vars if started from ecosystem)
pm2 restart <service-name>

# Check status
pm2 list

# View logs
pm2 logs <service-name> --lines 50

# ALWAYS save after changes
pm2 save
```

> [!WARNING]
> **AFTER PM2 UPDATES / `pm2 update` / SYSTEM REBOOT — USE THIS PROCEDURE:**
>
> PM2 updates can lose process env vars (like PORT). If services restart without their PORT env var, Next.js defaults to **port 3000**, causing 502 errors and EADDRINUSE cascading failures.
>
> **Correct restart procedure:**
> ```bash
> # 1. Stop all services
> pm2 stop all
>
> # 2. Delete all processes (clears stale state)
> pm2 delete all
>
> # 3. Start ALL services from ecosystem config (restores PORT env vars)
> pm2 start /home/ec2-user/ecosystem.config.js
>
> # 4. Wait 10 seconds, verify all online
> sleep 10 && pm2 list
>
> # 5. Save the process list
> pm2 save
> ```
>
> **If a single service is down:**
> ```bash
> pm2 delete <service-name>
> pm2 start /home/ec2-user/ecosystem.config.js --only <service-name>
> pm2 save
> ```
>
> **NEVER** use `pm2 start npm -- start` directly — it won't have PORT or NODE_ENV set.

> [!CAUTION]
> **Port Conflict Incidents:**
> - **Jan 28, 2026**: `nowprimary-website` and `nowmenshealth-website` reached **34,000+ restarts** — ad-hoc start without restart limits, port conflicts caused infinite CPU meltdown.
> - **Mar 4, 2026**: After PM2 update, `gmh-dashboard` lost PORT=3011 env var → started on 3000 → **502 Bad Gateway**. `nowoptimal-website` also tried 3000 → EADDRINUSE. `jessica-mcp` failed because `psycopg2` wasn't installed for python3.11. **Fix**: delete ad-hoc processes, restart from ecosystem config.

---

## 🔥 RECENT MAJOR CHANGES (DEC 25, 2025 - APR 1, 2026)

### April 1, 2026: iPad Billing Standardization, Receipt System & ABX TAC Brand Separation

#### 1. Standardized iPad Billing Receipts to "NOWOptimal Service"

**Change**: ALL iPad charges now display "NOWOptimal Service" on Stripe receipts for compliance and brand consistency.

**File Modified**: `/home/ec2-user/gmhdashboard/app/api/ipad/billing/charge/route.ts`

**Technical Details**:
- Stripe receipts show: "NOWOptimal Service" (sanitized)
- Internal database stores: Original product/service descriptions
- CEO Dashboard displays: Actual product names and details
- iPad patient chart shows: Full transaction details with original descriptions

#### 2. ✅ PDF Receipt System - FIXED AND RE-ENABLED

**STATUS: ENABLED** - Receipt generation completely rewritten and fixed (April 1, 2026).

**Critical Issue That Was Fixed**:
- **Melody Smith Crisis**: She purchased **pelleting service for $400** but receipt showed **peptides** (BPC-157, Semaglutide, NAD+)
- **Root Cause**: Hardcoded test data instead of actual purchase descriptions
- **Resolution**: Complete rewrite using simple single-page receipts with actual charge data

**New Receipt System Files**:
- `/home/ec2-user/gmhdashboard/lib/pdf/simpleReceiptGenerator.ts` - Single-page receipt with actual service descriptions
- `/home/ec2-user/gmhdashboard/lib/simpleReceiptUpload.ts` - Upload handler with validation

**Key Features of Fixed System**:
- Uses ACTUAL charge descriptions from database (not hardcoded)
- Single-page PDF (bufferPages: false)
- Correct clinic addresses: 215 N. McCormick for Men's Health, 404 S. Montezuma for others
- Auto-detects service type (men's health, pelleting, peptides, etc.)

**Current Status**:
- ✅ Receipt generation RE-ENABLED in `/home/ec2-user/gmhdashboard/app/api/ipad/billing/charge/route.ts`
- ✅ Receipts being sent to patients' Healthie accounts with CORRECT service descriptions
- ✅ Stripe shows "NOWOptimal Service" for compliance
- ✅ Internal receipts show actual services purchased

#### 3. ABX TAC Brand Separation from NOW Optimal Network

**Change**: Removed ABX TAC brand from nowoptimal.com website per business directive.

**Files Modified**:
- `/home/ec2-user/nowoptimal-website/app/page.tsx` - Removed ABX TAC from brands array
- `/home/ec2-user/nowoptimal-website/components/Footer.tsx` - Removed ABX TAC from footer links

**Context**: ABX TAC (abxtac.com) continues to operate independently on port 3009 as a separate e-commerce platform for research peptides. This change reflects a strategic separation of the peptide brand from the NOW Optimal healthcare network.

**Commands Executed**:
```bash
# For billing changes
cd /home/ec2-user/gmhdashboard
npm run build
pm2 restart gmh-dashboard

# For website changes
cd /home/ec2-user/nowoptimal-website
npm run build
pm2 restart nowoptimal-website
```

### March 24, 2026: 🚀 ABXTac WordPress/WooCommerce E-commerce Platform Deployed

**New System**: ABXTac Research Peptides e-commerce site fully deployed on EC2 instance.

**Stack Installed**:
- **PHP 8.2 + MariaDB 10.5**: New LAMP stack components
- **WordPress 6.9.4**: Content management system
- **WooCommerce 10.6.1**: E-commerce platform
- **ShipStation Integration**: Order fulfillment plugin
- **WP Offload Media**: S3 media storage to `abxtac-media` bucket
- **Storefront Theme**: Clean WooCommerce-optimized theme

**Configuration**:
- **Domain**: https://abxtac.com (SSL via Let's Encrypt)
- **Files**: `/var/www/abxtac/`
- **Database**: `abxtac_wp` (MariaDB)
- **Nginx Config**: `/etc/nginx/conf.d/abxtac.conf`
- **PHP-FPM**: Running via systemd (not PM2)
- **S3 Bucket**: `abxtac-media` for product images
- **Admin Access**: https://abxtac.com/wp-admin (credentials in secure storage)

**Services Status**:
```bash
sudo systemctl status php-fpm    # PHP processor
sudo systemctl status mariadb    # Database
sudo systemctl status nginx      # Web server
```

**Note**: This is separate from GMH Dashboard. WordPress/PHP stack managed by systemd, not PM2.

### April 2, 2026: ABX TAC Website Overhaul & Vial Label Audit

**Website overhaul**: Removed all NOW Optimal Network references. ABX TAC is now a fully independent brand. Updated messaging from tactical/military to clinical/wellness. Improved theme readability (lighter dark navy #0F1218). FDA-only product catalog.

> [!CRITICAL]
> **ABX TAC Vial Label → SKU Definitive Mapping (Audited April 2, 2026)**
>
> The vial mockup images (`/var/www/abxtac/3d-vials/YPB.###_mockup.png`) are the **SOURCE OF TRUTH** for product identity. The supplier SKU list and WooCommerce database do NOT match the vial labels. ALWAYS verify by viewing the actual image before assigning a product to a SKU.
>
> **Active FDA-Compliant Catalog (15 products with verified matching labels):**
>
> | SKU | Vial Label | Dose | Tier | Retail Price |
> |-----|-----------|------|------|-------------|
> | YPB.212 | BPC-157 | 5 mg | Heal | $149.99 |
> | YPB.213 | BPC-157 | 10 mg | Heal | $179.99 |
> | YPB.237 | BPC-157 | 20 mg | Heal | $229.99 |
> | YPB.248 | AOD-9604 | 5 mg | Heal | $169.99 |
> | YPB.221 | GHK-Cu | 50 mg | Heal | $129.99 |
> | YPB.222 | GHK-Cu | 100 mg | Heal | $189.99 |
> | YPB.230 | DSIP | 15 mg | Optimize | $149.99 |
> | YPB.219 | CJC-1295 Without DAC | 10 mg | Optimize | $169.99 |
> | YPB.220 | CJC-1295 With DAC | 5 mg | Optimize | $199.99 |
> | YPB.229 | Semax | 10 mg | Optimize | $149.99 |
> | YPB.228 | Selank | 10 mg | Optimize | $139.99 |
> | YPB.244 | LL-37 (Cathelicidin) | 5 mg | Optimize | $169.99 |
> | YPB.227 | MOTS-c | 10 mg | Thrive | $189.99 |
> | YPB.232 | N-Acetyl Epitalon Amidate | 5 mg | Thrive | $179.99 |
> | YPB.231 | Thymosin Alpha 1 (TA1) | 10 mg | Thrive | $189.99 |
>
> **FDA peptides WITHOUT matching vial images (cannot sell until new mockups created):**
> GHRP-2, GHRP-6, Ipamorelin, Kisspeptin-10, KPV, Melanotan II, PEG-MGF, Thymosin Beta-4 Fragment (LKKTETQ)
>
> **Files**: `abxtac-website/lib/tiers.ts` (catalog), `abxtac-website/lib/product-images.ts` (image map)

---

### March 23, 2026: 🔴 Healthie Payment Failure Detection — Critical Bug Fixes & Billing Audit

**Context**: Manual audit revealed 39 active Healthie patients hadn't paid in February 2026. Investigation uncovered systemic issues in Healthie ID mapping and payment failure detection.

**Root Causes Found & Fixed**:

1. **Stale Healthie ID mappings (25+ patients)**: The `patients.healthie_client_id` column had archived Healthie IDs for patients who were migrated to new accounts. Payments were processing under the new IDs but our system was looking at old ones. All 25+ were remapped to correct IDs.

2. **Fuzzy name duplicates (5 patients)**: Mike Kulik/Michael Kulik, James Lentz/Jamez Lentz, Skip Yost/Earle Yost, Vinny Gallegos/Vincent Gallegos, Mike Katusik/Mike Katusic — same patients with different name spellings across Healthie accounts. Merged in Healthie and mapped correctly.

3. **`sync-healthie-failed-payments.ts` Bug — Wrong reactivation logic**: The script checked the LATEST `requestedPayment` status and reactivated patients from hold if it was "succeeded" — even if that payment was months old. Kyle Dreher's December payment was reactivating him in March. **Fix**: Now only auto-reactivates if payment is within the last 5 days. Older payments require manual reactivation.

4. **`sync-healthie-failed-payments.ts` Bug — Wrong ID mapping**: Was joining on `healthie_clients` table (stale IDs) instead of `patients.healthie_client_id`. **Fix**: Now reads directly from `patients` table.

5. **`process-healthie-webhooks.ts` Bug — billing_item.created was a no-op**: The `handleBillingItems()` function did literally nothing — just returned "processed". This meant ALL recurring package payments (billing_item.created webhooks) were silently ignored. **Fix**: Now fetches the billing item from Healthie API, checks the `offering` (package), detects success/failure, and updates patient status with package name in notes.

6. **Healthie billing data never synced to Snowflake**: The `sync-healthie-billing-items.ts` script existed but the Snowflake `HEALTHIE_BILLING_ITEMS` table was empty — sync had never run. Now synced (631 items) and available for analytics.

**Files Changed**:
- `scripts/sync-healthie-failed-payments.ts` — Fixed patient mapping query + 5-day reactivation window
- `scripts/process-healthie-webhooks.ts` — Rebuilt `handleBillingItems()` to detect payment success/failure from recurring package billing items

**Operational Actions**:
- 19 patients set to `hold_payment_research` with specific action notes (card status, package needed, merge instructions)
- 20 patients excluded from hold (have active recurring payments)
- Notes column updated with exact steps needed per patient

**Key Lesson**: Healthie patient accounts get recreated during migrations (NowMensHealth → NowOptimal), creating duplicate accounts with different IDs. Payment cards stay on old accounts. Must check for ID mismatches and fuzzy name duplicates when auditing billing.

---

### March 18, 2026: Peptide Dispense Log — Server-Side Pagination & Patient Search

**Feature**: Added server-side pagination and patient name search to the Peptide Dispense Log, replacing the previous hard-coded 100-row limit.

**Changes**:
- `lib/peptideQueries.ts`: Added `fetchPeptideDispensesPaginated()` — accepts `patient` (ILIKE search), `status` filter, `offset`, `limit`; returns `{ dispenses, total }` for pagination
- `app/api/peptides/dispenses/route.ts`: GET now accepts query params `?patient=&status=&limit=&offset=`; backwards-compatible (no params = legacy flat array for SSR)
- `app/peptides/DispenseHistory.tsx`: Added patient search input (debounced 300ms), server-side pagination (50 per page with Previous/Next), status filter triggers server query. Initial SSR data still loads for fast first paint; search/filter/pagination switches to client-side fetching.

**API Contract** (new):
```
GET /api/peptides/dispenses?patient=Smith&status=Paid&limit=50&offset=0
→ { dispenses: PeptideDispense[], total: number }
```
Without query params, returns flat `PeptideDispense[]` array (legacy).

---

### March 14, 2026: 💳 Dual-Stripe Billing Implementation (iPad App) - COMPLETE

**Feature**: Implemented dual-Stripe account billing in iPad App with **hybrid strategy** - Healthie for packages/subscriptions, Direct Stripe for retail/one-off purchases.

**🎯 Hybrid Billing Strategy** (User Decision: March 14, 2026):
- **Healthie Stripe** → For recurring packages & subscriptions managed in Healthie
- **Direct Stripe (MindGravity)** → For retail items, supplements, peptides, and one-off purchases
- **Why Hybrid**: Leverages strengths of both systems - Healthie's subscription management + MindGravity's retail flexibility

> **CRITICAL (April 1, 2026)**: ALL iPad charges on Stripe receipts now show **"NOWOptimal Service"** for compliance and brand consistency. The actual product/service names are preserved in internal records (payment_transactions table, peptide_dispenses, CEO dashboard). This standardization is handled server-side in `app/api/ipad/billing/charge/route.ts` — ALL charges through the iPad billing system display "NOWOptimal Service" on customer receipts while maintaining detailed descriptions internally.

**Implementation**:

1. **Environment Configuration** ([.env.local](gmhdashboard/.env.local)):
   - Added `STRIPE_PUBLISHABLE_KEY` - Stored in .env.local (never commit to git)
   - Added `STRIPE_SECRET_KEY` - Stored in .env.local (never commit to git)
   - Healthie's Stripe integration managed via Healthie API (Stripe Connect account)

2. **Healthie Client Enhancement** ([lib/healthie.ts:1367-1428](gmhdashboard/lib/healthie.ts#L1367-L1428)):
   - Added `createBillingItem()` mutation for immediate charges via Healthie Stripe
   - Charges saved payment methods on file in Healthie
   - Converts dollars to cents, validates payment methods exist
   - Added `getPaymentMethods()` to retrieve Healthie `stripe_customer_detail` (read-only)

3. **API Endpoints**:
   - **Charging**: [app/api/ipad/billing/charge/route.ts](gmhdashboard/app/api/ipad/billing/charge/route.ts)
     - `POST /api/ipad/billing/charge` with dual-Stripe routing
     - `chargeViaHealthie()` - Uses Healthie GraphQL `createBillingItem` mutation ✅
     - `chargeViaDirectStripe()` - Uses Stripe PaymentIntents API with auto-customer-creation ✅
   - **Card Management**: [app/api/ipad/billing/add-card-dual/route.ts](gmhdashboard/app/api/ipad/billing/add-card-dual/route.ts)
     - Saves cards to Direct Stripe via Stripe Elements ✅
     - **CANNOT** save to Healthie programmatically (Healthie uses Stripe Connect - no API access)
     - Returns both account statuses with explanation

4. **Database Schema** ([migrations/20260314_payment_transactions.sql](gmhdashboard/migrations/20260314_payment_transactions.sql)):
   - New `payment_transactions` table tracks all iPad billing activity
   - Supports both `stripe_account` types: `'healthie'` | `'direct'`
   - Stores Healthie billing item IDs and Stripe charge IDs separately
   - Added `stripe_customer_id` column to `patients` table

5. **iPad App UI** ([public/ipad/app.js:7650-7785](gmhdashboard/public/ipad/app.js#L7650-L7785)):

   **Account Selector Modal**:
   - 🏥 **Healthie Stripe** (green gradient) - "For packages & subscriptions"
   - 🛍️ **Direct Stripe (MindGravity)** (pink gradient) - "For retail & one-off purchases"
   - Pre-flight check: validates patient has payment method on file
   - Prompts for amount and description

   **Card Management** ([app.js:7511-7598](gmhdashboard/public/ipad/app.js#L7511-L7598)):
   - Shows existing Healthie payment methods (card type, last 4, expiration, ZIP)
   - **🏥 For Packages & Subscriptions** section:
     - "Add Card to Healthie Stripe" → Opens Healthie billing page
     - Use for recurring packages managed in Healthie
   - **🛍️ For Retail & One-Off Purchases** section:
     - "Add Card to Direct Stripe" → Opens Stripe Elements popup
     - Use for supplements, peptides, retail items

   **Stripe Elements Integration** ([public/ipad/add-card.html](gmhdashboard/public/ipad/add-card.html)):
   - Beautiful, PCI-compliant card collection form
   - Tokenizes cards on frontend (never touches server)
   - Real-time validation and error handling
   - Patient context displayed (name, email, patient ID)

**Status**: ✅ **FULLY OPERATIONAL**
- ✅ Healthie Stripe charging - LIVE
- ✅ Direct Stripe charging - LIVE (with auto-customer creation)
- ✅ Direct Stripe card saving - LIVE (via Stripe Elements)
- ⚠️ Healthie card saving - Manual via Healthie billing page (architectural limitation)

**Technical Limitation**:
- **Cannot programmatically add cards to Healthie Stripe**: Healthie uses Stripe Connect where THEY are the platform. We only have READ access to `stripe_customer_detail`. Cards must be added via: `https://app.gethealthie.com/patients/{healthie_id}/billing`
- **Stripe's cloning API** doesn't apply - it requires YOU to be the platform account with the destination as YOUR connected account

**Package Installed**:
- `npm install stripe` (Stripe SDK for Node.js)

**Files Created**:
- `/public/ipad/add-card.html` - Stripe Elements card collection page
- `/app/api/ipad/billing/add-card-dual/route.ts` - Card saving API endpoint
- `/migrations/20260314_payment_transactions.sql` - Transaction logging table

**Files Modified**:
- `/public/ipad/app.js` - Fixed patient ID bug, added hybrid billing UI with clear use-case labels
- `/app/api/ipad/billing/charge/route.ts` - Implemented both Healthie and Direct Stripe charging
- `/lib/healthie.ts` - Added `createBillingItem()` and `getPaymentMethods()`
- `/.env.local` - Added Stripe credentials
- Database - Added `stripe_customer_id` column to patients table

**Testing**:
- Test Healthie charges: iPad App → Patient Chart → Financial Tab → "💳 Charge Patient" → Select "Healthie Stripe"
- Test Direct Stripe charges: Same flow → Select "Direct Stripe (MindGravity)"
- Test card adding: "Manage Payment Methods" → Choose appropriate section based on use case

---

### March 13, 2026 PM: 🔐 Provider Schedule Auto-Filter + GMH Patient Chart Data Integration

**Problem**: Providers couldn't see their own schedule when logged into iPad + Patient charts missing critical GMH dashboard data

**Issues Fixed**:
1. **Provider Schedule Not Auto-Filtering**: When Dr. Aaron Whitten logged in, he saw ALL providers' appointments instead of just his own
2. **Missing GMH Dashboard Data**: iPad patient charts only showed Healthie data, missing status, notes, lab dates, supply dates, GHL sync, QB mapping
3. **No Healthie Documents/Forms Display**: Frontend not rendering forms and documents that API already returns

**Root Causes**:
1. Users table had no `healthie_provider_id` column to map dashboard users → Healthie provider IDs
2. `/api/ipad/me` didn't return provider ID, so frontend couldn't auto-filter
3. Patient chart API returned barebones demographics without explicitly mapping GMH fields

**Solution**:
| Component | Change |
|-----------|--------|
| **Database** | Added `healthie_provider_id` column to `users` table via migration `20260313_add_provider_healthie_mapping.sql` |
| **API** | `/api/ipad/me` now queries and returns `healthie_provider_id` for logged-in user |
| **Frontend** | Schedule page auto-adds `?provider_id=12093125` query param when provider logs in |
| **Patient Chart API** | Enhanced `/api/ipad/patient-chart` to JOIN `patient_status_lookup` and explicitly return all GMH fields |

**New Data in Patient Chart API**:
```typescript
demographics: {
  status_key, status_display, status_color,
  patient_notes, lab_notes,
  last_supply_date, next_eligible_date,
  last_lab_date, next_lab_date, lab_status,
  service_start_date, contract_end_date,
  date_added, added_by, method_of_payment,
  ghl_contact_id, ghl_sync_status, ghl_last_synced_at,
  qbo_customer_id, qb_display_name
}
```

**Manual Configuration Required**:
```sql
-- Map users to Healthie provider IDs (run once after deployment)
UPDATE users SET healthie_provider_id = '12093125' WHERE email ILIKE '%whitten%' AND is_provider = true;
UPDATE users SET healthie_provider_id = '12088269' WHERE email ILIKE '%schafer%' AND is_provider = true;
```

**Files Changed**:
- [/migrations/20260313_add_provider_healthie_mapping.sql](file:///migrations/20260313_add_provider_healthie_mapping.sql) — Database migration
- [/app/api/ipad/me/route.ts](file:///app/api/ipad/me/route.ts#L17-L34) — Fetch and return `healthie_provider_id`
- [/app/api/ipad/patient-chart/route.ts](file:///app/api/ipad/patient-chart/route.ts#L55-L124) — Enhanced patient query with all GMH fields
- [/public/ipad/app.js](file:///public/ipad/app.js#L6401-L6406) — Auto-filter schedule by provider

**Testing**:
1. Provider login → Schedule tab → Should only show their appointments (check console for `[Schedule] Provider detected - filtering by provider_id: 12093125`)
2. Open patient chart → Network tab → Check `/api/ipad/patient-chart` response includes status, notes, dates, GHL, QB fields
3. Verify documents/forms data in API response (UI rendering TODO)

**Known Limitations**:
- Provider can still click "All" tab to see other providers' schedules
- Admins (non-providers) see all schedules by default
- Patient chart UI doesn't render forms/documents yet (data is in API, need UI tabs)
- Scribe patient auto-mapping still needs improvement (manual selection required)

**Reference**: [SCHEDULE_AND_CHART_FIXES_MARCH_13.md](file:///home/ec2-user/SCHEDULE_AND_CHART_FIXES_MARCH_13.md)

---

### March 13, 2026 AM: 📱 iPad Patient Chart Complete Overhaul — Diagnosis System, Package Display, API Fixes

**Problem**: User reported multiple critical issues with iPad patient chart functionality:
- Adding allergies returned 500 errors
- Diagnoses not syncing to Healthie patient charts
- Patient packages/subscriptions not displaying
- Schedule system appeared broken
- Payment methods (credit cards) not showing
- Missing patient data fields (regimen, demographics)

**Root Cause Analysis** (7 issues found):

| Issue | Root Cause | Impact |
|-------|-----------|--------|
| **Trailing slash redirect** | Frontend called `/ops/api/ipad/patient-data` (no slash) → Next.js redirected to `/patient-data/` → lost POST data | 500 errors on allergy/diagnosis add |
| **Missing DB import** | `patient-data/route.ts` used `query()` function but didn't import from `@/lib/db` | Runtime crash on diagnosis operations |
| **Invalid Healthie subscriptions query** | Queried `active_offering_coupons` and `recurring_payment` fields that don't exist in Healthie schema | GraphQL errors in logs |
| **Packages not queried** | Patient packages exist in `healthie_package_mapping` table but weren't queried or displayed | User couldn't see active subscriptions |
| **Diagnosis storage architecture** | Diagnoses stored only in local `scribe_notes` table, not synced to Healthie patient chart | Diagnoses invisible in Healthie UI |
| **Remove diagnosis incomplete** | Remove button existed but backend function not properly implemented | Couldn't remove diagnoses |
| **Missing description parameter** | Remove diagnosis API call didn't pass description for Healthie note creation | Incomplete audit trail |

**Fix (7-part):**

| Fix | File | Change |
|-----|------|--------|
| **Trailing slash consistency** | `public/ipad/app.js:7409` | Fixed `/ops/api/ipad/patient-data` → `/ops/api/ipad/patient-data/` (added trailing slash) |
| **Added DB import** | `app/api/ipad/patient-data/route.ts:4` | Added `import { query } from '@/lib/db';` |
| **Removed invalid Healthie query** | `app/api/ipad/patient-chart/route.ts:251-279` | Commented out `active_offering_coupons`/`recurring_payment` query (fields don't exist) |
| **Added package query** | `app/api/ipad/patient-chart/route.ts:294-319` | Query `healthie_package_mapping` JOIN `healthie_packages` via `qbo_customer_id` |
| **Diagnosis → Healthie sync** | `app/api/ipad/patient-data/route.ts:198-283` | `addDiagnosis()` now creates Healthie chart note with formatted ICD-10 info + stores locally |
| **Remove diagnosis complete** | `app/api/ipad/patient-data/route.ts:285-398` | `removeDiagnosis()` creates Healthie removal note + removes from local `scribe_notes` |
| **Frontend package display** | `public/ipad/app.js:4390-4454` | Render `active_packages` from database query (package name, amount, frequency, next charge) |

**Diagnosis System Architecture (NEW)**:

**Add Diagnosis Flow**:
1. User selects ICD-10 code from search (`/api/ipad/icd10-search`)
2. Frontend POSTs to `/api/ipad/patient-data/` with `action: 'add_diagnosis'`, `code`, `description`
3. Backend creates Healthie chart note:
   ```
   🏥 ACTIVE DIAGNOSIS

   ICD-10 Code: E11.9
   Description: Type 2 diabetes mellitus

   Added: 3/13/2026
   Status: Active
   ```
4. Backend also INSERT into `scribe_notes` table (JSONB `icd10_codes` field) for fast iPad display
5. Chart note visible in Healthie web UI with `include_in_charting: true`

**Remove Diagnosis Flow**:
1. User clicks ⊖ button next to diagnosis
2. Confirmation prompt appears
3. Frontend POSTs to `/api/ipad/patient-data/` with `action: 'remove_diagnosis'`, `code`, `description`
4. Backend creates Healthie chart note: `❌ **Diagnosis Removed**: E11.9 — Type 2 diabetes`
5. Backend UPDATEs `scribe_notes` to filter out removed code from JSONB array
6. Complete audit trail in both systems

**Package Display Architecture (NEW)**:

**Database Schema**:
- `healthie_packages` — Master list of all available packages (name, price, billing_frequency)
- `healthie_package_mapping` — Active patient enrollments (qb_customer_id, healthie_package_id, next_charge_date)

**Query Flow**:
1. Join `patients.qbo_customer_id` → `healthie_package_mapping.qb_customer_id`
2. JOIN `healthie_packages` on `healthie_package_id`
3. Filter `WHERE is_active = TRUE` on both tables
4. Display: package name, amount, frequency, next charge date

**Files Modified**:

| File | Lines Changed | Purpose |
|------|---------------|---------|
| `app/api/ipad/patient-data/route.ts` | 4, 198-398 | Added DB import, rewrote diagnosis add/remove with Healthie sync |
| `app/api/ipad/patient-chart/route.ts` | 251-279, 294-319, 452-454 | Removed invalid subscription query, added package query |
| `public/ipad/app.js` | 4390-4454, 7409 | Fixed trailing slash, render active packages, pass description to remove |

**API Endpoints Updated**:

- `POST /api/ipad/patient-data/` — Now properly handles `add_diagnosis`, `remove_diagnosis` with Healthie sync
- `GET /api/ipad/patient-chart/` — Returns `active_packages` array with full package details
- `GET /api/ipad/icd10-search?q=<query>` — Already existed, no changes

**Frontend Changes**:

Financial Tab now shows:
- 💳 **Payment Methods** — All credit cards on file (last 4, expiration, ZIP)
- 📦 **Active Packages** — Current subscriptions (name, amount, frequency, next charge date)
- 💸 **Recent Payments** — Last 4 payments
- 🆕 **Charge Patient Button** — Dual-Stripe billing (Healthie or Direct Stripe) with account selector

**Key Tables**:

```sql
-- Packages
healthie_packages (healthie_package_id, name, description, price, billing_frequency, is_active)
healthie_package_mapping (qb_customer_id, healthie_package_id, amount, frequency, next_charge_date, is_active)

-- Diagnoses
scribe_notes (note_id, patient_id, icd10_codes JSONB, created_at)
-- icd10_codes format: [{"code": "E11.9", "description": "Type 2 diabetes"}]

-- Patient linkage
patients (patient_id, qbo_customer_id, healthie_client_id)
healthie_clients (patient_id, healthie_client_id)
```

**Testing Performed**:
- ✅ Trailing slash issue identified and fixed
- ✅ DB import added
- ✅ Invalid Healthie queries removed (no more GraphQL errors in logs)
- ✅ Package query tested with QB customer ID
- ✅ Diagnosis add creates Healthie chart note
- ✅ Diagnosis remove creates removal note and updates local DB
- ✅ Build successful, deployed to production

**Known Issues**:
- `healthie_payments` table doesn't exist → last payments not displaying (non-critical, different from QB payments)
- TRT dispense query references `v.concentration` column that doesn't exist → dispense history empty (needs schema fix)
- Peptide dispense query references `pp.product_name` that doesn't exist → peptide history empty (needs schema fix)

> [!IMPORTANT]
> Diagnoses are now dual-stored: Healthie chart notes (for provider visibility in EMR) + local `scribe_notes` (for fast iPad display). This ensures complete audit trail in both systems.

> [!NOTE]
> Packages/subscriptions are NOT available via Healthie GraphQL API. We query from our own `healthie_package_mapping` table which maps QuickBooks recurring transactions to Healthie package definitions.

---

### March 12, 2026: 🔴 Server Stability Deep Fix — PM2 Mismatch, Crash Loop, Antigravity Anti-Hang

**Problem**: Server commands hanging, `uptime-monitor` crash-looping (398+ restarts), `system-health` API returning errors, CLI tools (psql, node scripts) hanging when connecting to RDS. User reported persistent hangs despite March 7 IPv6 fix.

**Root Cause Analysis** (5 issues found):

| Issue | Root Cause | Impact |
|-------|-----------|--------|
| **PM2 version mismatch** | In-memory PM2 (6.0.13) older than installed (6.0.14). `pm2 jlist` prepended a red warning to stdout. | `system-health` API parsed this as JSON → crash |
| **Uptime-monitor crash loop** | `uptime_monitor.py` calls `pm2 jlist` → got corrupted JSON → crashed → PM2 restarted it → infinite loop (398+ restarts) | Resource drain |
| **system-health route fragile** | Directly passed `pm2 jlist` output to `JSON.parse()` with no sanitization | Any PM2 warning = total API failure |
| **Missing CLI env vars** | `psql` and ad-hoc Node scripts lacked `PGHOST`, `PGPORT`, etc. → defaulted to `localhost:5432` | CLI DB commands hung |
| **NODE_OPTIONS duplication** | Exported multiple times in `~/.bashrc` from repeated shell sourcing | Minor, but cluttered env |

**Fix (5-part):**

| Fix | File | Change |
|-----|------|--------|
| PM2 updated | `pm2` in-memory | Ran `pm2 update` to sync in-memory (6.0.14) with installed version |
| system-health hardened | `app/api/analytics/system-health/route.ts` | Strip non-JSON prefix lines from `pm2 jlist` output before parsing; added 15s timeout |
| Env vars centralized | `~/.server_env` [NEW] | Single source for `NODE_OPTIONS`, `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSSLMODE`, `DATABASE_HOST/PORT/NAME/USER/SSLMODE`, curl/wget IPv4 aliases |
| `.bashrc` simplified | `~/.bashrc` | Replaced inline env vars with `source ~/.server_env` |
| Antigravity workflow | `~/.agents/workflows/server-commands.md` [NEW] | Enforces `source ~/.server_env && timeout <N> <cmd>` for all agent-run commands |

**Key Files Created:**

- **`~/.server_env`** — Central environment file sourced by `~/.bashrc` AND Antigravity workflows. Contains IPv4 enforcement for Node.js (`NODE_OPTIONS`), Python/curl/wget (`-4` flag), and PostgreSQL CLI vars.
- **`~/.agents/workflows/server-commands.md`** — Workflow that every Antigravity agent follows: source env, use timeout, prefer `view_file` over shell reads.

**Antigravity User Rule Added** (in Settings → Customizations):
```
CRITICAL SERVER RULE: This EC2 server has NO working IPv6. Any command that attempts IPv6 will hang forever.
1. ALWAYS source ~/.server_env before running any command
2. ALWAYS wrap commands with timeout
3. Follow the workflow at ~/.agents/workflows/server-commands.md
4. Prefer view_file over tail/cat for reading log files
5. Never run pm2 logs without --nostream flag
```

**Verification Results (from uptime-monitor logs at 11:26 MST):**

| Service | Status |
|---------|--------|
| GMH Dashboard | ✅ OK (restarts: 2 — from rebuild) |
| System Health API | ✅ OK |
| Webhook Health | ✅ 314 processed, 0 pending |
| upload-receiver | ✅ OK (restarts: 0) |
| telegram-ai-bot-v2 | ✅ OK (restarts: 0) |
| email-triage | ✅ OK (restarts: 0) |
| ghl-webhooks | ✅ OK (restarts: 0) |
| nowmenshealth-website | ✅ OK (restarts: 0) |
| QuickBooks token refresh | ✅ Working (DB queries succeeded) |
| Dashboard error log | ✅ Empty (cleared, no new PM2 errors) |

> [!IMPORTANT]
> The March 7 IPv6 fix IS working correctly. The hangs in this session were caused by PM2 version mismatch and missing CLI env vars, NOT IPv6 regression.

> [!TIP]
> If commands hang in Antigravity despite the workflow, the agent's terminal session may be corrupted from previous hung processes. The agent should use `view_file` for reading files and terminate stuck background commands.

---

### March 7, 2026: 🔴 IPv6 Root Cause Fix — Persistent Command Hanging


**Problem**: `node`, `npx`, `npm`, `psql`, and other outbound commands would hang for 30-120+ seconds or indefinitely. Previously misdiagnosed as a Node v20 race condition (Mar 2 fix). The Node upgrade helped that specific issue but the hanging persisted.

**Root Cause**: **Broken IPv6 connectivity.** IPv6 is enabled at the kernel level (`disable_ipv6 = 0`) but the EC2 instance has **no global IPv6 address** (only `fe80::` link-local) and **no IPv6 route**. DNS returns AAAA records (e.g., npm registry on Cloudflare). Tools try IPv6 first → connection hangs (kernel doesn't reject it, just waits) → eventually times out or hangs forever. Made worse by Node v22's `verbatim` DNS order (prefers IPv6 first).

**Fix (3-part):**

| Fix | File | Change |
|-----|------|--------|
| System-wide IPv4 preference | `/etc/gai.conf` [NEW] | `precedence ::ffff:0:0/96 100` — tells `getaddrinfo()` to sort IPv4 before IPv6 |
| Node.js defense-in-depth | `/home/ec2-user/ecosystem.config.js` | Added `NODE_OPTIONS: '--dns-result-order=ipv4first'` to all 7 Node.js services |
| Interactive shell fix | `~/.bashrc` | Added `export NODE_OPTIONS="--dns-result-order=ipv4first"` |

**Verification Results:**

| Test | Before | After |
|------|--------|-------|
| `node -e "console.log('OK')"` | Hang (30s+) | **0.01s** |
| `node HTTP fetch` | Hang (indefinite) | **0.03s** |
| `npm view express version` | Hang (30s+) | **0.15s** |
| `npx -y semver --version` | Hang (indefinite) | **0.15s** |

> [!CAUTION]
> **DO NOT enable global IPv6 on this VPC** unless you add a proper IPv6 CIDR block, update route tables, security groups, and assign a global IPv6 address to the instance. The current state (IPv6 kernel enabled, no connectivity) is the worst case — connections hang instead of being rejected.

> [!IMPORTANT]
> If the server is rebuilt or AMI-cloned, `/etc/gai.conf` must be recreated. The `ecosystem.config.js` and `.bashrc` changes will carry over with the home directory.

---

### March 5, 2026: 🔴 Critical Dispensing Data Integrity Fix

**Problem**: Morning testosterone counts off by 22mL. Transactions page showed "Total Volume" intermittently. Audit revealed **22 active vials with discrepancies** and **89 dispense records with NULL `total_amount`**.

**Root Causes (3 compounding issues):**

| # | Issue | Impact |
|---|-------|--------|
| 1 | **Silent scaling guard** (added Mar 4) | `inventoryQueries.ts` silently reduced `totalDispensedMl`/`wasteMl` when they exceeded vial remaining → records stored **less** than actually dispensed → vial showed **more** remaining than reality |
| 2 | **Split-vial bug** (Snyder incident Mar 3) | Inflated records (60mL from 30mL vial) created cascading discrepancies when deleted and re-entered |
| 3 | **NULL total_amount** | 89 dispense records had `total_amount = NULL`, causing intermittent display in Transactions table |

**Code Fixes:**

| Fix | File | Change |
|-----|------|--------|
| Silent guard → hard error | `lib/inventoryQueries.ts` L810-820 | Throws error instead of silently scaling. Forces split-vial flow. |
| Dose column display | `app/transactions/TransactionsTable.tsx` L141 | Shows `total_dispensed_ml` (actual dose) instead of `total_amount` |
| Split-vial budget cap | `app/inventory/TransactionForm.tsx` L399-408 | Already fixed Mar 4 — doseNext from remaining budget, not recalculated |

**Data Corrections (SQL):**

1. Backfilled 89 NULL `total_amount` records: `SET total_amount = dispensed + waste`
2. Recalculated ALL active vial `remaining_volume_ml` from actual dispense records
3. Marked depleted vials (remaining ≤ 0) as 'Empty'

> [!CAUTION]
> **NEVER silently modify dispense values in the backend.** If a dispense exceeds vial remaining, THROW AN ERROR — do not scale down. Silent modifications create inventory discrepancies that compound over time and are extremely hard to debug.

> [!IMPORTANT]  
> **Vial Integrity Rule**: `remaining_volume_ml` MUST always equal `size_ml - SUM(dispensed + waste)` for all dispenses against that vial. If these diverge, run the audit script: `bash /tmp/audit_vials.sh`

### March 5, 2026: System-Wide Arizona Timezone Fix

**Problem**: Dates displayed in UTC instead of Arizona time. Dispenses done late in the day (Mountain) could appear as the next day. All date formatters across the dashboard used `getUTCMonth()/getUTCDate()`.

**Fix**: Changed all date formatting to use `Intl.DateTimeFormat` with `timeZone: 'America/Phoenix'` (no DST, always UTC-7).

| File | Functions Fixed |
|------|----------------|
| `lib/dateUtils.ts` | `formatDateUTC`, `formatDateTimeUTC`, `formatDateLong` (shared utilities) |
| `app/transactions/TransactionsTable.tsx` | `formatDate` |
| `app/patients/PatientTable.tsx` | `formatDateInput`, `normalizeDateValue` |
| `app/components/QuickBooksCard.tsx` | `safeDateFormat` |

> [!CAUTION]
> **Date DISPLAY Rule**: ALL dates displayed to users MUST use `America/Phoenix` timezone via `Intl.DateTimeFormat`. The clinic is in Arizona — dates must match the wall clock.
> 
> For date-only strings (YYYY-MM-DD), parse as noon UTC (`${date}T12:00:00Z`) to avoid day-boundary shift.

> [!CAUTION]
> **Date STORAGE Rule (CRITICAL)**: When saving dates to the database (`normalizeDateValue`, any YYYY-MM-DD conversion for API calls), ALWAYS use UTC (`getUTCFullYear`, `getUTCMonth`, `getUTCDate`). **NEVER** use `America/Phoenix` for storage normalization — this causes dates to shift backward by 1 day per save (UTC midnight → PHX = previous day). This bug was introduced March 5 and fixed March 9.

### March 9, 2026: Date Save Shift Bug (CRITICAL FIX)

**Problem**: Every time a date field (DOB, lastLab, nextLab, serviceStartDate, contractEnd) was edited and saved, the date shifted backward by 1 day. Saving twice = 2-day shift.

**Root Cause**: The March 5 Arizona timezone fix incorrectly applied `America/Phoenix` to `normalizeDateValue()` in `PatientTable.tsx`. This function converts dates to YYYY-MM-DD for database storage. When a date stored as `2026-03-09` was parsed as UTC midnight and then formatted in Arizona time (UTC-7), it became `2026-03-08`.

**Fix**: Reverted `normalizeDateValue()` to use UTC date extraction for storage. Arizona timezone is now ONLY used in display functions (`formatDateInput`, `formatDisplayDate`).

### March 9, 2026: Morning Check Prefilled Dose Count Fix

**Problem**: Morning inventory check showed inflated partial volume (38mL instead of 7mL) because staged/prefilled doses had already been deducted from source vials.

**Fix**: `getSystemInventoryCounts()` now queries `staged_doses` table separately and reports `stagedDoseMl` as a distinct value. Morning check form subtracts staged dose volume from the partial pre-fill and shows prefilled doses as a separate purple info line.

---

### March 5, 2026: UPS Shipping Fixes & Enhancements

**1. Negotiated Rate Fix ($32 vs $7 Discrepancy)**
- **Problem**: Shipment creation showed $7.41 quoted rate but UPS charged $32.11. The `createShipment` request was not requesting the negotiated rate in the response.
- **Fix**: Added `ShipmentRatingOptions: { NegotiatedRatesIndicator: '' }` to the shipment request.
- **File**: `lib/ups.ts` L424-431

**2. Healthie Address Sync Fix (Location Mutations)**
- **Problem**: Address updates in the dashboard silently failed to sync to Healthie. `updateClient` mutation **ignores** the `location` field — Healthie requires dedicated `createLocation`/`updateLocation` mutations.
- **Root Cause #2**: `getClientLocations` used a standalone `locations(user_id:)` query that returned empty results. Healthie requires querying `user(id:) { locations { ... } }` instead.
- **Result**: Every save created a new "Primary" location without updating existing ones → duplicates piled up.

| Fix | File | Change |
|-----|------|--------|
| Location CRUD methods | `lib/healthie.ts` | Added `getClientLocations`, `createLocation`, `updateLocation`, `deleteLocation`, `upsertClientLocation` |
| Query fix | `lib/healthie.ts` | Changed from `locations(user_id:)` to `user(id:) { locations { ... } }` |
| Dedup logic | `lib/healthie.ts` `upsertClientLocation` | Updates first location, auto-deletes all duplicates |
| Use location mutations | `lib/healthieDemographics.ts` | Calls `upsertClientLocation()` instead of passing `location` to `updateClient()` |
| Skip inactive patients | `lib/healthieDemographics.ts` | Added `status_key` lookup; skips sync if `status_key = 'inactive'` |

> [!CAUTION]
> **Healthie API Gotcha**: The `updateClient` mutation silently ignores the `location` field. You MUST use `createLocation`/`updateLocation` mutations to manage patient addresses. The `locations` field must be queried via the `user` object, NOT via a standalone `locations` query.

**3. UPS SMS Tracking Notifications (via GHL)**
- **What**: When a shipping label is created → patient receives SMS with tracking # and UPS tracking link. When a shipment is voided → patient receives SMS cancellation notice.
- **Channel**: Sent via GHL `928-212-2112` number using `GHLClient.sendSms()`
- **Non-blocking**: SMS is fire-and-forget (async `.catch()`). Failures are logged but don't block shipment operations.

| File | Purpose |
|------|---------|
| `lib/upsNotifications.ts` [NEW] | `notifyShipmentCreated()`, `notifyShipmentVoided()` — looks up `ghl_contact_id` from `patients` table, routes through correct GHL location client |
| `app/api/ups/ship/route.ts` | Calls `notifyShipmentCreated()` after successful shipment |
| `app/api/ups/void/route.ts` | Calls `notifyShipmentVoided()` after successful void |

**4. Admin Shipments Dashboard Page**
- **Navigation**: Admin dropdown → Shipments (`/ops/admin/shipments`)
- **Features**: Stat cards (total, active, delivered, voided, total cost), search bar, status filter buttons, data table with expandable detail rows, clickable tracking links (UPS.com), print label, void actions.

| File | Purpose |
|------|---------|
| `app/admin/shipments/page.tsx` [NEW] | Server page with admin auth check |
| `app/admin/ShipmentsAdminClient.tsx` [NEW] | Client component with full dashboard UI |
| `app/api/admin/shipments/route.ts` [NEW] | API endpoint — JOINs `ups_shipments` with `patients`, aggregates stats |
| `app/layout.tsx` | Added `{ label: 'Shipments', href: '/admin/shipments' }` to `adminItems` |

**5. Healthie `requestFormCompletion` Method**
- Added `requestFormCompletion(userId, formId)` to `HealthieClient` class for assigning forms to patients.
- **File**: `lib/healthie.ts`

---

### March 4, 2026: RDS Connectivity Fix (psycopg2-binary 2.9.11 → 2.9.10)

**Problem**: All Python scripts using psycopg2 could not connect to RDS. Connections hung indefinitely during TLS handshake. `psql`, `openssl s_client`, and pg8000 (pure Python) all worked fine.

**Root Cause**: psycopg2-binary **2.9.11** bundles its own `libssl-81ffa89e.so.3` which is **incompatible** with this RDS instance's TLS configuration (PostgreSQL 17.6 on aarch64). The bundled libssl hangs during the TLS handshake after the server agrees to SSL.

**Fix**: Downgraded to psycopg2-binary **2.9.10** which bundles a compatible libssl.

> [!CAUTION]
> **DO NOT upgrade psycopg2-binary to 2.9.11** — it will break ALL Python DB connections. Pin to `psycopg2-binary==2.9.10`. Also installed `pg8000` as a backup pure-Python driver.

### March 4, 2026: Lab Patient Matching — 3-Tier Pipeline

**Problem**: All 14 pending labs had **0% match confidence** (no Healthie ID linked). Patient matching depended entirely on Snowflake via `ScribeOrchestrator.get_patient_candidate_list()`. When Snowflake is unavailable, matching silently returns 0%.

**Fix**: Replaced single-tier Snowflake matching in `fetch_results.py` with 3-tier strategy:

| Tier | Source | Speed | Reliability |
|------|--------|-------|-------------|
| 1 | **Postgres `patients` table** | Fast (local) | Always available |
| 2 | **Healthie API direct search** | Medium (HTTP) | High |
| 3 | **Snowflake `PATIENT_360_VIEW`** | Slow | Fragile |

**Also added**:
- **Name normalization**: `BADILLA` → `Badilla`, `DOE, JOHN` → `John Doe`
- **DOB normalization**: Handles `MM/DD/YYYY`, `YYYY-MM-DD`, etc.
- **Zero-results alerting**: Telegram alert if no new labs for 48+ hours (state file: `/home/ec2-user/data/last-lab-results-seen.json`)

### March 4, 2026: Split-Vial Dispense Bug Fix (+20mL Inflation)

**Problem**: When dispensing across two vials (split-vial handler), the second dispense recorded wildly inflated quantities. Example: Snyder on 03/03 — V0339 recorded 60 mL dispensed from a 30 mL vial (12 syringes × 5.0 mL).

**Root Cause**: `handleSplitAcrossVials()` in `TransactionForm.tsx` had a fallback path (L402) that recalculated `doseNext = nextSyringes × doseValue` from scratch instead of using the remaining removal budget. The `nextSyringes` fallback (`fallbackSyringes`) could produce syringe counts equal to or larger than the original total.

| Fix | File | Change |
|-----|------|--------|
| Cap doseNext to budget | `app/inventory/TransactionForm.tsx` L399-408 | Derive doseNext from `remainingRemoval - wasteBase` instead of `nextSyringes * doseValue` |
| Cap nextSyringes | `app/inventory/TransactionForm.tsx` L401 | `Math.min(fallbackSyringes, totalSyringes - predictedCurrentSyringes)` |
| Backend guard | `lib/inventoryQueries.ts` L810-820 | If `totalDispensedMl + wasteMl > currentRemaining`, scale both down proportionally |

> [!IMPORTANT]
> Snyder's two incorrect dispense records from 03/03 need to be deleted and re-entered manually.

---

### March 2, 2026: Three Bug Fixes (Billing, DOB, Lab Approval)

**1. Billing Info Not Saving (iPhone App)**
- **Root Cause**: Lambda `index.js` had **duplicate billing action handlers** (lines 299-327 and 494-522). The first `add_payment_method` handler returned `{ paymentMethod }` without `success: true`. `AddCardScreen.tsx` checks `response.success`, so the card was actually saved to Healthie but the app always reported failure.
- **Fix**: Removed duplicate handlers. Added `success: true` to the first `add_payment_method` response.
- **File**: `backend/lambda-booking/src/index.js`
- **Status**: Code fixed — requires Lambda redeployment

**2. Date of Birth Incorrect (iPhone App)**
- **Root Cause**: `safeParseDate` in `dateUtils.ts` parsed date-only strings (`"1990-05-15"`) using `new Date("1990-05-15T12:00:00")`. On iOS this is interpreted as UTC; on Android as local time. This cross-platform inconsistency shifts the displayed DOB by ±1 day.
- **Fix**: Changed to use `Date` component constructor `new Date(year, month-1, day, 12, 0, 0)` which is consistently local time on all platforms.
- **File**: `mobile-app/src/utils/dateUtils.ts`
- **Status**: Code fixed — requires app rebuild
- **CRITICAL LEARNING**: Never use `new Date(isoString)` without timezone for date-only values in React Native. Always use `new Date(y, m-1, d, 12)`.

**3. Cannot Approve Restricted Lab Orders**
- **Root Cause**: `app/api/labs/order/[id]/approve/route.ts` called `requireApiUser(req, 'admin')` — only the highest role could approve. Users with `write` role were getting 401 Unauthorized.
- **Fix**: Changed to `requireApiUser(req, 'write')` so any write-level user can approve restricted labs.
- **File**: `app/api/labs/order/[id]/approve/route.ts`
- **Status**: ✅ Deployed (PM2 restart completed)

**4. Node.js v20.20.0 Hang Fix (PARTIALLY CORRECT — see March 7 IPv6 fix)**
- **Root Cause**: Node v20.20.0 (NodeSource RPM) had a **race condition** causing all Node processes to hang on startup. Proven by running under `strace` which added enough timing delay for Node to work.
- **Fix**: Installed `nvm` (v0.40.1) and upgraded to **Node v22.22.0** (latest LTS). Reinstalled PM2 globally under new Node.
- **NOTE (Mar 7 2026)**: This fix resolved the Node v20 race condition but the hanging persisted. The **true root cause** was broken IPv6 connectivity (see March 7, 2026 entry). Node v22's `verbatim` DNS order actually made IPv6 hangs MORE frequent.
- **Status**: ✅ Node upgrade deployed; IPv6 fix applied March 7, 2026

### February 26, 2026: Lab Review Queue Migration (JSON → PostgreSQL)

**Problem**: The lab review queue was stored in a ~27MB JSON file (`data/labs-review-queue.json`). Every read loaded the entire file and every write rewrote it — slow and not scalable.

**Migration**: Created `lab_review_queue` PostgreSQL table with 31 columns matching the `LabQueueItem` interface, plus indexes on `status` and `created_at`.

| File | Action | Purpose |
|------|--------|---------|
| `migrations/20260226_lab_review_queue.sql` | NEW | Table schema + indexes |
| `scripts/import-lab-review-queue.py` | NEW | One-time Python import (73 records) |
| `app/api/labs/review-queue/route.ts` | MODIFIED | GET/POST now use `query()` from `lib/db.ts` |

**Key changes in `route.ts`**:
- Removed `loadQueue()` / `saveQueue()` + `LABS_QUEUE_FILE` constant
- Added `loadQueueItem(id)` — `SELECT ... WHERE id = $1`
- Added `updateQueueItem(id, updates)` — dynamic parameterized `UPDATE`
- GET handler: `SELECT * FROM lab_review_queue WHERE status = $1 ORDER BY created_at DESC LIMIT $2`
- All Healthie upload, S3 download, visibility, and lab-date-update logic unchanged

**Import Results**: 73/73 records (55 approved, 16 pending_review, 2 rejected), 0 errors.

> [!NOTE]
> The JSON file `data/labs-review-queue.json` is kept as a backup. As of March 4, 2026: `fetch_results.py` now syncs new items to PostgreSQL via `_sync_to_db()`. Both `page.tsx` and `app/api/labs/pdf/[id]/route.ts` read from PostgreSQL. The review-queue API (`route.ts` GET/POST) reads from PostgreSQL.

### March 4-5, 2026: Lab Fetch Resilience & Data Source Fix

**Problem 1 — "Item not found" on approval**: After the Feb 26 migration, `page.tsx` and `labs/pdf/[id]/route.ts` still read from the JSON file, while the approval API reads from PostgreSQL. Items created after migration existed only in JSON → API returned 404.

**Fix**: Changed `page.tsx` and `labs/pdf/[id]/route.ts` to read from PostgreSQL. Added `_sync_to_db()` to `fetch_results.py`'s `save_queue()` so new items go to both JSON and DB. Synced 6 missing records.

**Problem 2 — Missing results (Jessica Porter)**: The `fetchInbox` → `flagBatchAsRemoved` cycle is destructive. Once a batch is flagged, late-arriving results in that batch are permanently lost. Porter's results (completed 02/28) were never returned by the API.

**Resilience fix in `fetch_results.py`**:

| Change | Purpose |
|--------|---------|
| `_record_processed_accessions()` | Records every accession from the API to `lab_processed_accessions` table for audit trail |
| `_flag_previous_batch()` | Flags the **previous** run's batch, not the current one (delayed flagging) |
| `_save_batch_info()` | Saves current batch info to `.last_batch_info.json` for next run |
| `lab_processed_accessions` table | Audit trail of all accessions ever seen (80 backfilled from existing queue) |

**How delayed flagging works**: Each run flags the batch from the *previous* run (stored in `.last_batch_info.json`), then processes current results and saves batch info for the next run. This gives late-arriving results a 30-minute window to be picked up before their batch is flagged.

> [!IMPORTANT]
> The existing dedup logic (skip accessions already in queue) prevents double-processing. The delayed flagging is purely additive — no existing flow was changed.

### February 26, 2026: SQL Injection Fix in DEA MCP Server

**Vulnerability**: `lib/mcp/dea-server.ts` `get_recent_dispenses` tool used string interpolation for `INTERVAL '${days} days'` — a SQL injection vector in the DEA compliance module.

**Fix**: Replaced with parameterized `($1 || ' days')::INTERVAL` + params array. All other 4 tools in the file already used parameterized queries.

**Verified**: PostgreSQL correctly blocks injection attempts with `invalid input syntax for type interval` error at the type cast level.

### February 26, 2026: Apple AI Privacy Fix, Journal/Metrics Bug Fixes

**Apple App Store Rejection Fix (Guidelines 5.1.1(i) & 5.1.2(i))**:
- Added first-time AI consent dialog to `JarvisScreen.tsx` — discloses what data is sent to Google Gemini AI, requires explicit "I Agree" before Jarvis is usable
- Consent stored in `expo-secure-store` (one-time prompt)
- Updated `nowoptimal-website/app/privacy/page.tsx` Section 3: removed contradictory "not shared with external AI providers" wording, replaced with accurate Gemini disclosure
- Added Google (Gemini AI) to BAA list in Section 4
- Website rebuilt and redeployed via PM2

**Journal & Metrics Display Bug Fixes** (`JournalScreen.tsx`, `MetricsScreen.tsx`):
- Fixed "Invalid Date" — `safeParseDate()` handles Healthie date-only strings (`"2025-12-26"`) that iOS chokes on
- Fixed Blood Pressure: `13686` → `136/86 mmHg` (smart split based on digit count)
- Fixed Weight: `56` → `56 lbs (25.4 kg)` (dual units)
- Fixed Height: `5` → `5'0" (152.4 cm)` (detects feet vs inches, shows both)
- Fixed Sleep: `8.5` → `8.5 hours` (unit label added)
- Added smart `formatMetricValue()` dispatcher for all metric categories
- MetricsScreen cards now show secondary unit line (e.g., `86.2 kg` under Weight card)

### February 25, 2026: Peptide System Overhaul, Revenue Fix, Transaction Delete Fix

**Peptide Soft-Delete** (`lib/peptideQueries.ts`, `app/peptides/PeptideTable.tsx`):
- Added `active` boolean column to `peptide_products` table
- Replaced hard delete with toggle (deactivate/reactivate)
- Inactive peptides shown with reduced opacity and "Show Inactive" filter

**Healthie Patient Search for Peptide Dispenses** (`app/peptides/DispenseForm.tsx`):
- Replaced plain text patient name field with debounced Healthie patient search (same API as labs: `/ops/api/patients/search`)
- Auto-fills patient name and DOB on selection; DOB stored in new `patient_dob` column on `peptide_dispenses`
- DOB passed to label generation for accurate prescription labels

**Label Date Formatting** (`lib/pdf/labelGenerator.ts`):
- Added `formatDateMMDDYYYY()` helper — normalizes all dates (ISO, slash, dash) to MM-DD-YYYY
- Applied to `patientDob`, `dateDispensed`, and `expDate` on all labels

> [!IMPORTANT]
> **Critical Schema Gotcha — `patients` table column names**:
> - The raw `patients` table uses `dob` (DATE type) and `full_name` — NOT `date_of_birth` or `patient_name`
> - `date_of_birth` only exists on the VIEW `patient_data_entry_v` 
> - When JOINing to `patients`, always use `pt.dob` and `pt.full_name`
> - When using `dob` in COALESCE with a TEXT column, cast it: `pt.dob::text`
> - `sale_date` on `peptide_dispenses` is a plain DATE — do NOT apply `AT TIME ZONE` to it

**Revenue "Today" Card Fix** (`lib/peptideQueries.ts` → `fetchPeptideFinancials()`):
- Root cause: `CURRENT_DATE` is UTC; clinic is in MST (UTC-7). Afternoon dispenses showed as "tomorrow"
- Fix: Use `(NOW() AT TIME ZONE 'America/Phoenix')::date` for date boundaries
- `sale_date` is a DATE column — only apply timezone to `NOW()` and `created_at`, never to `sale_date` itself

**Transaction Delete Fix** (`lib/inventoryQueries.ts` → `deleteDispense()`):
- Root cause: `dispense_history` table has NOT NULL FK to `dispenses` with ON DELETE SET NULL → constraint violation
- Fix: Added `DELETE FROM dispense_history WHERE dispense_id = $1` before deleting the dispense

**Revenue Section Rename** (`app/analytics/components/PeptideFinancials.tsx`, `app/analytics/AnalyticsClient.tsx`):
- Renamed "Peptide Financials" → "Revenue" (💰)
- Moved from Overview tab to Revenue tab on CEO Dashboard

### February 24-25, 2026: DEA Improvements, Label Printing, Vial Deletion Bug Fix & Cleanup

> [!WARNING]
> **Gemini Flash Incident**: On Feb 24, Gemini Flash made changes without consulting or updating the SOT. It reverted the `TransactionsTable` column fix (#3 from Feb 18), dumped 18 debug scripts in the project root, and made direct database modifications without documentation. All issues were remediated on Feb 25.

**DEA Page Enhancements** (`app/dea/page.tsx`, `lib/deaQueries.ts`):
- Date range filtering (start/end date inputs) for DEA log
- Default limit increased from 200→500 dispenses
- `ChecksManager` component added for controlled substance check history
- CSV export now supports date-filtered downloads
- Date formatting switched to `formatDateUTC()`

**Label Printing** (`lib/pdf/labelGenerator.ts` [NEW], `lib/healthieUploadLabel.ts` [NEW]):
- PDF label generation for testosterone dispensing
- Print Label button added to Transactions table (per-row action)
- Upload label to Healthie patient chart support

**`deleteDispense()` Hardening** (`lib/inventoryQueries.ts`):
- Audit trail: records deletion event via `recordDispenseEvent()` BEFORE removing the dispense
- Overfill cap: restored volume capped at `LEAST(size_ml, ...)` to prevent vials exceeding max capacity
- Auto-reactivate: vials with 0 mL restored to 'Active' when volume is added back
- `staged_doses` FK: nullifies `dispense_dea_tx_id` and `vial_id` references before cascade delete

**Vial Deletion Bug (Phil Schafer)**: Investigation found that deleting transactions for Phil Schafer didn't correctly restore vial inventory. Gemini Flash manually restored 9.6 mL to V0367 and marked V0368 as 'Completed'. Also changed `dispense_history_dispense_id_fkey` from CASCADE to SET NULL so history survives dispense deletion.

**Cleanup (Feb 25)**: 18 debug scripts moved from project root to `.tmp/gemini-flash-feb24-debug/`. `TransactionsTable` "Total Volume" column reverted to `total_amount` (per Feb 18 Fix #3). `CLAUDE.md` and `GEMINI.md` updated with mandatory SOT review protocol.

---

### February 23, 2026: Monitoring Alert Cycling Fix & Cron Schedule Correction

**Problem 1 — Webhook Alert/Recovery Cycling**: The uptime monitor checked webhook health every 60s, but the webhook processor runs every 5 min. Between processing cycles, pending webhooks naturally queued up (>10), triggering WARNING → then processing cleared them → RECOVERY. This cycled 24/7 with misleading "Payment failure alerts may not be working!" text.

**Problem 2 — No Morning Report**: Cron schedule comments said "7am MST (2pm UTC)" and "8am MST (3pm UTC)" but the server's cron daemon runs in **MST** (not UTC). So `0 14 * * *` = **2pm MST** and `0 15 * * *` = **3pm MST**. Neither report ever ran in the morning.

| Fix | File | Change |
|-----|------|--------|
| Webhook threshold raised | `app/api/analytics/system-health/route.ts` L562 | `pending > 10` → `pending > 50` |
| 10-min grace period | `scripts/uptime_monitor.py` L27, L191-240 | Only alerts after 10 min of continuous degradation |
| Payment warning text | `scripts/uptime_monitor.py` L221 | "Payment alerts may not be working" only on actual `error` status |
| Recovery suppression | `scripts/uptime_monitor.py` L236 | No recovery message if alert was never sent (cleared during grace) |
| Morning Report cron | crontab | `0 14 * * *` → `0 8 * * *` (8:00 AM MST) |
| Infrastructure Monitor cron | crontab | `0 15 * * *` → `30 8 * * *` (8:30 AM MST) |

> [!IMPORTANT]
> **Cron runs in MST** on this server (`/etc/localtime` → `America/Phoenix`). Always use MST hours in cron expressions. Comments must say MST, not UTC.

---

### February 19, 2026: Supply PAR System (Multi-Location)

**New system** for tracking general clinic supplies with Periodic Automatic Replenishment (PAR) level alerts. **Completely separate from DEA controlled substance inventory** (`app/inventory/`).

> [!CAUTION]
> The Supply PAR system (`app/supplies/`, `supply_*` tables) is **NOT** for controlled substances. DEA-regulated vials use `app/inventory/`, `vials` table, and `app/dea/`. Never mix these systems.

**Locations**:
| Location ID | Name | Address | Seeded Data |
|-------------|------|---------|-------------|
| `primary_care` | NowPrimary.Care | 404 S. Montezuma, Prescott, AZ 86303 | 132 items from Jan 16 2026 inventory |
| `mens_health` | NowMensHealth.Care | 215 N. McCormick, Prescott, AZ 86301 | Empty (no data yet) |

**Database Tables**:
| Table | Purpose |
|-------|---------|
| `supply_locations` | Clinic locations (id, name, address) |
| `supply_items` | Master catalog (132 items, 10 categories) |
| `supply_counts` | Current qty per item+location (UNIQUE constraint) |
| `supply_count_history` | Audit trail — every count, usage, adjustment with optional Healthie patient association |

**Key Files**:
| File | Purpose |
|------|---------|
| `lib/supplyQueries.ts` | All queries: CRUD, bulk counts, patient-linked usage, history |
| `app/supplies/page.tsx` | Main dashboard (server component) |
| `app/supplies/SupplyTable.tsx` | Interactive table with location selector, Use/Count modals |
| `app/api/supplies/route.ts` | GET (list/filter by location) + POST (create item) |
| `app/api/supplies/[id]/route.ts` | PATCH (update PAR level, name, etc.) |
| `app/api/supplies/count/route.ts` | POST (bulk inventory count) |
| `app/api/supplies/use/route.ts` | POST (use supplies, link to Healthie patient visit) |
| `app/api/supplies/history/route.ts` | GET (audit trail) |
| `scripts/seed-supply-inventory.ts` | Seeds 132 items from Google Doc (NowPrimary.Care) |
| `migrations/20260219_supply_par.sql` | Schema migration |

**Features**: Location selector tabs, PAR level alerts (🟢 OK / 🟡 Low / 🔴 Reorder / ✕ Out), category filter pills (10 categories), Use Supplies modal with Healthie patient association, Record Count modal for bulk inventory counts, full audit trail.

**Navigation**: Under **Clinical ▼** → Supplies (along with Patients, Labs, Faxes, Peptides)

**Categories** (10): Blood Glucose, Cleaning/Office, IV Supplies, Kits, Meds/Supplements, Miscellaneous, Monofilament, Pelleting Supplies, Syringes/Needles, Tests

---

### February 23, 2026: Scribe System — Dual Upload, Patient Search & Name Fix

**Root Cause**: When provider clicked "Confirm & Send" during active scribe lock, Python scribe uploaded to Healthie AND TS bot processed the same callback after lock was released — creating **duplicate chart notes**. Additionally, `updateFormAnswerGroup` mutation included invalid `filler_id` field, causing resubmit failures.

| Bug | File | Fix |
|-----|------|-----|
| Dual upload race condition | `telegram-ai-bot-v2.ts` L3009 | Skip `confirm_send` if session already `SUBMITTED` |
| Duplicate upload safety net | `telegram-ai-bot-v2.ts` L3122 | 30-second timestamp protection on `confirm_final_send` |
| `filler_id` schema error | `telegram-ai-bot-v2.ts` L3207 | Removed invalid field from `updateFormAnswerGroup` |
| Chart note update fallback | `telegram-ai-bot-v2.ts` L3256 | Falls back to create if update fails (e.g. deleted in Healthie) |
| Duplicate patient search | `telegram_approver.py` L466 | `PATIENT_360_VIEW` filtered to `STATUS = 'ACTIVE'` + `ROW_NUMBER()` dedup |
| Wrong name in SOAP after change | `telegram_approver.py` L694, L1027 | Auto-replace old patient name in SOAP note when patient is changed |

> **Key Learning**: The Python scribe (`telegram_approver.py` + `scribe_orchestrator.py`) and TS bot (`telegram-ai-bot-v2.ts`) both handle callbacks. When scribe lock is released mid-callback, TS bot re-processes the same action. Always check session status before acting.

### February 19, 2026: Home Directory Reorganization

**Moved 220+ loose files from root home directory into organized structure.** Nothing deleted — all preserved in `archive/`.

| Category | Destination |
|---|---|
| 72 documentation files | `docs/` (architecture, integrations, audits, plans, setup, incidents) |
| 72 loose scripts (.js/.py/.ts/.sh) | `archive/loose-scripts/` |
| 12 log files | `archive/loose-logs/` |
| 18 data exports | `archive/loose-data/` |
| Build artifacts, stale configs | `archive/build-artifacts/`, `archive/configs/` |
| Stale dashboard copies (gmhdashboard-1, apps/gmh-dashboard) | `archive/` |
| Root app/, lib/, components/ dirs | `archive/` |

**New directory structure**:
- `docs/` — All documentation organized by topic + `SOURCE_OF_TRUTH.md` symlink
- `directives/` — 3-layer architecture SOPs
- `execution/` — 3-layer architecture Python scripts
- `archive/` — Everything old (recoverable)

**3-Layer Architecture** added per `AGENTS.md`:
- Directives (SOPs) in `directives/`
- Execution scripts in `execution/`
- AI orchestrates between them

---

### February 17, 2026: Recurring Payment Hold Loop Fix

**Problem**: Patients who had already paid were being repeatedly put on "Hold - Payment Research" then reactivated, creating a hold-reactivate-hold loop.
