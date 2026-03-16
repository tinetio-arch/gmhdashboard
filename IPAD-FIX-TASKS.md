# iPad Fix Tasks — Claude Code Commands

Run these in order. Each is a single `claude -p` command.

---

## Task 1: Fetch Healthie Subscriptions + Payment History (B1 + B3)

This fixes the Financial tab so packages and payment history actually show data.

```bash
claude -p "Fix the Financial tab in the iPad app so it shows real data. Two problems:

PROBLEM 1 — Active Packages always empty:
In app/api/ipad/patient-chart/route.ts, the active_packages field (line ~378-403) only queries the local healthie_package_mapping table via qbo_customer_id. Most patients don't have a qbo_customer_id, so packages are always empty.

FIX: Add a Healthie GraphQL query to the existing Promise.all array (around line 126-299) that fetches the patient's recurring_payments (subscriptions) directly from Healthie:

query GetSubscriptions(\$id: ID) {
  user(id: \$id) {
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

Variable: { id: healthieId }

Then in the response object (line ~519-544), merge the Healthie recurring_payments into active_packages. Map each recurring_payment to: { package_name: rp.offering_name, amount: rp.amount_to_pay, frequency: rp.billing_frequency, next_charge_date: rp.next_payment_date }. Only include non-canceled, non-paused ones. Keep the existing local package query as a fallback — merge both sources.

PROBLEM 2 — Recent Payments always empty:
Lines 406-426 have the entire lastPayments query commented out with a TODO. Instead of a local table query, use the existing safeHealthieQuery pattern to fetch billing items from Healthie:

query GetBillingItems(\$clientId: ID) {
  billingItems(client_id: \$clientId, offset: 0) {
    id
    amount_display
    created_at
    description
    offering {
      name
    }
  }
}

Variable: { clientId: healthieId }

Map the results to the last_payments format: { amount: item.amount_display, payment_date: item.created_at, payment_type: item.offering?.name || 'Charge', description: item.description, status: 'completed' }. Return the latest 5.

After making changes, git add, commit with message 'fix(ipad): fetch Healthie subscriptions and billing items for financial tab', and push to master."
```

---

## Task 2: Fix Allergy Form (M1)

Debug and fix the allergy add form so it reliably works.

```bash
claude -p "Fix the allergy form in the iPad app (public/ipad/app.js).

The showPatientDataForm('allergy') function (around line 4552) has potential issues:
1. It looks for container = document.getElementById('chartTabContent') on line 4559
2. Then looks for section = document.getElementById('allergies-section') on line 4689
3. If allergies-section exists, it inserts the form after it

The problem: the allergies-section is in the chart HEADER area (above the tab nav), but the container variable points to chartTabContent (below the tabs). The section.parentNode on line 4691 is the chart panel content (globalChartContent), NOT chartTabContent. This means line 4559 is misleading but the insertion on line 4690 should still work.

REAL FIX needed: 
1. Add console.log statements at key points for debugging: when the + button is clicked, when healthie_id is checked, when the form is inserted, when the section is found/not found
2. Make the form insertion more robust — if allergies-section is not found, also try document.querySelector('#globalChartContent #allergies-section') and document.querySelector('[id=allergies-section]')  
3. After inserting the form, ensure scrollIntoView works by checking the closest scrollable parent: formDiv.scrollIntoView({ behavior: 'smooth', block: 'center' })
4. Add a fallback: if no section is found AND container exists, prepend to the first child of the globalChartContent or the chart panel body
5. When healthie_id is empty, show a MORE descriptive error: 'Cannot add allergy — this patient is not linked to Healthie. Connect them first via the Patients tab.'

After making changes, git add, commit with message 'fix(ipad): improve allergy form insertion and error handling', and push to master."
```

---

## Task 3: Sync Vitals to Healthie (M2)

