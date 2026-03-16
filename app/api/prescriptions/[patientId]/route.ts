import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { healthieGraphQL } from '@/lib/healthieApi';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

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
  schedule: string | null;
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
  { params }: { params: Promise<{ patientId: string }> | { patientId: string } }
) {
  // E6: Await params (Next.js 14.2 dynamic route pattern)
  const resolvedParams = params instanceof Promise ? await params : params;
  const { patientId } = resolvedParams;

  // E3: Auth throws UnauthorizedError, use try/catch
  try { await requireApiUser(request, 'read'); }
  catch (error) {
    if (error instanceof UnauthorizedError)
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    throw error;
  }

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get('status');
  const currentOnly = searchParams.get('current_only') === 'true';
  const includeHistory = searchParams.get('include_history') === 'true';

  try {
    // E2: Use healthieGraphQL from lib/healthieApi (rate-limited)
    const data = await healthieGraphQL<PrescriptionsResponse>(GET_PRESCRIPTIONS, {
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
    // E4: query<T>() returns T[] directly — no .rows
    try {
      const cached = await query<Prescription>(
        `SELECT * FROM prescription_cache
         WHERE healthie_patient_id = $1
         ORDER BY date_written DESC`,
        [patientId]
      );

      const active = cached.filter((p: any) => p.normalized_status === 'active');
      const controlled = cached.filter((p: any) => p.schedule != null);

      return NextResponse.json({
        success: true,
        patient_healthie_id: patientId,
        prescriptions: active,
        categorized: {
          active,
          pending: cached.filter((p: any) => p.normalized_status === 'pending'),
          inactive: cached.filter((p: any) => p.normalized_status === 'inactive'),
          errors: cached.filter((p: any) => p.normalized_status === 'error'),
          controlled,
          controlled_active: active.filter((p: any) => p.schedule != null),
        },
        meta: {
          total: cached.length,
          active_count: active.length,
          controlled_count: controlled.length,
          controlled_active_count: active.filter((p: any) => p.schedule != null).length,
          from_cache: true,
        },
      });
    } catch (cacheError) {
      console.error('[PRESCRIPTIONS] Cache fallback also failed:', cacheError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch prescriptions' },
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
