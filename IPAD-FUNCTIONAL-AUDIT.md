# iPad App Full Functional Audit — March 15, 2026

## Audit Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 BROKEN | 3 | Features that don't work at all |
| 🟠 MAJOR | 4 | Features that work partially or return empty data |
| 🟡 MISSING | 3 | Features that should exist but don't |
| ⚪ STUB | 2 | Functions with TODO placeholders |

---

## 🔴 BROKEN ISSUES

### B1 — Packages Not Showing for Patients
**Symptom:** "Active Packages" section in Financial tab always says "No active packages" even for patients who have Healthie packages.

**Root Cause:** The `patient-chart` API route (line 378-403) only queries packages when `patient?.qbo_customer_id` exists. It looks up packages via the local `healthie_package_mapping` table joined through the QuickBooks customer ID. Most patients don't have a `qbo_customer_id`, AND the `healthie_package_mapping` table is only populated through an admin sync flow — not from Healthie subscriptions directly.

**The Fix:** The Healthie lib already has `getClientSubscriptions(clientId)` (lib/healthie.ts line 1258) that fetches `recurring_payments` from Healthie's API. The patient-chart route needs to call this function to get real subscription data directly from Healthie, instead of (or in addition to) the local table lookup.

**Changes needed:**
1. In `app/api/ipad/patient-chart/route.ts`, add a new parallel Healthie query for subscriptions:
```typescript
// Add to the Promise.all array (after paymentMethods query, before the closing ]):
safeHealthieQuery<any>('subscriptions', `
    query GetSubscriptions($id: ID) {
        user(id: $id) {
            recurring_payments {
                id
                is_canceled
                is_paused
                amount_to_pay
                next_payment_date
                offering_name
                billing_frequency
                start_at
            }
        }
    }
`, { id: healthieId }),
```
2. Map the results into `active_packages` format in the response, merging with any local package data
3. Filter to only non-canceled, non-paused subscriptions

**Files:** `app/api/ipad/patient-chart/route.ts`

---

### B2 — Cannot Assign Healthie Packages to Patients
**Symptom:** There's no UI to assign a Healthie package/offering to a patient from the iPad app.

**Root Cause:** The Financial tab has "Charge Patient" and "Send Invoice" buttons, but no "Assign Package" button. The Healthie lib already has `assignPackageToClient()` (lib/healthie.ts line 1215) and `getPackages()` (line 1163), but there's no API route or frontend UI wired up for package assignment.

**The Fix:** Create a new API route and add a frontend UI:
1. New API route: `app/api/ipad/billing/assign-package/route.ts`
   - GET: List available packages (calls `healthieClient.getPackages()`)
   - POST: Assign package to patient (calls `healthieClient.assignPackageToClient()`)
2. Frontend: Add an "Assign Package" button to the Financial tab that opens a modal with package selection

**Files:** New `app/api/ipad/billing/assign-package/route.ts`, `public/ipad/app.js`

---

### B3 — Recent Payments Always Empty
**Symptom:** "Recent Payments" section in Financial tab always shows "No payment history."

**Root Cause:** In `patient-chart` route lines 406-426, the entire `lastPayments` query is commented out with a TODO: "Re-enable when healthie_payments table is created and populated." The `lastPayments` array is always `[]`.

**The Fix:** Either:
- **Option A (fast):** Use Healthie's billing items API to fetch recent charges. The lib has `getBillingItems(clientId)` (line 1558) which returns recent billing activity.
- **Option B (proper):** Also query Stripe's charge history for the patient's `stripe_customer_id`

**Files:** `app/api/ipad/patient-chart/route.ts`

---

## 🟠 MAJOR ISSUES

### M1 — Allergy Form Location/Scroll Issue
**Symptom:** User reports "I can't put in allergies." The allergy form code, API route, and Healthie mutation all appear correct. The form should work.

**Most Likely Cause:** When the ＋ button is pressed, `showPatientDataForm('allergy')` inserts the form after the `allergies-section` div (line 4689-4693). But the allergies section is in the chart header (above the tab bar), while the form insertion logic references `chartTabContent` as a fallback container (line 4559). If the DOM structure doesn't match expectations (e.g., after a reload or if the panel was opened via a different path), the form might:
1. Fail to find `allergies-section` → fall back to inserting at top of `chartTabContent` (wrong location, might be hidden)
2. Insert correctly but the scroll doesn't work → user can't see the form appeared
3. The form appears but has no `healthie_id` → shows "No Healthie ID — cannot add data for unmapped patients" toast

**Debug Steps:**
1. Check browser console when clicking ＋ next to Allergies — look for errors
2. Check if the patient has a valid `healthie_id` (check `chartPanelData.healthie_id` in console)
3. If form appears but submission fails, check the Network tab for the POST to `/ops/api/ipad/patient-data/`

**Potential Fix:** Add more robust form insertion that also tries the `globalChartContent` parent container, and ensure the form scrolls into view properly. Also add better error logging.

**Files:** `public/ipad/app.js` (showPatientDataForm function ~line 4552)

---

### M2 — Vitals Save to Local DB Only, Not Healthie
**Symptom:** The "Record Vitals" modal (`openVitalsModal`) saves to `/ops/api/ipad/patient/${id}/metrics/` which stores in the local `patient_metrics` table. But the allergy/medication ＋ buttons in the chart header use `/ops/api/ipad/patient-data/` which saves to Healthie via GraphQL.

