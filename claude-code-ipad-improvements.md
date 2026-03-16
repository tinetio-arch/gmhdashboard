# Claude Code Prompt: iPad Companion App — DoseSpot Prescriptions & Clinical Upgrades

> **Target repo:** `github.com/tinetio-arch/gmhdashboard` (Next.js 14.2)
> **Primary files:** `public/ipad/app.js`, `public/ipad/style.css`, `public/ipad/index.html`, `public/ipad/polling_service.js`
> **Backend:** `src/app/api/` (Next.js App Router API routes), `src/lib/` (shared utilities)
> **Database:** PostgreSQL RDS via `query<T>(sql, params)` typed queries

---

## Summary

This prompt covers 6 phases of improvements to the Granite Mountain Health iPad companion app:

| Phase | Scope | Complexity |
|-------|-------|------------|
| **1** | Wire DoseSpot prescription data into the backend via Healthie GraphQL | Backend (server) |
| **2** | Upgrade the chart panel with a Prescriptions tab and medication display | Frontend (app.js/style.css) |
| **3** | Upgrade the inline Patient 360 view with clinical data | Frontend (app.js/style.css) |
| **4** | Inject medications into the AI Scribe's SOAP note generation | Full-stack |
| **5** | Bug fixes and polish | Full-stack |
| **6** | **Embed DoseSpot iFrame for live prescribing directly in the iPad app** | **Full-stack (HIGH IMPACT, LOW EFFORT)** |

---

## File Change Manifest

### New Files
```
src/lib/healthie.ts                                    — Healthie GraphQL client utility
src/app/api/prescriptions/[patientId]/route.ts         — GET prescriptions from DoseSpot via Healthie
src/app/api/prescriptions/[patientId]/history/route.ts — GET Surescripts medication history
src/app/api/prescriptions/[patientId]/medications/route.ts — GET combined medication list
src/migrations/create_prescription_cache.sql           — PostgreSQL cache table DDL
src/app/api/cron/sync-prescriptions/route.ts           — Background prescription sync cron
src/app/api/prescriptions/[patientId]/iframe-url/route.ts — GET DoseSpot iFrame URL from Healthie
```

### Modified Files
```
src/app/api/patients/[id]/360/route.ts                 — Add prescriptions to 360 response
src/app/api/scribe/generate-note/route.ts              — Inject medications into SOAP context
public/ipad/app.js                                     — Chart panel prescriptions tab, DoseSpot iFrame tab, inline 360 upgrades, scribe context, bug fixes
public/ipad/style.css                                  — Prescription styles, controlled substance indicators, iFrame modal styles
```

---

## Existing Architecture Reference (READ FIRST)

Before writing any code, internalize these patterns. Every new file and function MUST follow them exactly.

### API Route Pattern
Every API route in this project follows this exact structure:
```typescript
// src/app/api/example/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await requireApiUser(request, 'read');
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // ... business logic ...
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[API_NAME] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### Database Query Pattern
```typescript
const result = await query<{ id: number; name: string }>(
  `SELECT id, name FROM patients WHERE id = $1`,
  [patientId]
);
```

For dynamic queries with incrementing param index:
```typescript
let paramIndex = 1;
const params: any[] = [];
let whereClause = 'WHERE 1=1';