```bash
claude -p "Fix vitals in the iPad app so they sync to Healthie.

In public/ipad/app.js, the submitAllVitals function (around line 7326) saves vitals to the local database via /ops/api/ipad/patient/[id]/metrics/. But it does NOT also save them to Healthie, creating data drift.

FIX: After each successful local save in the for loop (line ~7381-7392), also fire a request to /ops/api/ipad/patient-data/ with action 'add_vital' to sync to Healthie. You need the healthie_id — get it from chartPanelData.healthie_id.

Map the metric_type values to Healthie category values:
- blood_pressure → 'Blood Pressure' (value is already formatted as '120/80')
- heart_rate → 'Heart Rate'
- respiration_rate → 'Respiration Rate'  
- temperature → 'Temperature'
- oxygen_saturation → 'SpO2'
- height → 'Height'
- weight → 'Weight'
- bmi → 'BMI'

The Healthie sync should be fire-and-forget (don't await, don't block the UI). Use a separate try/catch and log errors to console but don't show them to the user — the local save is the primary record.

Also add a small note in the success message: '(synced to Healthie)' if the healthie_id exists.

After making changes, git add, commit with message 'fix(ipad): sync vitals modal entries to Healthie', and push to master."
```

---

## Task 4: Sync Demographics Edits to Healthie (M3)

```bash
claude -p "Fix demographics editing in the iPad app so changes sync to Healthie.

The saveDemographics function in app.js calls /ops/api/ipad/patient/[id]/demographics/ which only updates the local patients table.

FIX: In app/api/ipad/patient/[id]/demographics/route.ts, after the successful local DB update, also update the patient in Healthie using the healthieGraphQL function (or import the Healthie client).

Look up the patient's healthie_client_id from the healthie_clients table, then call:

mutation UpdateClient(\$input: updateClientInput!) {
  updateClient(input: \$input) {
    user {
      id
      first_name
      last_name
    }
    messages {
      field
      message
    }
  }
}

Map the demographics fields:
- first_name, last_name from the split full_name
- dob → dob
- gender → gender  
- phone_primary → phone_number
- email → email

For address updates, use the updateLocation mutation if a location_id exists, or createLocation if not.

The Healthie sync should be best-effort — log errors but don't fail the local save. Return a flag in the response: { success: true, healthie_synced: true/false }.

After making changes, git add, commit with message 'fix(ipad): sync demographics edits to Healthie', and push to master."
```

---

## Task 5: Build Assign Package UI (B2)

This is the biggest task — creates a new API route and frontend modal.

```bash
claude -p "Build an 'Assign Package' feature for the iPad app's Financial tab.

STEP 1 — Create API route: app/api/ipad/billing/assign-package/route.ts

GET handler:
- Import createHealthieClient from '@/lib/healthie'
- Call healthieClient.getPackages() to list available packages
- Return { success: true, packages: [...] }

POST handler:
- Accept body: { healthie_id, package_id, start_date? }
- Call healthieClient.assignPackageToClient({ client_id: healthie_id, package_id, start_date })
- Return { success: true, subscription: {...} }

Both need requireApiUser(request, 'write') authentication.

STEP 2 — Add UI in public/ipad/app.js

In the renderFinancialTab function (around line 4899), add a new button between the Active Packages section and Recent Payments section:

<button onclick=\"showAssignPackageModal()\" style=\"width:100%; margin:8px 0; padding:12px; background:rgba(124,58,237,0.15); color:var(--purple); border:1px solid var(--purple); border-radius:8px; font-size:13px; font-weight:600; cursor:pointer;\">
    📦 Assign Healthie Package
</button>

Then add the showAssignPackageModal function:
1. Fetch available packages from /ops/api/ipad/billing/assign-package/
2. Show a modal with a list of packages (name, price, frequency)
3. Each package has an 'Assign' button
4. On click, POST to assign the package, show success toast, reload chart data
5. Use the same modal styling as other modals (var(--card) background, var(--border), etc.)

STEP 3 — Ensure the modal matches the app's dark theme:
- background: var(--card)
- text: var(--text-primary)
- borders: var(--border)
- buttons: var(--purple) accent

After all changes, git add all new and modified files, commit with message 'feat(ipad): add assign-package UI and API for financial tab', and push to master."
```
