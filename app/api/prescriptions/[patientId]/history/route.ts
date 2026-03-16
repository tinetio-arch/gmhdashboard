import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { healthieGraphQL } from '@/lib/healthieApi';

export const dynamic = 'force-dynamic';

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

  // Default: last 12 months
  const now = new Date();
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const startDate = searchParams.get('start_date') || twelveMonthsAgo.toISOString().split('T')[0];
  const endDate = searchParams.get('end_date') || now.toISOString().split('T')[0];

  try {
    // E2: Use healthieGraphQL from lib/healthieApi (rate-limited)
    const data = await healthieGraphQL<{ surescriptsReportedMedicationHistory: any[] }>(
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
      { success: false, error: 'Failed to fetch medication history' },
      { status: 502 }
    );
  }
}