if (status) {
  whereClause += ` AND normalized_status = $${paramIndex++}`;
  params.push(status);
}
```

### Frontend apiFetch Pattern
```javascript
async function apiFetch(url, options = {}) {
  // Existing wrapper — prepends /ops, handles cookies, catches 401 → shows auth overlay
  const response = await fetch(`/ops${url}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (response.status === 401) {
    showAuthOverlay();
    throw new Error('Session expired');
  }
  return response;
}
```

### CSS Variable System
```css
/* The app uses these CSS custom properties — reference them, never hardcode colors */
--cyan: #22d3ee;
--surface-2: /* dark card surface */;
--border: /* subtle border color */;
--text-primary: /* white or near-white */;
--text-secondary: /* muted text */;
--text-tertiary: /* faint text */;
/* Fonts: 'DM Sans' for body, 'Space Grotesk' for headings/numbers */
```

### Tab Rendering Pattern (Chart Panel)
```javascript
// Chart panel has sub-tabs. Each uses this dispatch pattern:
function switchChartTab(tabName) {
  currentChartTab = tabName;
  // Update tab bar active states
  document.querySelectorAll('.chart-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  const container = document.getElementById('chart-tab-content');
  container.innerHTML = '';
  switch (tabName) {
    case 'charting':   renderChartingTab(container, chartPanelData); break;
    case 'forms':      renderFormsTab(container, chartPanelData); break;
    case 'documents':  renderDocumentsTab(container, chartPanelData); break;
    case 'financial':  renderFinancialTab(container, chartPanelData); break;
    case 'dispense':   renderDispenseTab(container, chartPanelData); break;
    // YOU WILL ADD:
    case 'prescriptions': renderPrescriptionsTab(container, chartPanelData); break;
  }
}
```

### Auth Cookie
```
Cookie: gmh_session_v2=<HMAC-signed token>
12-hour TTL, same-origin only
```

---

## PHASE 1: Wire DoseSpot Prescriptions Into the Backend

### 1.1 — Create Healthie GraphQL Client

**File:** `src/lib/healthie.ts`

Create a reusable Healthie GraphQL client. Check if this file already exists — if so, add the `healthieQuery` function to it. If a Healthie client already exists with a different pattern, follow that pattern instead.

```typescript
// src/lib/healthie.ts

const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;

interface HealthieResponse<T> {
  data?: T;
  errors?: Array<{ message: string; locations?: any[]; path?: string[] }>;
}

export async function healthieQuery<T>(
  query: string,
  variables: Record<string, any> = {}
): Promise<T> {
  if (!HEALTHIE_API_KEY) {
    throw new Error('HEALTHIE_API_KEY is not configured');
  }

  const response = await fetch(HEALTHIE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${HEALTHIE_API_KEY}`,
      'AuthorizationSource': 'API',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Healthie API error: ${response.status} ${response.statusText}`);
  }

  const result: HealthieResponse<T> = await response.json();

  if (result.errors && result.errors.length > 0) {
    const messages = result.errors.map(e => e.message).join('; ');
    throw new Error(`Healthie GraphQL error: ${messages}`);
  }

  if (!result.data) {
    throw new Error('Healthie returned empty data');
  }

  return result.data;
}
```

**Important:** Before creating this file, check if `src/lib/healthie.ts` already exists. If it does, inspect it and add the `healthieQuery` generic function alongside whatever already exists. Match the existing authentication pattern — the headers (`Authorization: Basic`, `AuthorizationSource: API`) are specific to Healthie's documented auth flow.

---

### 1.2 — Create Prescriptions API Route

**File:** `src/app/api/prescriptions/[patientId]/route.ts`

This route fetches prescriptions from DoseSpot via Healthie's GraphQL API. The `patientId` param is the **Healthie patient ID** (not the local GMH patient ID).

```typescript
// src/app/api/prescriptions/[patientId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { healthieQuery } from '@/lib/healthie';
import { query } from '@/lib/db';

// Full Prescription fragment — include ALL fields from the Healthie schema
const PRESCRIPTION_FRAGMENT = `
  fragment PrescriptionFields on Prescription {
    id
    product_name
    display_name
    dosage
    dose_form
    directions
    quantity
    unit
    refills
    days_supply
    status
    normalized_status
    drug_classification
    schedule
    ndc
    rxcui
    date_written
    effective_date
    date_inactive
    last_fill_date
    prescriber_name
    prescriber_id
    comment
    pharmacy_notes
    no_substitutions
    is_rx_renewal
    is_urgent
    error_ignored
    formulary
    otc
    route
    type
    rx_reference_number
    pharmacy {
      name
      address
      city
      state
      zip
      phone
      fax
    }
    first_prescription_diagnosis
    second_prescription_diagnosis
  }
`;

const GET_PRESCRIPTIONS = `
  ${PRESCRIPTION_FRAGMENT}
  query GetPrescriptions($patient_id: ID!, $current_only: Boolean) {
    prescriptions(patient_id: $patient_id, current_only: $current_only) {
      ...PrescriptionFields
    }
  }
`;

interface Prescription {
  id: string;
  product_name: string;
  display_name: string | null;
  dosage: string | null;
  dose_form: string | null;
  directions: string | null;
  quantity: string | null;
  unit: string | null;
  refills: number | null;
  days_supply: number | null;
  status: string | null;
  normalized_status: 'active' | 'inactive' | 'pending' | 'error' | 'hidden';
  drug_classification: string | null;
  schedule: string | null; // "II", "III", "IV", "V", or null
  ndc: string | null;
  rxcui: string | null;
  date_written: string | null;
  effective_date: string | null;
  date_inactive: string | null;
  last_fill_date: string | null;
  prescriber_name: string | null;
  prescriber_id: string | null;
  comment: string | null;
  pharmacy_notes: string | null;
  no_substitutions: boolean | null;
  is_rx_renewal: boolean | null;
  is_urgent: boolean | null;
  error_ignored: boolean | null;
  formulary: boolean | null;
  otc: boolean | null;
  route: string | null;
  type: string | null;
  rx_reference_number: string | null;
  pharmacy: {
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
    fax: string;
  } | null;
  first_prescription_diagnosis: string | null;
  second_prescription_diagnosis: string | null;
}

interface PrescriptionsResponse {
  prescriptions: Prescription[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: { patientId: string } }
) {
  const user = await requireApiUser(request, 'read');
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { patientId } = params; // This is the Healthie patient ID
  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get('status'); // 'active', 'inactive', 'pending', 'error'
  const currentOnly = searchParams.get('current_only') === 'true';
  const includeHistory = searchParams.get('include_history') === 'true';

  try {
    // Fetch from Healthie/DoseSpot
    const data = await healthieQuery<PrescriptionsResponse>(GET_PRESCRIPTIONS, {
      patient_id: patientId,
      current_only: currentOnly ? true : null,
    });

    let prescriptions = data.prescriptions || [];

    // Cache all fetched prescriptions to the database
    await cachePrescriptions(patientId, prescriptions);

    // Categorize
    const active = prescriptions.filter(p => p.normalized_status === 'active');
    const pending = prescriptions.filter(p => p.normalized_status === 'pending');
    const inactive = prescriptions.filter(p => p.normalized_status === 'inactive');
    const errors = prescriptions.filter(p => p.normalized_status === 'error');
    const controlled = prescriptions.filter(p => p.schedule != null);
    const controlledActive = active.filter(p => p.schedule != null);

    // Apply status filter if provided
    if (statusFilter) {
      prescriptions = prescriptions.filter(p => p.normalized_status === statusFilter);
    }

    // Find most recent date_written
    const dates = prescriptions
      .map(p => p.date_written)
      .filter(Boolean)
      .sort()
      .reverse();

    return NextResponse.json({
      success: true,
      patient_healthie_id: patientId,
      prescriptions: includeHistory ? prescriptions : active,
      categorized: {
        active,
        pending,
        inactive,
        errors,
        controlled,
        controlled_active: controlledActive,
      },
      meta: {
        total: prescriptions.length,
        active_count: active.length,
        pending_count: pending.length,
        controlled_count: controlled.length,
        controlled_active_count: controlledActive.length,
        error_count: errors.length,
        last_written: dates[0] || null,
      },
    });
  } catch (error) {
    console.error('[PRESCRIPTIONS] Healthie fetch failed, falling back to cache:', error);

    // Fallback: read from prescription_cache table
    try {
      const cached = await query<Prescription>(
        `SELECT * FROM prescription_cache
         WHERE healthie_patient_id = $1
         ORDER BY date_written DESC`,
        [patientId]
      );

      const active = cached.rows.filter((p: any) => p.normalized_status === 'active');
      const controlled = cached.rows.filter((p: any) => p.schedule != null);

      return NextResponse.json({
        success: true,
        patient_healthie_id: patientId,
        prescriptions: active,
        categorized: {
          active,
          pending: cached.rows.filter((p: any) => p.normalized_status === 'pending'),
          inactive: cached.rows.filter((p: any) => p.normalized_status === 'inactive'),
          errors: cached.rows.filter((p: any) => p.normalized_status === 'error'),
          controlled,
          controlled_active: active.filter((p: any) => p.schedule != null),
        },
        meta: {
          total: cached.rows.length,
          active_count: active.length,
          controlled_count: controlled.length,
          controlled_active_count: active.filter((p: any) => p.schedule != null).length,
          from_cache: true,
        },
      });
    } catch (cacheError) {
      console.error('[PRESCRIPTIONS] Cache fallback also failed:', cacheError);
      return NextResponse.json(
        { error: 'Failed to fetch prescriptions', details: String(error) },
        { status: 502 }
      );
    }
  }
}

// Helper: upsert prescriptions into the cache table
async function cachePrescriptions(healthiePatientId: string, prescriptions: Prescription[]) {
  for (const rx of prescriptions) {
    try {
      await query(
        `INSERT INTO prescription_cache (
          healthie_patient_id, prescription_id, product_name, display_name,
          dosage, dose_form, directions, quantity, unit, refills, days_supply,
          status, normalized_status, drug_classification, schedule, ndc, rxcui,
          date_written, effective_date, date_inactive, last_fill_date,
          prescriber_name, prescriber_id, comment, pharmacy_notes,
          no_substitutions, is_rx_renewal, is_urgent, error_ignored,
          formulary, otc, route, type, rx_reference_number,
          pharmacy_name, pharmacy_address, pharmacy_city, pharmacy_state,
          pharmacy_zip, pharmacy_phone, pharmacy_fax,
          first_prescription_diagnosis, second_prescription_diagnosis,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
          $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
          $41, $42, NOW()
        )
        ON CONFLICT (healthie_patient_id, prescription_id)
        DO UPDATE SET
          product_name = EXCLUDED.product_name,
          display_name = EXCLUDED.display_name,
          dosage = EXCLUDED.dosage,
          dose_form = EXCLUDED.dose_form,
          directions = EXCLUDED.directions,
          quantity = EXCLUDED.quantity,
          unit = EXCLUDED.unit,
          refills = EXCLUDED.refills,
          days_supply = EXCLUDED.days_supply,
          status = EXCLUDED.status,
          normalized_status = EXCLUDED.normalized_status,
          drug_classification = EXCLUDED.drug_classification,
          schedule = EXCLUDED.schedule,
          ndc = EXCLUDED.ndc,
          rxcui = EXCLUDED.rxcui,
          date_written = EXCLUDED.date_written,
          effective_date = EXCLUDED.effective_date,
          date_inactive = EXCLUDED.date_inactive,
          last_fill_date = EXCLUDED.last_fill_date,
          prescriber_name = EXCLUDED.prescriber_name,
          prescriber_id = EXCLUDED.prescriber_id,
          comment = EXCLUDED.comment,
          pharmacy_notes = EXCLUDED.pharmacy_notes,
          no_substitutions = EXCLUDED.no_substitutions,
          is_rx_renewal = EXCLUDED.is_rx_renewal,
          is_urgent = EXCLUDED.is_urgent,
          error_ignored = EXCLUDED.error_ignored,
          formulary = EXCLUDED.formulary,
          otc = EXCLUDED.otc,
          route = EXCLUDED.route,
          type = EXCLUDED.type,
          rx_reference_number = EXCLUDED.rx_reference_number,
          pharmacy_name = EXCLUDED.pharmacy_name,
          pharmacy_address = EXCLUDED.pharmacy_address,
          pharmacy_city = EXCLUDED.pharmacy_city,
          pharmacy_state = EXCLUDED.pharmacy_state,
          pharmacy_zip = EXCLUDED.pharmacy_zip,
          pharmacy_phone = EXCLUDED.pharmacy_phone,
          pharmacy_fax = EXCLUDED.pharmacy_fax,
          first_prescription_diagnosis = EXCLUDED.first_prescription_diagnosis,
          second_prescription_diagnosis = EXCLUDED.second_prescription_diagnosis,
          updated_at = NOW()`,
        [
          healthiePatientId, rx.id, rx.product_name, rx.display_name,
          rx.dosage, rx.dose_form, rx.directions, rx.quantity, rx.unit,
          rx.refills, rx.days_supply, rx.status, rx.normalized_status,
          rx.drug_classification, rx.schedule, rx.ndc, rx.rxcui,
          rx.date_written, rx.effective_date, rx.date_inactive,
          rx.last_fill_date, rx.prescriber_name, rx.prescriber_id,
          rx.comment, rx.pharmacy_notes, rx.no_substitutions,
          rx.is_rx_renewal, rx.is_urgent, rx.error_ignored,
          rx.formulary, rx.otc, rx.route, rx.type, rx.rx_reference_number,
          rx.pharmacy?.name || null, rx.pharmacy?.address || null,
          rx.pharmacy?.city || null, rx.pharmacy?.state || null,
          rx.pharmacy?.zip || null, rx.pharmacy?.phone || null,
          rx.pharmacy?.fax || null,
          rx.first_prescription_diagnosis, rx.second_prescription_diagnosis,
        ]
      );
    } catch (err) {
      console.error(`[PRESCRIPTIONS] Failed to cache rx ${rx.id}:`, err);
    }
  }
}
```

---

### 1.3 — Create Surescripts Medication History Route

**File:** `src/app/api/prescriptions/[patientId]/history/route.ts`

```typescript
// src/app/api/prescriptions/[patientId]/history/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { healthieQuery } from '@/lib/healthie';

const GET_MEDICATION_HISTORY = `
  query GetMedicationHistory($patient_id: ID!, $start_date: String, $end_date: String) {
    surescriptsReportedMedicationHistory(
      patient_id: $patient_id,
      start_date: $start_date,
      end_date: $end_date
    ) {
      id
      product_name
      display_name
      dosage
      dose_form
      directions
      quantity
      unit
      days_supply
      last_fill_date
      date_written
      prescriber_name
      pharmacy {
        name
        city
        state
      }
      ndc
      status
    }
  }
`;

export async function GET(
  request: NextRequest,
  { params }: { params: { patientId: string } }
) {
  const user = await requireApiUser(request, 'read');
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { patientId } = params;
  const { searchParams } = new URL(request.url);

  // Default: last 12 months
  const now = new Date();
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const startDate = searchParams.get('start_date') || twelveMonthsAgo.toISOString().split('T')[0];
  const endDate = searchParams.get('end_date') || now.toISOString().split('T')[0];

  try {
    const data = await healthieQuery<{ surescriptsReportedMedicationHistory: any[] }>(
      GET_MEDICATION_HISTORY,
      {
        patient_id: patientId,
        start_date: startDate,
        end_date: endDate,
      }
    );

    const history = data.surescriptsReportedMedicationHistory || [];

    return NextResponse.json({
      success: true,
      patient_healthie_id: patientId,
      history,
      meta: {
        total: history.length,
        start_date: startDate,
        end_date: endDate,
      },
    });
  } catch (error) {
    console.error('[MEDICATION_HISTORY] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch medication history', details: String(error) },
      { status: 502 }
    );
  }
}
```

---

### 1.4 — Create Combined Medications Route

**File:** `src/app/api/prescriptions/[patientId]/medications/route.ts`

```typescript
// src/app/api/prescriptions/[patientId]/medications/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { healthieQuery } from '@/lib/healthie';

const GET_PRESCRIPTION_MEDICATIONS = `
  query GetPrescriptionMedications($patient_id: ID!, $keyword: String) {
    prescriptionMedications(patient_id: $patient_id, filters: { keyword: $keyword }) {
      id
      product_name
      display_name
      dosage
      dose_form
      directions
      quantity
      unit
      refills
      days_supply
      status
      normalized_status
      schedule
      date_written
      last_fill_date
      prescriber_name
      pharmacy {
        name
      }
    }
  }
`;

export async function GET(
  request: NextRequest,
  { params }: { params: { patientId: string } }
) {
  const user = await requireApiUser(request, 'read');
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { patientId } = params;
  const { searchParams } = new URL(request.url);
  const keyword = searchParams.get('keyword') || null;

  try {
    const data = await healthieQuery<{ prescriptionMedications: any[] }>(
      GET_PRESCRIPTION_MEDICATIONS,
      {
        patient_id: patientId,
        keyword,
      }
    );

    const medications = data.prescriptionMedications || [];

    return NextResponse.json({
      success: true,
      patient_healthie_id: patientId,
      medications,
      meta: {
        total: medications.length,
        keyword,
      },
    });
  } catch (error) {
    console.error('[PRESCRIPTION_MEDICATIONS] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch prescription medications', details: String(error) },
      { status: 502 }
    );
  }
}
```

---

### 1.5 — Create Prescription Cache Table Migration

**File:** `src/migrations/create_prescription_cache.sql`

```sql
-- Migration: Create prescription_cache table
-- This caches DoseSpot prescription data fetched via Healthie's GraphQL API.
-- Used as fallback when Healthie is unavailable and for background analytics.

CREATE TABLE IF NOT EXISTS prescription_cache (
  id                          SERIAL PRIMARY KEY,
  healthie_patient_id         TEXT NOT NULL,
  prescription_id             TEXT NOT NULL,

  -- Drug info
  product_name                TEXT,
  display_name                TEXT,
  dosage                      TEXT,
  dose_form                   TEXT,
  directions                  TEXT,
  quantity                    TEXT,
  unit                        TEXT,
  refills                     INTEGER,
  days_supply                 INTEGER,

  -- Status
  status                      TEXT,              -- Free-text status from DoseSpot
  normalized_status           TEXT NOT NULL DEFAULT 'active',  -- active|inactive|pending|error|hidden
  drug_classification         TEXT,
  schedule                    TEXT,              -- Controlled substance schedule: II, III, IV, V, or NULL

  -- Identifiers
  ndc                         TEXT,
  rxcui                       TEXT,

  -- Dates
  date_written                TEXT,
  effective_date              TEXT,
  date_inactive               TEXT,
  last_fill_date              TEXT,

  -- Prescriber
  prescriber_name             TEXT,
  prescriber_id               TEXT,

  -- Notes
  comment                     TEXT,
  pharmacy_notes              TEXT,

  -- Flags
  no_substitutions            BOOLEAN DEFAULT false,
  is_rx_renewal               BOOLEAN DEFAULT false,
  is_urgent                   BOOLEAN DEFAULT false,
  error_ignored               BOOLEAN DEFAULT false,
  formulary                   BOOLEAN,
  otc                         BOOLEAN DEFAULT false,

  -- Additional
  route                       TEXT,
  type                        TEXT,
  rx_reference_number         TEXT,

  -- Pharmacy (flattened from nested object)
  pharmacy_name               TEXT,
  pharmacy_address            TEXT,
  pharmacy_city               TEXT,
  pharmacy_state              TEXT,
  pharmacy_zip                TEXT,
  pharmacy_phone              TEXT,
  pharmacy_fax                TEXT,

  -- Diagnoses
  first_prescription_diagnosis  TEXT,
  second_prescription_diagnosis TEXT,

  -- Metadata
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  UNIQUE(healthie_patient_id, prescription_id)
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_rx_cache_patient
  ON prescription_cache (healthie_patient_id);

CREATE INDEX IF NOT EXISTS idx_rx_cache_status
  ON prescription_cache (normalized_status);

CREATE INDEX IF NOT EXISTS idx_rx_cache_controlled
  ON prescription_cache (schedule)
  WHERE schedule IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rx_cache_date_written
  ON prescription_cache (date_written DESC);

CREATE INDEX IF NOT EXISTS idx_rx_cache_patient_active
  ON prescription_cache (healthie_patient_id, normalized_status)
  WHERE normalized_status = 'active';

-- Comment
COMMENT ON TABLE prescription_cache IS 'Cached DoseSpot prescriptions fetched via Healthie GraphQL API. Updated on patient view and via cron sync.';
```

---

### 1.6 — Add Prescriptions to the Patient 360 Response

**File:** `src/app/api/patients/[id]/360/route.ts` (MODIFY — do not overwrite)

Find the existing `GET` handler. It makes multiple parallel queries (demographics, labs, dispenses, etc.). Add prescriptions to the parallel fetch. Look for the `Promise.all` or `Promise.allSettled` block and add to it.

**Instructions:**

1. At the top of the file, add:
```typescript
import { healthieQuery } from '@/lib/healthie';
```

2. Find where the patient's `healthie_id` is available (it should already be in the demographics query result — look for a field like `healthie_id`, `healthie_patient_id`, or similar). If the patient record doesn't have a Healthie ID, prescriptions will be skipped.

3. Add prescription fetching to the parallel data load. Find the `Promise.all` or `Promise.allSettled` block and add:

```typescript
// Add alongside existing parallel fetches:
const prescriptionsPromise = patient.healthie_id
  ? healthieQuery<{ prescriptions: any[] }>(
      `query($patient_id: ID!) {
        prescriptions(patient_id: $patient_id, current_only: true) {
          id product_name display_name dosage dose_form directions
          quantity unit refills days_supply normalized_status schedule
          date_written last_fill_date prescriber_name
          pharmacy { name city state }
        }
      }`,
      { patient_id: patient.healthie_id }
    ).catch(err => {
      console.error('[360] Prescription fetch failed:', err);
      return { prescriptions: [] };
    })
  : Promise.resolve({ prescriptions: [] });
```

4. In the response object, add a `prescriptions` section:

```typescript
// Add to the response JSON object:
prescriptions: {
  active: (prescriptionsData.prescriptions || []).filter(
    (p: any) => p.normalized_status === 'active'
  ),
  controlled: (prescriptionsData.prescriptions || []).filter(
    (p: any) => p.schedule != null && p.normalized_status === 'active'
  ),
  recent: (prescriptionsData.prescriptions || [])
    .sort((a: any, b: any) => (b.date_written || '').localeCompare(a.date_written || ''))
    .slice(0, 5),
  alerts: {
    has_controlled: (prescriptionsData.prescriptions || []).some(
      (p: any) => p.schedule != null && p.normalized_status === 'active'
    ),
    has_errors: (prescriptionsData.prescriptions || []).some(
      (p: any) => p.normalized_status === 'error'
    ),
    controlled_schedules: [...new Set(
      (prescriptionsData.prescriptions || [])
        .filter((p: any) => p.schedule != null && p.normalized_status === 'active')
        .map((p: any) => p.schedule)
    )],
  },
  all: prescriptionsData.prescriptions || [],
},
```

---

### 1.7 — Create Background Prescription Sync Cron

**File:** `src/app/api/cron/sync-prescriptions/route.ts`

```typescript
// src/app/api/cron/sync-prescriptions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { healthieQuery } from '@/lib/healthie';

const CRON_SECRET = process.env.CRON_SECRET;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegramAlert(message: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
      }),
    });
  } catch (err) {
    console.error('[CRON] Telegram alert failed:', err);
  }
}

export async function GET(request: NextRequest) {
  // Authenticate cron
  const secret = request.headers.get('x-cron-secret');
  if (secret !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  let synced = 0;
  let errors = 0;
  const errorPatients: string[] = [];

  try {
    // Get all active patients with a Healthie ID
    const patients = await query<{ id: number; healthie_id: string; first_name: string; last_name: string }>(
      `SELECT id, healthie_id, first_name, last_name
       FROM patients
       WHERE healthie_id IS NOT NULL
         AND healthie_id != ''
         AND active = true
       ORDER BY last_name, first_name`
    );

    for (const patient of patients.rows) {
      try {
        const data = await healthieQuery<{ prescriptions: any[] }>(
          `query($patient_id: ID!) {
            prescriptions(patient_id: $patient_id) {
              id product_name display_name dosage dose_form directions
              quantity unit refills days_supply status normalized_status
              drug_classification schedule ndc rxcui date_written effective_date
              date_inactive last_fill_date prescriber_name prescriber_id
              comment pharmacy_notes no_substitutions is_rx_renewal is_urgent
              error_ignored formulary otc route type rx_reference_number
              pharmacy { name address city state zip phone fax }
              first_prescription_diagnosis second_prescription_diagnosis
            }
          }`,
          { patient_id: patient.healthie_id }
        );

        const prescriptions = data.prescriptions || [];

        // Upsert each prescription into cache
        for (const rx of prescriptions) {
          await query(
            `INSERT INTO prescription_cache (
              healthie_patient_id, prescription_id, product_name, display_name,
              dosage, dose_form, directions, quantity, unit, refills, days_supply,
              status, normalized_status, drug_classification, schedule, ndc, rxcui,
              date_written, effective_date, date_inactive, last_fill_date,
              prescriber_name, prescriber_id, comment, pharmacy_notes,
              no_substitutions, is_rx_renewal, is_urgent, error_ignored,
              formulary, otc, route, type, rx_reference_number,
              pharmacy_name, pharmacy_address, pharmacy_city, pharmacy_state,
              pharmacy_zip, pharmacy_phone, pharmacy_fax,
              first_prescription_diagnosis, second_prescription_diagnosis,
              updated_at
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
              $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
              $39,$40,$41,$42,NOW()
            )
            ON CONFLICT (healthie_patient_id, prescription_id)
            DO UPDATE SET
              product_name=EXCLUDED.product_name, display_name=EXCLUDED.display_name,
              dosage=EXCLUDED.dosage, dose_form=EXCLUDED.dose_form,
              directions=EXCLUDED.directions, quantity=EXCLUDED.quantity,
              unit=EXCLUDED.unit, refills=EXCLUDED.refills,
              days_supply=EXCLUDED.days_supply, status=EXCLUDED.status,
              normalized_status=EXCLUDED.normalized_status,
              drug_classification=EXCLUDED.drug_classification,
              schedule=EXCLUDED.schedule, ndc=EXCLUDED.ndc, rxcui=EXCLUDED.rxcui,
              date_written=EXCLUDED.date_written, effective_date=EXCLUDED.effective_date,
              date_inactive=EXCLUDED.date_inactive, last_fill_date=EXCLUDED.last_fill_date,
              prescriber_name=EXCLUDED.prescriber_name, prescriber_id=EXCLUDED.prescriber_id,
              comment=EXCLUDED.comment, pharmacy_notes=EXCLUDED.pharmacy_notes,
              no_substitutions=EXCLUDED.no_substitutions, is_rx_renewal=EXCLUDED.is_rx_renewal,
              is_urgent=EXCLUDED.is_urgent, error_ignored=EXCLUDED.error_ignored,
              formulary=EXCLUDED.formulary, otc=EXCLUDED.otc,
              route=EXCLUDED.route, type=EXCLUDED.type,
              rx_reference_number=EXCLUDED.rx_reference_number,
              pharmacy_name=EXCLUDED.pharmacy_name,
              pharmacy_address=EXCLUDED.pharmacy_address,
              pharmacy_city=EXCLUDED.pharmacy_city,
              pharmacy_state=EXCLUDED.pharmacy_state,
              pharmacy_zip=EXCLUDED.pharmacy_zip,
              pharmacy_phone=EXCLUDED.pharmacy_phone,
              pharmacy_fax=EXCLUDED.pharmacy_fax,
              first_prescription_diagnosis=EXCLUDED.first_prescription_diagnosis,
              second_prescription_diagnosis=EXCLUDED.second_prescription_diagnosis,
              updated_at=NOW()`,
            [
              patient.healthie_id, rx.id, rx.product_name, rx.display_name,
              rx.dosage, rx.dose_form, rx.directions, rx.quantity, rx.unit,
              rx.refills, rx.days_supply, rx.status, rx.normalized_status,
              rx.drug_classification, rx.schedule, rx.ndc, rx.rxcui,
              rx.date_written, rx.effective_date, rx.date_inactive,
              rx.last_fill_date, rx.prescriber_name, rx.prescriber_id,
              rx.comment, rx.pharmacy_notes, rx.no_substitutions,
              rx.is_rx_renewal, rx.is_urgent, rx.error_ignored,
              rx.formulary, rx.otc, rx.route, rx.type, rx.rx_reference_number,
              rx.pharmacy?.name || null, rx.pharmacy?.address || null,
              rx.pharmacy?.city || null, rx.pharmacy?.state || null,
              rx.pharmacy?.zip || null, rx.pharmacy?.phone || null,
              rx.pharmacy?.fax || null,
              rx.first_prescription_diagnosis, rx.second_prescription_diagnosis,
            ]
          );
        }

        // Check for prescription errors
        const rxErrors = prescriptions.filter((p: any) => p.normalized_status === 'error');
        if (rxErrors.length > 0) {
          errorPatients.push(
            `${patient.first_name} ${patient.last_name}: ${rxErrors.length} error(s) — ${rxErrors.map((e: any) => e.product_name).join(', ')}`
          );
        }

        synced++;

        // Rate limit: small delay between patients to avoid hammering Healthie
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (patientError) {
        errors++;
        console.error(`[CRON] Failed to sync prescriptions for patient ${patient.id}:`, patientError);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // Alert via Telegram if errors were found
    if (errorPatients.length > 0) {
      await sendTelegramAlert(
        `⚠️ <b>Prescription Sync Alert</b>\n\n` +
        `${errorPatients.length} patient(s) with DoseSpot errors:\n\n` +
        errorPatients.map(e => `• ${e}`).join('\n') +
        `\n\nSync: ${synced} patients in ${duration}s`
      );
    }

    return NextResponse.json({
      success: true,
      synced,
      errors,
      error_patients: errorPatients,
      duration_seconds: parseFloat(duration),
    });
  } catch (error) {
    console.error('[CRON] sync-prescriptions failed:', error);
    await sendTelegramAlert(
      `🔴 <b>Prescription Sync FAILED</b>\n${String(error)}`
    );
    return NextResponse.json(
      { error: 'Sync failed', details: String(error) },
      { status: 500 }
    );
  }
}
```

---

## PHASE 2: Upgrade the iPad App Patient Chart Panel (Frontend)

All changes in this phase are in `public/ipad/app.js` and `public/ipad/style.css`.

### 2.1 — Add Prescriptions Tab to Chart Panel Tab Bar

**File:** `public/ipad/app.js`

Find the function that renders the chart panel tab bar. It currently creates buttons for: Charting, Forms, Documents, Financial, Dispense Hx. Look for the HTML that builds these tabs (likely in `renderChartPanel()` or a similar function).

**Add a 6th tab button** for Prescriptions. Insert it as the SECOND tab (after Charting, before Forms) since it's clinical:

```javascript
// Find the tab bar HTML and add this button alongside the existing ones:
// Look for pattern like: <button class="chart-tab-btn" data-tab="charting">
// Add after the charting tab button:

`<button class="chart-tab-btn" data-tab="prescriptions" onclick="switchChartTab('prescriptions')">
  💊 Rx
</button>`
```

Then add the case in `switchChartTab()`:

```javascript
// In the switchChartTab function's switch statement, add:
case 'prescriptions':
  renderPrescriptionsTab(container, chartPanelData);
  break;
```

---

### 2.2 — Implement the Prescriptions Tab Renderer

**File:** `public/ipad/app.js`

Add this function near the other `renderXxxTab` functions:

```javascript
// ─── PRESCRIPTIONS TAB ─────────────────────────────────────────────
function renderPrescriptionsTab(container, d) {
  const rxData = d.prescriptions || {};
  const active = rxData.active || rxData.categorized?.active || [];
  const controlled = rxData.controlled || rxData.categorized?.controlled_active || [];
  const errors = rxData.categorized?.errors || [];
  const pending = rxData.categorized?.pending || [];
  const all = rxData.all || rxData.categorized?.all || [];

  let html = '';

  // ── Controlled Substance Alert Banner ──
  if (controlled.length > 0) {
    const schedules = [...new Set(controlled.map(p => p.schedule))].sort();
    html += `
      <div class="rx-alert-banner">
        ⚠️ <strong>${controlled.length} Controlled Substance${controlled.length > 1 ? 's' : ''}</strong>
        — Schedule ${schedules.join(', ')}
      </div>`;
  }

  // ── Error Banner ──
  if (errors.length > 0) {
    html += `
      <div class="rx-error-banner" style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:12px;padding:12px 16px;margin-bottom:12px;">
        🔴 <strong>${errors.length} Prescription Error${errors.length > 1 ? 's' : ''}</strong>
        — Review in DoseSpot
      </div>`;
  }

  // ── Toolbar ──
  html += `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:600;color:var(--text-primary);">
        Active Prescriptions (${active.length})
      </div>
      <div style="display:flex;gap:8px;">
        <button onclick="refreshPrescriptions('${d.healthie_id || d.patient?.healthie_id || ''}')"
          style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:6px 12px;color:var(--text-secondary);font-size:12px;cursor:pointer;">
          ↻ Refresh
        </button>
        <button onclick="togglePrescriptionHistory()"
          style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:6px 12px;color:var(--text-secondary);font-size:12px;cursor:pointer;"
          id="rx-history-toggle">
          View Full History
        </button>
      </div>
    </div>`;

  // ── Active Prescriptions List ──
  if (active.length === 0) {
    html += `
      <div style="text-align:center;padding:40px 20px;color:var(--text-tertiary);font-size:14px;">
        No active prescriptions found
      </div>`;
  } else {
    html += '<div class="rx-list" id="rx-active-list">';
    for (const rx of active) {
      html += renderPrescriptionCard(rx);
    }
    html += '</div>';
  }

  // ── Full History (hidden by default) ──
  const inactive = all.filter(p => p.normalized_status !== 'active');
  html += `
    <div id="rx-history-section" style="display:none;margin-top:20px;">
      <div style="font-family:'Space Grotesk',sans-serif;font-size:14px;font-weight:600;color:var(--text-secondary);margin-bottom:12px;">
        Prescription History (${inactive.length})
      </div>
      <div class="rx-list">
        ${inactive.length === 0
          ? '<div style="padding:20px;color:var(--text-tertiary);font-size:13px;">No history</div>'
          : inactive.map(rx => renderPrescriptionCard(rx, true)).join('')}
      </div>
    </div>`;

  // ── Open in DoseSpot link ──
  html += `
    <div style="text-align:center;margin-top:20px;">
      <a href="/ops/" target="_blank"
        style="color:var(--cyan);font-size:13px;text-decoration:none;font-weight:500;">
        Open DoseSpot in Healthie →
      </a>
    </div>`;

  container.innerHTML = html;
}

// ─── Single Prescription Card ────────────────────────────────────────
function renderPrescriptionCard(rx, isHistory = false) {
  const scheduleClass = rx.schedule ? `rx-controlled-${rx.schedule.toLowerCase()}` : '';
  const statusClass = rx.normalized_status === 'active' ? 'rx-active'
    : rx.normalized_status === 'error' ? 'rx-error'
    : 'rx-inactive';

  // Schedule badge color
  const scheduleBadgeColors = {
    'II': { bg: 'rgba(239,68,68,0.15)', text: '#ef4444' },
    'III': { bg: 'rgba(249,115,22,0.15)', text: '#f97316' },
    'IV': { bg: 'rgba(234,179,8,0.15)', text: '#eab308' },
    'V': { bg: 'rgba(34,197,94,0.15)', text: '#22c55e' },
  };

  const scheduleBadge = rx.schedule && scheduleBadgeColors[rx.schedule]
    ? `<span style="background:${scheduleBadgeColors[rx.schedule].bg};color:${scheduleBadgeColors[rx.schedule].text};font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;margin-left:6px;">
        C-${rx.schedule}
      </span>`
    : '';

  // Status badge
  const statusBadgeColors = {
    'active': { bg: 'rgba(34,211,238,0.15)', text: 'var(--cyan)' },
    'pending': { bg: 'rgba(234,179,8,0.15)', text: '#eab308' },
    'inactive': { bg: 'rgba(156,163,175,0.15)', text: '#9ca3af' },
    'error': { bg: 'rgba(239,68,68,0.15)', text: '#ef4444' },
    'hidden': { bg: 'rgba(156,163,175,0.1)', text: '#6b7280' },
  };
  const statusColors = statusBadgeColors[rx.normalized_status] || statusBadgeColors.inactive;
  const statusBadge = `<span style="background:${statusColors.bg};color:${statusColors.text};font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;text-transform:uppercase;">
    ${rx.normalized_status}
  </span>`;

  return `
    <div class="rx-card ${scheduleClass} ${statusClass}" style="
      background:var(--surface-2);
      border:1px solid var(--border);
      border-radius:12px;
      padding:14px 16px;
      margin-bottom:8px;
      ${isHistory ? 'opacity:0.65;' : ''}
    ">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
        <div style="font-family:'DM Sans',sans-serif;font-weight:600;font-size:14px;color:var(--text-primary);flex:1;">
          ${rx.product_name || rx.display_name || 'Unknown Medication'}
          ${scheduleBadge}
        </div>
        <div style="display:flex;gap:4px;align-items:center;">
          ${statusBadge}
        </div>
      </div>

      ${rx.dosage || rx.dose_form
        ? `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:4px;">
            ${[rx.dosage, rx.dose_form].filter(Boolean).join(' · ')}
          </div>`
        : ''}

      ${rx.directions
        ? `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;font-style:italic;">
            Sig: ${rx.directions}
          </div>`
        : ''}

      <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:11px;color:var(--text-tertiary);">
        ${rx.prescriber_name ? `<span>✍️ ${rx.prescriber_name}</span>` : ''}
        ${rx.date_written ? `<span>📅 Written ${formatRxDate(rx.date_written)}</span>` : ''}
        ${rx.last_fill_date ? `<span>💊 Filled ${formatRxDate(rx.last_fill_date)}</span>` : ''}
        ${rx.quantity ? `<span>Qty: ${rx.quantity}${rx.unit ? ' ' + rx.unit : ''}</span>` : ''}
        ${rx.refills != null ? `<span>Refills: ${rx.refills}</span>` : ''}
        ${rx.days_supply ? `<span>${rx.days_supply}d supply</span>` : ''}
      </div>

      ${rx.pharmacy?.name
        ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">
            🏥 ${rx.pharmacy.name}${rx.pharmacy.city ? `, ${rx.pharmacy.city}` : ''}${rx.pharmacy.state ? ` ${rx.pharmacy.state}` : ''}
          </div>`
        : ''}
    </div>`;
}

// ─── Helper: Format Rx Date ──────────────────────────────────────────
function formatRxDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

// ─── Refresh Prescriptions ──────────────────────────────────────────
async function refreshPrescriptions(healthieId) {
  if (!healthieId) {
    console.warn('No Healthie ID for prescription refresh');
    return;
  }
  try {
    const resp = await apiFetch(`/api/prescriptions/${healthieId}?include_history=true`);
    if (!resp.ok) throw new Error('Failed to fetch');
    const data = await resp.json();
    // Update chartPanelData
    chartPanelData.prescriptions = data;
    // Re-render the tab
    const container = document.getElementById('chart-tab-content');
    if (container && currentChartTab === 'prescriptions') {
      renderPrescriptionsTab(container, chartPanelData);
    }
  } catch (err) {
    console.error('Failed to refresh prescriptions:', err);
  }
}

// ─── Toggle History View ─────────────────────────────────────────────
function togglePrescriptionHistory() {
  const section = document.getElementById('rx-history-section');
  const toggle = document.getElementById('rx-history-toggle');
  if (!section) return;
  const isHidden = section.style.display === 'none';
  section.style.display = isHidden ? 'block' : 'none';
  if (toggle) toggle.textContent = isHidden ? 'Hide History' : 'View Full History';
}
```

---

### 2.3 — Upgrade the Always-Visible Medications Section

**File:** `public/ipad/app.js`

Find the medications section in the chart panel. Look for where `hMeds` are currently rendered — it likely looks something like:

```javascript
// FIND THIS PATTERN (approximate — search for hMeds, .join(' · '), or "Medications"):
const medsHtml = hMeds.map(m => `${m.name} ${m.dosage || ''}`).join(' · ');
```

**Replace** the entire medications display section with an upgraded version:

```javascript
// ─── UPGRADED MEDICATIONS SECTION ────────────────────────────────────
function renderMedicationsSection(d) {
  // Collect all medication sources
  const hMeds = d.hMeds || d.medications?.healthie || [];
  const peptides = d.peptides || d.medications?.peptides || [];
  const trt = d.trt_dispenses || d.medications?.trt || [];
  const rxActive = d.prescriptions?.active || d.prescriptions?.categorized?.active || [];
  const rxControlled = rxActive.filter(p => p.schedule != null);

  const totalCount = hMeds.length + peptides.length + trt.length + rxActive.length;

  let html = `
    <div style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span style="font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:600;color:var(--text-secondary);">
          💊 Medications (${totalCount})
          ${rxControlled.length > 0
            ? `<span style="color:#f97316;margin-left:8px;">⚠️ ${rxControlled.length} Controlled</span>`
            : ''}
        </span>
      </div>`;

  // DoseSpot Active Prescriptions (shown first, with controlled substance indicators)
  if (rxActive.length > 0) {
    html += `<div style="margin-bottom:6px;">`;
    for (const rx of rxActive) {
      const borderColor = rx.schedule === 'II' ? '#ef4444'
        : rx.schedule === 'III' ? '#f97316'
        : rx.schedule === 'IV' ? '#eab308'
        : rx.schedule === 'V' ? '#22c55e'
        : 'transparent';
      const hasBorder = rx.schedule != null;

      html += `
        <div style="
          display:inline-flex;align-items:center;gap:4px;
          background:var(--surface-2);border:1px solid var(--border);
          ${hasBorder ? `border-left:4px solid ${borderColor};` : ''}
          border-radius:8px;padding:4px 10px;margin:2px 4px 2px 0;
          font-size:12px;color:var(--text-primary);
        ">
          ${rx.product_name || rx.display_name}
          ${rx.dosage ? `<span style="color:var(--text-tertiary);font-size:11px;">${rx.dosage}</span>` : ''}
          ${rx.schedule
            ? `<span style="color:${borderColor};font-size:9px;font-weight:700;">C-${rx.schedule}</span>`
            : ''}
        </div>`;
    }
    html += `</div>`;
  }

  // Existing hMeds, peptides, TRT (as before, but as smaller secondary items)
  const otherMeds = [
    ...hMeds.map(m => `${m.name || m.medication_name || ''}${m.dosage ? ' ' + m.dosage : ''}`),
    ...peptides.map(p => p.peptide_name || p.name || ''),
    ...trt.map(t => t.medication_name || t.name || ''),
  ].filter(Boolean);

  if (otherMeds.length > 0) {
    html += `
      <div style="font-size:11px;color:var(--text-tertiary);line-height:1.6;margin-top:4px;">
        ${otherMeds.join(' · ')}
      </div>`;
  }

  if (totalCount === 0) {
    html += `<div style="font-size:12px;color:var(--text-tertiary);">No medications on file</div>`;
  }

  html += '</div>';
  return html;
}
```

Find where the old medications section is rendered in `renderChartPanel()` and replace the old HTML generation call with `renderMedicationsSection(chartPanelData)`.

---

### 2.4 — Add Controlled Substance Alert Banner to Chart Panel Header

**File:** `public/ipad/app.js`

Find the `renderChartPanel()` function. After the patient demographics header area (name, DOB, etc.) and before the tab bar, insert:

```javascript
// ── Controlled Substance Alert ──
// Insert this HTML after the demographics/header section:
function renderControlledSubstanceAlert(d) {
  const rxActive = d.prescriptions?.active || d.prescriptions?.categorized?.active || [];
  const controlled = rxActive.filter(p => p.schedule != null);
  if (controlled.length === 0) return '';

  const hasScheduleII = controlled.some(p => p.schedule === 'II');
  const schedules = [...new Set(controlled.map(p => p.schedule))].sort();
  const lastFill = controlled
    .map(p => p.last_fill_date)
    .filter(Boolean)
    .sort()
    .reverse()[0];

  return `
    <div class="rx-alert-banner" style="${hasScheduleII ? 'animation:rx-pulse 2s ease-in-out infinite;' : ''}">
      ⚠️ <strong>${controlled.length} Active Controlled Substance${controlled.length > 1 ? 's' : ''}</strong>
      — Schedule ${schedules.join(', ')}
      ${lastFill ? `<span style="color:var(--text-tertiary);font-size:12px;margin-left:8px;">Last fill: ${formatRxDate(lastFill)}</span>` : ''}
    </div>`;
}
```

Then in `renderChartPanel()`, find the location after the demographics are rendered and before the tabs, and insert:

```javascript
// After demographics, before tabs:
html += renderControlledSubstanceAlert(chartPanelData);
```

---

### 2.5 — Fetch Prescriptions When Chart Opens

**File:** `public/ipad/app.js`

Find the function `loadChartData(patientId)` (or whatever loads the chart panel's data — it might be named `loadPatient360` when called from the chart panel context, or `openChartForPatient`).

Add prescription fetching. Look for where the 360 data is fetched and add:

```javascript
// In the chart data loading flow, after the 360 response is received:
// The 360 response now includes a prescriptions section (from Phase 1.6).
// Store it in chartPanelData:

// If the 360 response already includes prescriptions:
chartPanelData.prescriptions = data360.prescriptions || null;

// If the 360 response does NOT include prescriptions (fallback — separate fetch):
// Only do this if the patient has a healthie_id:
if (!chartPanelData.prescriptions && chartPanelData.healthie_id) {
  try {
    const rxResp = await apiFetch(`/api/prescriptions/${chartPanelData.healthie_id}?include_history=true`);
    if (rxResp.ok) {
      const rxData = await rxResp.json();
      chartPanelData.prescriptions = rxData;
    }
  } catch (err) {
    console.error('Failed to load prescriptions for chart:', err);
    chartPanelData.prescriptions = { active: [], controlled: [], all: [], alerts: {} };
  }
}
```

**Important:** Make sure you understand how `chartPanelData` is populated. Look at the existing code — it might destructure the 360 response differently. Match the existing pattern.

---

## PHASE 3: Upgrade the Inline Patient 360 View (Patients Tab)

### Context

The inline patient detail view (shown in the Patients tab when you click a patient) currently only shows administrative data. It's rendered by `renderPatient360()` (or `selectPatient()` → render). The chart panel (right sidebar) has all the clinical data. We need to add key clinical data to the inline view too.

**File:** `public/ipad/app.js`

### 3.1 — Add Allergies Section to Inline Patient View

Find `renderPatient360()`. Look for where the patient detail sections are built. Add an allergies section near the top, after demographics:

```javascript
// ── Allergies Section ──
function renderInlineAllergies(d) {
  const allergies = d.allergies || [];
  if (allergies.length === 0) {
    return `
      <div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:12px;padding:10px 14px;margin-bottom:12px;">
        <span style="font-size:13px;color:#22c55e;font-weight:600;">✓ NKDA</span>
        <span style="font-size:11px;color:var(--text-tertiary);margin-left:8px;">No Known Drug Allergies</span>
      </div>`;
  }

  return `
    <div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:10px 14px;margin-bottom:12px;">
      <div style="font-size:12px;font-weight:600;color:#ef4444;margin-bottom:6px;">
        ⚠️ ALLERGIES (${allergies.length})
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${allergies.map(a => `
          <span style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:6px;padding:3px 8px;font-size:12px;color:var(--text-primary);">
            ${a.name || a.allergen || a}
          </span>
        `).join('')}
      </div>
    </div>`;
}
```

### 3.2 — Add Working Diagnoses Section

```javascript
// ── Diagnoses Section ──
function renderInlineDiagnoses(d) {
  const diagnoses = d.diagnoses || d.working_diagnoses || [];
  if (diagnoses.length === 0) return '';

  return `
    <div style="margin-bottom:12px;">
      <div style="font-family:'Space Grotesk',sans-serif;font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">
        Working Diagnoses
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${diagnoses.map(dx => `
          <span style="background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:3px 8px;font-size:12px;color:var(--text-primary);">
            ${dx.icd10 || dx.code || ''} ${dx.description || dx.name || dx}
          </span>
        `).join('')}
      </div>
    </div>`;
}
```

### 3.3 — Add Medications Section (Including Prescriptions)

```javascript
// ── Inline Medications Section ──
function renderInlineMedications(d) {
  // Reuse renderMedicationsSection from Phase 2.3 — it already handles all sources
  return renderMedicationsSection(d);
}
```

### 3.4 — Add Active Prescriptions Summary Card

```javascript
// ── Active Prescriptions Summary Card ──
function renderInlinePrescriptionsSummary(d) {
  const rxData = d.prescriptions || {};
  const active = rxData.active || rxData.categorized?.active || [];
  const controlled = active.filter(p => p.schedule != null);

  if (active.length === 0) return '';

  const mostRecent = active
    .sort((a, b) => (b.date_written || '').localeCompare(a.date_written || ''))
    [0];

  return `
    <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:600;color:var(--text-primary);">
          💊 Active Prescriptions
        </span>
        <span style="font-size:12px;color:var(--text-tertiary);">
          ${active.length} active${controlled.length > 0 ? ` · ${controlled.length} controlled` : ''}
        </span>
      </div>
      ${controlled.length > 0
        ? `<div class="rx-alert-banner" style="margin-bottom:8px;padding:8px 12px;font-size:12px;">
            ⚠️ ${controlled.length} Controlled: ${[...new Set(controlled.map(p => 'C-' + p.schedule))].join(', ')}
          </div>`
        : ''}
      <div style="display:flex;flex-direction:column;gap:4px;">
        ${active.slice(0, 5).map(rx => {
          const borderColor = rx.schedule === 'II' ? '#ef4444'
            : rx.schedule === 'III' ? '#f97316'
            : rx.schedule === 'IV' ? '#eab308'
            : rx.schedule === 'V' ? '#22c55e'
            : 'var(--border)';
          return `
            <div style="border-left:3px solid ${borderColor};padding:4px 10px;font-size:12px;">
              <span style="color:var(--text-primary);font-weight:500;">${rx.product_name || rx.display_name}</span>
              ${rx.dosage ? `<span style="color:var(--text-tertiary);margin-left:4px;">${rx.dosage}</span>` : ''}
            </div>`;
        }).join('')}
        ${active.length > 5
          ? `<div style="font-size:11px;color:var(--text-tertiary);padding-left:13px;">
              + ${active.length - 5} more...
            </div>`
          : ''}
      </div>
    </div>`;
}
```

### 3.5 — Wire the New Sections into renderPatient360()

Find `renderPatient360()` in `app.js`. This function builds the inline patient detail view. Insert the new sections after the demographics area and before the admin-oriented sections (lab schedule, dispenses, etc.).

```javascript
// In renderPatient360(), after demographics/header, INSERT:
html += renderInlineAllergies(patientData);
html += renderInlineDiagnoses(patientData);
html += renderInlineMedications(patientData);
html += renderInlinePrescriptionsSummary(patientData);
// ... then the existing sections continue (lab schedule, dispenses, etc.)
```

### 3.6 — Fix the Empty Right Column

Find where the integration badges (GMH / GHL / Healthie) are rendered in the inline patient view. There should be a two-column layout where the right column appears empty. Look for a flex or grid container.

**Option A:** If the right column has a placeholder or empty div, add the prescriptions summary card there.

**Option B:** If the right column was intended for the "Edit" button that's misplaced, move it there:

```javascript
// Find the Edit button and place it in the right column:
// Look for: "Edit" or "editPatient" or similar
// Move it to the right column of the integration badges row:
`<button onclick="openChartForPatient('${patientData.id}')"
  style="background:var(--cyan);color:#000;border:none;border-radius:10px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;">
  📋 Open Full Chart
</button>`
```

---

## PHASE 4: Inject Medications into Scribe Context

### 4.1 — Fetch Medications Before SOAP Note Generation

**File:** `public/ipad/app.js`

Find the `generateSOAPNote()` function (or whatever triggers the SOAP note generation API call). It currently sends `session_id`, `patient_id`, `visit_type`, `patient_name` to `/ops/api/scribe/generate-note/`.

**Modify it to include medications:**

```javascript
// In generateSOAPNote() — before the API call, fetch current medications:

async function generateSOAPNote() {
  // ... existing code to collect session_id, patient_id, visit_type, patient_name ...

  // NEW: Fetch current medications for context
  let currentMedications = [];
  try {
    // First check if we already have prescriptions loaded in patient data
    if (currentScribePatient?.healthie_id) {
      const rxResp = await apiFetch(`/api/prescriptions/${currentScribePatient.healthie_id}?status=active`);
      if (rxResp.ok) {
        const rxData = await rxResp.json();
        currentMedications = (rxData.prescriptions || []).map(rx => ({
          name: rx.product_name || rx.display_name,
          dosage: rx.dosage,
          directions: rx.directions,
          schedule: rx.schedule,
          prescriber: rx.prescriber_name,
          date_written: rx.date_written,
        }));
      }
    }
  } catch (err) {
    console.warn('Failed to fetch medications for SOAP context:', err);
    // Continue without medications — non-blocking
  }

  // MODIFIED API CALL — add medications to body:
  const resp = await apiFetch('/api/scribe/generate-note/', {
    method: 'POST',
    body: JSON.stringify({
      session_id: scribeSessionId,
      patient_id: currentScribePatient?.id,
      visit_type: selectedVisitType,
      patient_name: currentScribePatient?.name || '',
      current_medications: currentMedications,  // ← NEW
    }),
  });

  // ... rest of existing code ...
}
```

### 4.2 — Server-Side: Include Medications in Claude SOAP Prompt

**File:** `src/app/api/scribe/generate-note/route.ts` (MODIFY)

Find the Claude prompt construction in this route. It builds a prompt from the transcript and sends it to Claude for SOAP note generation.

**Add medication context to the prompt:**

```typescript
// Find where the Claude prompt is built. Add medications section:

// Extract from request body:
const { session_id, patient_id, visit_type, patient_name, current_medications } = await request.json();

// Build medication context string:
let medicationContext = '';
if (current_medications && current_medications.length > 0) {
  medicationContext = `\n\nCURRENT MEDICATIONS:\n${current_medications.map((m: any) => {
    let line = `- ${m.name}`;
    if (m.dosage) line += ` ${m.dosage}`;
    if (m.directions) line += ` — ${m.directions}`;
    if (m.schedule) line += ` [Schedule ${m.schedule} Controlled]`;
    return line;
  }).join('\n')}`;
}

// In the Claude prompt, insert medicationContext. Find the system or user prompt and add:
// Look for something like:
//   `Generate a SOAP note for this ${visit_type} visit...`
// And modify to include:

const prompt = `Generate a SOAP note for this ${visit_type} visit with ${patient_name}.
${medicationContext}

Transcript:
${transcript}

Instructions:
- In the Assessment & Plan section, reference current medications where relevant
- Note any medication changes discussed during the visit
- Flag potential drug interactions if apparent from the visit context
- If a new prescription was discussed, note it in the Plan
- For controlled substances, note the schedule and any monitoring discussed
...existing instructions...`;
```

---

## PHASE 5: Bug Fixes & Polish

### 5.1 — Fix "DISPENSE NOW - NEW VERSION" Button Label

**File:** `public/ipad/app.js`

Search for the string `"DISPENSE NOW - NEW VERSION"` or `"DISPENSE NOW"` with `"NEW VERSION"`. Replace with:

```javascript
// FIND:
"DISPENSE NOW - NEW VERSION"
// REPLACE WITH:
"✅ Quick Dispense"
```

There might also be a comment or annotation nearby. Remove any dev annotations.

---

### 5.2 — Fix Trailing Slash Inconsistency in Labs Batch Approve

**File:** `public/ipad/app.js`

Search for all references to the labs review queue API endpoint. You'll find:
- `/ops/api/labs/review-queue` (without trailing slash)
- `/ops/api/labs/review-queue/` (with trailing slash)

**Standardize to include the trailing slash** (matching the Next.js API route convention):

```javascript
// FIND all instances of:
'/api/labs/review-queue'
// ENSURE they are all:
'/api/labs/review-queue/'
// (Or all WITHOUT the slash — just be consistent. Check which one the actual route.ts file uses.)
```

Check the actual file at `src/app/api/labs/review-queue/route.ts` — if the route file is in a folder with `route.ts`, then the trailing slash version is canonical. Standardize all frontend calls to match.

---

### 5.3 — Make DEA Check Modal Dynamic

**File:** `public/ipad/app.js`

Search for `"Carrie Boyd"` and `"TopRx"` in the DEA check modal code. These are hardcoded names.

Replace with dynamic values from the active vial data:

```javascript
// FIND the DEA check modal rendering code. It will have something like:
// "Carrie Boyd" or "TopRx" hardcoded.

// Replace "Carrie Boyd" with the actual compounder/prescriber from the vial data:
// Look for the vial object being passed — it should have a compounder or supplier field.
// Something like: vial.compounder_name, vial.supplier, or vial.prescriber

// Example fix — adapt to match actual field names:

// BEFORE (hardcoded):
`<div>Compounder: Carrie Boyd</div>`
`<div>Supplier: TopRx</div>`

// AFTER (dynamic):
`<div>Compounder: ${vial.compounder_name || vial.prescriber_name || 'N/A'}</div>`
`<div>Supplier: ${vial.supplier_name || vial.pharmacy_name || 'N/A'}</div>`
```

**To find the correct field names:** Search for where vial data is loaded in the Inventory tab code and inspect what fields are available.

---

### 5.4 — Add Session Auto-Refresh Mechanism

**File:** `public/ipad/app.js`

The current `apiFetch` wrapper shows the login overlay on 401. Add a one-time silent refresh attempt before giving up.

Find the `apiFetch` function and modify:

```javascript
// Track whether we're currently attempting a refresh
let isRefreshingSession = false;
let refreshPromise = null;

async function apiFetch(url, options = {}) {
  const response = await fetch(`/ops${url}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  if (response.status === 401 && !isRefreshingSession) {
    // Attempt silent session refresh
    isRefreshingSession = true;
    try {
      if (!refreshPromise) {
        refreshPromise = attemptSessionRefresh();
      }
      const refreshed = await refreshPromise;
      refreshPromise = null;
      isRefreshingSession = false;

      if (refreshed) {
        // Retry the original request once
        const retryResponse = await fetch(`/ops${url}`, {
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', ...options.headers },
          ...options,
        });
        if (retryResponse.status === 401) {
          showAuthOverlay();
          throw new Error('Session expired');
        }
        return retryResponse;
      } else {
        showAuthOverlay();
        throw new Error('Session expired');
      }
    } catch (err) {
      isRefreshingSession = false;
      refreshPromise = null;
      showAuthOverlay();
      throw new Error('Session expired');
    }
  }

  if (response.status === 401) {
    showAuthOverlay();
    throw new Error('Session expired');
  }

  return response;
}

async function attemptSessionRefresh() {
  try {
    const resp = await fetch('/ops/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    });
    return resp.ok;
  } catch {
    return false;
  }
}
```

> **NOTE:** This requires a `/ops/api/auth/refresh` endpoint on the server. If one doesn't already exist, create it:

**File:** `src/app/api/auth/refresh/route.ts`

```typescript
// src/app/api/auth/refresh/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { refreshSession } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const result = await refreshSession(request);
    if (!result) {
      return NextResponse.json({ error: 'Cannot refresh' }, { status: 401 });
    }
    // refreshSession should set the new gmh_session_v2 cookie
    const response = NextResponse.json({ success: true });
    // If refreshSession returns a new cookie value:
    if (result.cookie) {
      response.cookies.set('gmh_session_v2', result.cookie, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        maxAge: 43200, // 12 hours
        path: '/',
      });
    }
    return response;
  } catch {
    return NextResponse.json({ error: 'Refresh failed' }, { status: 401 });
  }
}
```

> **Check if `refreshSession` exists in `src/lib/auth.ts`.** If not, you may need to implement it — it should validate the existing cookie (even if expired within a grace period), and issue a new one with a fresh 12-hour TTL. The exact implementation depends on how `gmh_session_v2` is signed/validated.

---

### 5.5 — Standardize Search Threshold to 2 Characters

**File:** `public/ipad/app.js`

Find all places where a minimum character threshold is applied before searching:

```javascript
// FIND patterns like:
if (query.length < 3) return;   // Stage Dose uses 3
if (query.length < 2) return;   // Scribe uses 2

// STANDARDIZE all to 2:
if (query.length < 2) return;
```

Search for `.length < 3` and `.length >= 3` in the context of search inputs. Change all search thresholds to 2.

---

### 5.6 — Add Prescription CSS Styles

**File:** `public/ipad/style.css`

Add these styles at the end of the file, before any closing comments:

```css
/* ═══════════════════════════════════════════════════════════════════
   PRESCRIPTIONS & CONTROLLED SUBSTANCE STYLES
   ═══════════════════════════════════════════════════════════════════ */

/* Controlled substance left-border indicators */
.rx-controlled-ii {
  border-left: 4px solid #ef4444 !important;
}
.rx-controlled-iii {
  border-left: 4px solid #f97316 !important;
}
.rx-controlled-iv {
  border-left: 4px solid #eab308 !important;
}
.rx-controlled-v {
  border-left: 4px solid #22c55e !important;
}

/* Status opacity */
.rx-active {
  opacity: 1;
}
.rx-inactive {
  opacity: 0.5;
}
.rx-error {
  background: rgba(239, 68, 68, 0.08) !important;
  border-left: 4px solid #ef4444 !important;
}

/* Controlled substance alert banner */
.rx-alert-banner {
  background: linear-gradient(135deg, rgba(254, 243, 199, 0.15), rgba(253, 230, 138, 0.15));
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 12px;
  padding: 12px 16px;
  margin-bottom: 12px;
  font-family: 'DM Sans', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

/* Pulsing animation for Schedule II alerts */
@keyframes rx-pulse {
  0%, 100% {
    border-color: rgba(239, 68, 68, 0.3);
    box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
  }
  50% {
    border-color: rgba(239, 68, 68, 0.6);
    box-shadow: 0 0 8px 2px rgba(239, 68, 68, 0.15);
  }
}

/* Prescription card base */
.rx-card {
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.rx-card:active {
  transform: scale(0.98);
}

/* Prescription list container */
.rx-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* Prescription error banner */
.rx-error-banner {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 12px;
  padding: 12px 16px;
  margin-bottom: 12px;
  font-family: 'DM Sans', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

/* Prescriptions tab toolbar buttons */
.rx-toolbar-btn {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 12px;
  color: var(--text-secondary);
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.rx-toolbar-btn:active {
  background: var(--border);
}

/* Medication chip (inline patient view & chart panel) */
.rx-med-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px 10px;
  margin: 2px 4px 2px 0;
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  color: var(--text-primary);
}

/* Schedule badge (small inline label) */
.rx-schedule-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  text-transform: uppercase;
}
.rx-schedule-badge-ii {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}
.rx-schedule-badge-iii {
  background: rgba(249, 115, 22, 0.15);
  color: #f97316;
}
.rx-schedule-badge-iv {
  background: rgba(234, 179, 8, 0.15);
  color: #eab308;
}
.rx-schedule-badge-v {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

/* Status badges */
.rx-status-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}
.rx-status-active {
  background: rgba(34, 211, 238, 0.15);
  color: var(--cyan);
}
.rx-status-pending {
  background: rgba(234, 179, 8, 0.15);
  color: #eab308;
}
.rx-status-inactive {
  background: rgba(156, 163, 175, 0.15);
  color: #9ca3af;
}
.rx-status-error {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

/* Allergy badges */
.allergy-nkda {
  background: rgba(34, 197, 94, 0.08);
  border: 1px solid rgba(34, 197, 94, 0.2);
  border-radius: 12px;
  padding: 10px 14px;
  margin-bottom: 12px;
}
.allergy-alert {
  background: rgba(239, 68, 68, 0.06);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 12px;
  padding: 10px 14px;
  margin-bottom: 12px;
}
.allergy-chip {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 12px;
  color: var(--text-primary);
}

/* Diagnosis chips */
.dx-chip {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 12px;
  color: var(--text-primary);
}
```

---

## Phase 6: Embed DoseSpot iFrame for Live Prescribing (HIGH IMPACT, LOW EFFORT)

This is the most impactful feature relative to effort. Healthie exposes a GraphQL query called `dosespot_ui_link` that returns a **fully authenticated, patient-specific DoseSpot iFrame URL**. We fetch it, embed it in an `<iframe>`, and your providers can prescribe directly from the iPad app — no switching to Healthie, no separate login.

**Prerequisites:** Phase 1's `src/lib/healthie.ts` must exist. The patient must have valid demographics in Healthie (phone_number, dob, location.line1, location.city, location.state, location.zip) — which your patients already do.

### 6.1 Backend: Create iFrame URL API Route

Create `src/app/api/prescriptions/[patientId]/iframe-url/route.ts`:

```typescript
// src/app/api/prescriptions/[patientId]/iframe-url/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { healthieQuery } from '@/lib/healthie';

const DOSESPOT_IFRAME_QUERY = `
  query GetDoseSpotIframeUrl($patient_id: ID) {
    dosespot_ui_link(patient_id: $patient_id)
  }
`;

export async function GET(
  request: NextRequest,
  { params }: { params: { patientId: string } }
) {
  // Require write access — prescribing is a clinical action
  const user = await requireApiUser(request, 'write');
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const resolvedParams = params instanceof Promise ? await params : params;
  const { patientId } = resolvedParams;

  if (!patientId) {
    return NextResponse.json(
      { success: false, error: 'Patient ID (Healthie) is required' },
      { status: 400 }
    );
  }

  try {
    const data = await healthieQuery<{ dosespot_ui_link: string }>(
      DOSESPOT_IFRAME_QUERY,
      { patient_id: patientId }
    );

    const iframeUrl = data.dosespot_ui_link;

    if (!iframeUrl) {
      return NextResponse.json(
        {
          success: false,
          error: 'DoseSpot iFrame URL not available. Ensure patient has valid phone, DOB, and address in Healthie.'
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        iframe_url: iframeUrl,
        patient_id: patientId,
        expires_note: 'URL is session-scoped. Reload if DoseSpot shows an error.'
      }
    });
  } catch (error: any) {
    console.error('[Prescriptions/iFrame] Error fetching DoseSpot URL:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch DoseSpot iFrame URL'
      },
      { status: 500 }
    );
  }
}
```

**Key points:**
- Requires `'write'` role (not `'read'`) — only prescribing providers should access this
- Handles the `params instanceof Promise` pattern your codebase uses
- Returns the raw URL that the frontend embeds in an `<iframe>`
- Returns 422 with a helpful message if patient demographics are incomplete

### 6.2 Frontend: Add "E-Rx" Tab to the Global Chart Panel

In `public/ipad/app.js`, add a 6th tab to the chart panel. This is the PRIMARY prescribing interface.

**Step 1: Add the tab button.** In the `renderChartPanel()` function, find the tab nav section with the 5 existing buttons and add the E-Rx tab SECOND (right after Charting, before Forms):

```javascript
// Find this in renderChartPanel():
<button class="chart-tab-btn ${window._chartTab === 'charting' ? 'active' : ''}" onclick="switchChartTab('charting')">📋 Charting</button>

// Add this line immediately AFTER the Charting button:
<button class="chart-tab-btn ${window._chartTab === 'erx' ? 'active' : ''}" onclick="switchChartTab('erx')">💊 E-Rx</button>
```

**Step 2: Handle the tab in `switchChartTab()`.** Find the `switchChartTab` function and add `'erx'` to the tab matching logic:

```javascript
// In switchChartTab(), add to the tab-name detection:
tab === 'erx' ? 'E-Rx' :
```

**Step 3: Handle the tab in `renderChartTabContent()`.** Add the E-Rx case:

```javascript
// In renderChartTabContent(), add this case:
case 'erx':
    renderERxTab(tabContent, chartPanelData);
    break;
```

**Step 4: Create the `renderERxTab()` function.** Add this new function after the existing `renderDispenseTab()` function (around line 4600):

```javascript
// ==================== E-RX (DOSESPOT IFRAME) TAB ====================
function renderERxTab(container, d) {
    // Need the Healthie patient ID to request the iframe URL
    const healthieId = d?.demographics?.healthie_client_id ||
                       d?.healthie_client_id ||
                       chartPanelData?.healthie_client_id;

    if (!healthieId) {
        container.innerHTML = `
            <div style="padding:40px 20px; text-align:center;">
                <div style="font-size:36px; margin-bottom:12px;">⚠️</div>
                <div style="font-size:14px; font-weight:600; color:var(--text-primary); margin-bottom:6px;">Patient Not Linked to Healthie</div>
                <div style="font-size:12px; color:var(--text-tertiary);">This patient needs a Healthie account to use e-prescribing.</div>
            </div>
        `;
        return;
    }

    // Show loading state while fetching the iFrame URL
    container.innerHTML = `
        <div id="erxLoadingState" style="padding:40px 20px; text-align:center;">
            <div class="loading-spinner" style="margin:0 auto 16px;"></div>
            <div style="font-size:13px; color:var(--text-secondary);">Loading DoseSpot prescribing interface…</div>
        </div>
        <div id="erxIframeContainer" style="display:none; width:100%; height:calc(100vh - 280px); min-height:500px;"></div>
        <div id="erxErrorState" style="display:none; padding:40px 20px; text-align:center;"></div>
    `;

    // Fetch the authenticated iFrame URL
    loadDoseSpotIframe(healthieId);
}

async function loadDoseSpotIframe(healthiePatientId) {
    const loadingEl = document.getElementById('erxLoadingState');
    const iframeContainer = document.getElementById('erxIframeContainer');
    const errorEl = document.getElementById('erxErrorState');

    try {
        const result = await apiFetch(`/ops/api/prescriptions/${healthiePatientId}/iframe-url`);

        if (result?.success && result?.data?.iframe_url) {
            // Hide loading, show iframe
            if (loadingEl) loadingEl.style.display = 'none';
            if (iframeContainer) {
                iframeContainer.style.display = 'block';
                iframeContainer.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; background:var(--surface-2); border-radius:8px 8px 0 0; border:1px solid var(--border); border-bottom:none;">
                        <span style="font-size:11px; color:var(--text-tertiary);">💊 DoseSpot E-Prescribing</span>
                        <div style="display:flex; gap:6px;">
                            <button onclick="loadDoseSpotIframe('${healthiePatientId}')" style="font-size:10px; padding:3px 8px; border-radius:4px; background:rgba(0,212,255,0.1); border:1px solid rgba(0,212,255,0.2); color:var(--cyan); cursor:pointer; font-family:inherit;">🔄 Reload</button>
                            <button onclick="openDoseSpotFullscreen('${healthiePatientId}')" style="font-size:10px; padding:3px 8px; border-radius:4px; background:rgba(0,212,255,0.1); border:1px solid rgba(0,212,255,0.2); color:var(--cyan); cursor:pointer; font-family:inherit;">⊞ Fullscreen</button>
                        </div>
                    </div>
                    <iframe
                        src="${result.data.iframe_url}"
                        style="width:100%; height:calc(100% - 32px); border:1px solid var(--border); border-radius:0 0 8px 8px; background:#fff;"
                        allow="clipboard-write"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                    ></iframe>
                `;
            }
        } else {
            throw new Error(result?.error || 'Failed to load DoseSpot');
        }
    } catch (err) {
        console.error('[E-Rx] Failed to load DoseSpot iframe:', err);
        if (loadingEl) loadingEl.style.display = 'none';
        if (errorEl) {
            errorEl.style.display = 'block';
            errorEl.innerHTML = `
                <div style="font-size:36px; margin-bottom:12px;">❌</div>
                <div style="font-size:14px; font-weight:600; color:var(--text-primary); margin-bottom:6px;">Could Not Load E-Prescribing</div>
                <div style="font-size:12px; color:var(--text-tertiary); margin-bottom:16px;">${err.message || 'Unknown error. Check that this patient has complete demographics in Healthie (phone, DOB, address).'}</div>
                <button onclick="loadDoseSpotIframe('${healthiePatientId}')" style="padding:10px 20px; border-radius:8px; background:var(--cyan); color:#0a0f1a; border:none; font-weight:600; font-size:13px; cursor:pointer; font-family:inherit;">Retry</button>
            `;
        }
    }
}
```

### 6.3 Frontend: Fullscreen DoseSpot Modal

For when the chart panel sidebar feels too narrow, add a fullscreen modal that overlays the entire iPad screen:

```javascript
// ==================== FULLSCREEN DOSESPOT MODAL ====================
function openDoseSpotFullscreen(healthiePatientId) {
    // Remove existing modal if any
    const existing = document.getElementById('doseSpotFullscreenModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'doseSpotFullscreenModal';
    modal.className = 'dosespot-fullscreen-modal';
    modal.innerHTML = `
        <div class="dosespot-fullscreen-header">
            <span style="font-size:14px; font-weight:600; color:#fff;">💊 DoseSpot E-Prescribing</span>
            <button onclick="closeDoseSpotFullscreen()" class="dosespot-fullscreen-close">✕ Close</button>
        </div>
        <div class="dosespot-fullscreen-body">
            <div id="doseSpotFullscreenLoading" style="display:flex; align-items:center; justify-content:center; height:100%;">
                <div class="loading-spinner" style="margin-right:12px;"></div>
                <span style="color:var(--text-secondary);">Loading DoseSpot…</span>
            </div>
            <iframe id="doseSpotFullscreenIframe" style="display:none; width:100%; height:100%; border:none; background:#fff;"
                    allow="clipboard-write"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>
        </div>
    `;
    document.body.appendChild(modal);

    // Animate in
    requestAnimationFrame(() => modal.classList.add('visible'));

    // Fetch and load the iframe URL
    apiFetch(`/ops/api/prescriptions/${healthiePatientId}/iframe-url`)
        .then(result => {
            if (result?.success && result?.data?.iframe_url) {
                const loading = document.getElementById('doseSpotFullscreenLoading');
                const iframe = document.getElementById('doseSpotFullscreenIframe');
                if (loading) loading.style.display = 'none';
                if (iframe) {
                    iframe.src = result.data.iframe_url;
                    iframe.style.display = 'block';
                }
            } else {
                throw new Error(result?.error || 'Failed to load');
            }
        })
        .catch(err => {
            const loading = document.getElementById('doseSpotFullscreenLoading');
            if (loading) loading.innerHTML = `
                <div style="text-align:center;">
                    <div style="font-size:36px; margin-bottom:12px;">❌</div>
                    <div style="color:var(--text-primary); font-weight:600; margin-bottom:8px;">Could Not Load DoseSpot</div>
                    <div style="color:var(--text-tertiary); font-size:13px;">${err.message}</div>
                </div>
            `;
        });
}

function closeDoseSpotFullscreen() {
    const modal = document.getElementById('doseSpotFullscreenModal');
    if (modal) {
        modal.classList.remove('visible');
        // Wait for CSS transition to finish, then remove from DOM
        setTimeout(() => modal.remove(), 300);
    }
}
```

### 6.4 Frontend: Add "Prescribe" Button to Patient Action Grid

In `renderPatient360()`, find the action buttons grid (the 8-button grid near the bottom with "Change Status", "View in Healthie", etc.) and add a "Prescribe" button. This opens the fullscreen DoseSpot modal directly:

```javascript
// Find the action buttons section in renderPatient360() and add this button:
<button class="quick-action-btn" onclick="openDoseSpotFullscreen('${demo.healthie_client_id || patient?.healthie_client_id}')" ${!(demo.healthie_client_id || patient?.healthie_client_id) ? 'disabled style="opacity:0.4;"' : ''}>
    <span class="quick-action-icon">💊</span>
    <span class="quick-action-label">Prescribe</span>
</button>
```

Also add it to the schedule view. In `renderHealthieAppointment()`, add a prescribe button so providers can prescribe directly from the schedule:

```javascript
// In the appointment card actions area:
<button onclick="openDoseSpotFullscreen('${appt.healthie_patient_id || appt.patient_id}')" style="font-size:10px; padding:4px 10px; border-radius:6px; background:rgba(168,85,247,0.15); border:1px solid rgba(168,85,247,0.3); color:#a855f7; cursor:pointer; font-family:inherit;">💊 Prescribe</button>
```

### 6.5 Frontend: Add "Send Rx" Step in Scribe Flow (Optional)

In `renderScribeReview()`, after the "Submit to Healthie" button, add an optional "Prescribe" button that opens DoseSpot for the current scribe patient:

```javascript
// Find the submit button area in renderScribeReview() and add after it:
${scribePatientId ? `
    <button onclick="openDoseSpotFullscreen('${scribePatientId}')" style="
        width:100%; padding:14px; border-radius:10px; margin-top:8px;
        background:rgba(168,85,247,0.15); border:1px solid rgba(168,85,247,0.3);
        color:#a855f7; font-size:14px; font-weight:600; cursor:pointer; font-family:inherit;
    ">💊 Send Prescription</button>
` : ''}
```

### 6.6 CSS: Fullscreen Modal Styles

Add to `public/ipad/style.css`:

```css
/* ==================== DoseSpot Fullscreen Modal ==================== */
.dosespot-fullscreen-modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 10000;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    opacity: 0;
    transform: scale(0.97);
    transition: opacity 0.25s ease, transform 0.25s ease;
    pointer-events: none;
}