**Impact:** Vitals recorded via the modal only appear in the chart panel because `patient-chart` route merges local vitals with Healthie vitals. But they never sync TO Healthie. Vitals recorded via the inline ＋ button DO go to Healthie (via `add_vital` action in patient-data route).

**The Fix:** The `submitAllVitals` function (line 7326) should ALSO push each vital to Healthie. Either:
- After saving to local metrics, also call `/ops/api/ipad/patient-data/` with `action: 'add_vital'`
- Or modify the metrics route to also write to Healthie

**Files:** `public/ipad/app.js` (submitAllVitals function ~line 7326), possibly `app/api/ipad/patient/[id]/metrics/route.ts`

---

### M3 — Demographics Edit Saves to Local DB Only
**Symptom:** The Edit Demographics form (`showEditDemographicsForm`) saves via `/ops/api/ipad/patient/${id}/demographics/` which updates the local `patients` table. But it doesn't update the patient profile in Healthie.

**Impact:** Edited phone numbers, addresses, etc. only exist locally and drift from Healthie's canonical data.

**The Fix:** The demographics save route should also update Healthie via `healthieClient.updateClient()` which already exists (lib/healthie.ts line 846).

**Files:** `app/api/ipad/patient/[id]/demographics/route.ts`

---

### M4 — Patient-Chart API Makes 9+ Parallel Healthie Queries
**Symptom:** Loading a patient chart is slow (15-45 seconds on first load). Each Healthie query has a 15-second timeout.

**Root Cause:** The patient-chart route makes 8 parallel Healthie GraphQL queries + multiple local DB queries. If Healthie rate-limits or is slow, the whole load stalls.

**The Fix:** Consider:
- Batch some Healthie queries into a single request (allergies + medications + profile can be one query)
- Add client-side caching so re-opening a chart doesn't re-fetch everything
- Show progressive loading (demographics first, then fill in as data arrives)

**Files:** `app/api/ipad/patient-chart/route.ts`, `public/ipad/app.js`

---

## 🟡 MISSING FEATURES

### F1 — No "Assign Package" UI
Already covered in B2 above. The lib has the function, but no UI or API route connects it.

### F2 — No Insurance Information Display
**Location:** Demographics section + patient-chart route
**Issue:** The Healthie user query fetches basic demographics but NOT insurance info. The route has a TODO on line 512: "Insurance — TODO: Use insurance_authorization field in future."

**The Fix:** Add `insurance_authorizations` to the user profile Healthie query, and display in the demographics section.

### F3 — No Lab Ordering from iPad
**Issue:** The Documents tab shows existing labs, but there's no way to ORDER a lab from the iPad app. The backend has `app/api/labs/orders/route.ts` and `app/api/labs/order/[id]/approve/route.ts`, but the iPad frontend doesn't have a lab ordering UI.

**Note:** This might be intentional — lab ordering may be reserved for the desktop dashboard. Just flagging it.

---

## ⚪ STUBS / PLACEHOLDERS

### S1 — Send Invoice (line 8516-8533)
`sendInvoice()` shows "Invoice feature coming soon" and redirects to Healthie dashboard. The lib has `createInvoice()` (line 1326) but it's not wired up.

### S2 — Recent Payments Data (patient-chart-route.ts line 406-426)
Entire payments query is commented out. Always returns empty array.

---

## WHAT'S WORKING WELL ✅

- **Login/Auth** — Session management with 12-hour TTL, silent refresh, proper cookie handling
- **Patient Search** — Both local DB search and Healthie patient picker work
- **Scribe/SOAP Notes** — Audio recording, transcription, AI-generated SOAP notes, PDF preview, submit to Healthie
- **AI Edit Bar** — The inline AI edit for SOAP notes posts to the correct endpoint
- **E-Rx / DoseSpot** — Iframe loading with reload/fullscreen controls, proper error handling
- **Prescription Tab** — Active Rx display with controlled substance indicators, color-coded schedule badges
- **Inventory System** — DEA controlled, peptides, and supplies tabs all have working CRUD
- **Payment Methods** — Displays both Healthie Stripe + Direct Stripe cards correctly
- **Charge Patient** — Dual Stripe account selection (Healthie vs Direct) works
- **Dispense History** — TRT dispenses and peptide dispenses display correctly
- **Vitals Modal** — Well-designed multi-field vitals entry with auto-BMI calculation
- **Demographics Edit** — Full edit form with address, gender, pronouns, insurance fields
- **Documents Tab** — Healthie documents accessible via click-to-open
- **Forms Tab** — Patient intake forms displayed with expandable details
- **ICD-10 Search** — Diagnosis search with API-backed ICD-10 code lookup

---

## FIX PRIORITY ORDER

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| 1 | B1 — Fetch Healthie subscriptions for packages | Medium | HIGH — Financial tab is broken for all patients |
| 2 | B3 — Fetch billing items for payment history | Medium | HIGH — Payment history never shows data |
| 3 | M1 — Debug/fix allergy form insertion | Low | HIGH — User specifically reported this |
| 4 | B2 — Build "Assign Package" UI | High | HIGH — Critical workflow missing |
| 5 | M2 — Sync vitals modal to Healthie | Low | MEDIUM — Data only stored locally |
| 6 | M3 — Sync demographics edits to Healthie | Low | MEDIUM — Local-only updates drift |
| 7 | S1 — Wire up invoice creation | Medium | LOW — Workaround exists (Healthie dashboard) |
| 8 | F2 — Add insurance display | Low | LOW — Nice to have |
