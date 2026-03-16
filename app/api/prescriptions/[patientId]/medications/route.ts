import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { healthieGraphQL } from '@/lib/healthieApi';

export const dynamic = 'force-dynamic';

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
  const keyword = searchParams.get('keyword') || null;

  try {
    // E2: Use healthieGraphQL from lib/healthieApi (rate-limited)
    const data = await healthieGraphQL<{ prescriptionMedications: any[] }>(
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
      { success: false, error: 'Failed to fetch prescription medications' },
      { status: 502 }
    );
  }
}