.dosespot-fullscreen-modal.visible {
    opacity: 1;
    transform: scale(1);
    pointer-events: all;
}

.dosespot-fullscreen-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 20px;
    background: var(--surface-1);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
}

.dosespot-fullscreen-close {
    padding: 8px 16px;
    border-radius: 8px;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #f87171;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.15s ease;
}

.dosespot-fullscreen-close:active {
    background: rgba(239, 68, 68, 0.3);
}

.dosespot-fullscreen-body {
    flex: 1;
    overflow: hidden;
}

/* Ensure iframe fills the body on iPad */
.dosespot-fullscreen-body iframe {
    -webkit-overflow-scrolling: touch;
}
```

### 6.7 Summary of Phase 6 Changes

| Change | File | Lines of Code |
|--------|------|---------------|
| iFrame URL API route | `src/app/api/prescriptions/[patientId]/iframe-url/route.ts` | ~55 |
| E-Rx chart panel tab + renderer | `public/ipad/app.js` (add to renderChartPanel, switchChartTab, renderChartTabContent, new renderERxTab + loadDoseSpotIframe) | ~80 |
| Fullscreen modal + close | `public/ipad/app.js` (new openDoseSpotFullscreen, closeDoseSpotFullscreen) | ~60 |
| "Prescribe" action button | `public/ipad/app.js` (modify renderPatient360 action grid) | ~5 |
| Schedule prescribe button | `public/ipad/app.js` (modify renderHealthieAppointment) | ~3 |
| Scribe "Send Rx" button | `public/ipad/app.js` (modify renderScribeReview) | ~8 |
| Fullscreen modal CSS | `public/ipad/style.css` | ~50 |
| **Total** | | **~261 lines** |

This is by far the highest-impact-to-effort-ratio phase. One API route + a few frontend functions = **live e-prescribing on your iPad** without ever leaving the app.

---

## Implementation Order & Testing Checklist

Execute the phases in order. After each phase, verify:

### Phase 1 Verification
- [ ] `src/lib/healthie.ts` compiles and exports `healthieQuery`
- [ ] `GET /ops/api/prescriptions/{healthiePatientId}` returns categorized prescriptions
- [ ] `GET /ops/api/prescriptions/{healthiePatientId}/history` returns Surescripts data
- [ ] `GET /ops/api/prescriptions/{healthiePatientId}/medications` returns combined list
- [ ] Migration SQL runs without errors
- [ ] 360 endpoint response includes `prescriptions` section
- [ ] Cron endpoint syncs and caches prescriptions
- [ ] Fallback to cache works when Healthie is unavailable

### Phase 2 Verification
- [ ] Chart panel shows 6 tabs (Charting, Prescriptions, Forms, Documents, Financial, Dispense Hx)
- [ ] Prescriptions tab renders active prescriptions with schedule badges
- [ ] Controlled substance alert banner appears when applicable
- [ ] Schedule II prescriptions show pulsing red animation
- [ ] Medications section above tabs shows DoseSpot + hMeds + peptides + TRT
- [ ] "Refresh" button re-fetches prescriptions
- [ ] "View Full History" toggle shows/hides inactive prescriptions

### Phase 3 Verification
- [ ] Inline patient view shows allergies (or NKDA)
- [ ] Working diagnoses appear if data exists
- [ ] Medications section matches chart panel display
- [ ] Active prescriptions summary card shows with controlled counts
- [ ] Empty right column is utilized

### Phase 4 Verification
- [ ] SOAP note generation includes medication list in request body
- [ ] Generated SOAP note references current medications in Assessment & Plan
- [ ] Medication fetch failure doesn't block SOAP generation

### Phase 5 Verification
- [ ] "DISPENSE NOW - NEW VERSION" → "✅ Quick Dispense"
- [ ] Labs batch approve URL is consistent (trailing slash)
- [ ] DEA check modal shows dynamic compounder/supplier names
- [ ] 401 triggers silent refresh attempt before login overlay
- [ ] All search inputs trigger at 2 characters
- [ ] All new CSS classes render correctly on iPad

### Phase 6 Verification
- [ ] `GET /ops/api/prescriptions/{healthiePatientId}/iframe-url` returns a valid DoseSpot URL
- [ ] 422 returned when patient has incomplete demographics
- [ ] Chart panel shows "E-Rx" as 2nd tab (after Charting)
- [ ] Clicking E-Rx tab loads DoseSpot iFrame in sidebar with loading state
- [ ] "Reload" button refreshes the iFrame URL
- [ ] "Fullscreen" button opens the fullscreen modal overlay
- [ ] Fullscreen modal fills entire iPad screen with DoseSpot
- [ ] Fullscreen close button works (animated slide out)
- [ ] "Prescribe" button appears in patient 360 action grid
- [ ] "Prescribe" button opens fullscreen modal
- [ ] Prescribe button is disabled/hidden when patient has no Healthie ID
- [ ] "Send Prescription" button appears in scribe review after SOAP generation
- [ ] DoseSpot iFrame is interactive — can search medications, select pharmacy, send prescriptions
- [ ] iFrame works on iPad Safari (touch scrolling, form inputs, dropdowns all functional)
- [ ] No CORS or sandbox errors in console

---

## Environment Variables Required

Ensure these are set in `.env` / `.env.local`:

```bash
# Healthie API (already should exist)
HEALTHIE_API_URL=https://api.gethealthie.com/graphql
HEALTHIE_API_KEY=<your-api-key>

# Cron authentication
CRON_SECRET=<secure-random-string>

# Telegram alerts (already should exist)
TELEGRAM_BOT_TOKEN=<bot-token>
TELEGRAM_CHAT_ID=<chat-id>
```

---

## Key Constraints & Warnings

1. **Prescriptions are READ-ONLY via API, WRITE via iFrame** — Healthie's GraphQL API can only read prescription data. To actually prescribe, use the DoseSpot iFrame (Phase 6) which Healthie provides via the `dosespot_ui_link` query. The iFrame handles all the DoseSpot authentication, EPCS two-factor, and Surescripts submission.

2. **Use `normalized_status` not `status`** — The `status` field is free-text from DoseSpot and unreliable. Always filter/display using `normalized_status` which is: `active`, `inactive`, `pending`, `error`, `hidden`.

3. **`schedule` field = controlled substance schedule** — Values: `"II"`, `"III"`, `"IV"`, `"V"`, or `null` (non-controlled). This is NOT a time-based schedule.

4. **`monograph_path` is deprecated** — Do NOT use this field. DoseSpot V2 migration removed it.

5. **The `patientId` in prescription routes is the HEALTHIE patient ID** — not the local GMH database patient ID. The 360 response includes the mapping. The frontend must pass the correct ID.

6. **Match existing code style exactly** — The app.js file is 7,819 lines of vanilla JS with global state. Do not introduce modules, classes, or build tools. Add functions in the same style as existing ones. Use `var`/`let`/`const` matching what's already there.

7. **Test on iPad Safari** — The app runs on iPads. Ensure:
   - No hover-only interactions (iPad has no hover)
   - Touch targets are at least 44x44px
   - CSS animations are performant
   - `position: sticky` / `position: fixed` work correctly in Safari

8. **Rate limiting on Healthie API** — The cron sync adds a 200ms delay between patients. Do not remove this. Consider increasing if you hit rate limits.

9. **Cookie-based auth only** — All API calls use same-origin cookies. Do not add Bearer tokens or API keys to frontend code.
