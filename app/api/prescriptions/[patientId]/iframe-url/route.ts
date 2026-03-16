import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { healthieGraphQL } from '@/lib/healthieApi';

export const dynamic = 'force-dynamic';

const DOSESPOT_IFRAME_QUERY = `
  query GetDoseSpotIframeUrl($patient_id: ID) {
    dosespot_ui_link(patient_id: $patient_id)
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
  // Require write access — prescribing is a clinical action
  try { await requireApiUser(request, 'write'); }
  catch (error) {
    if (error instanceof UnauthorizedError)
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    throw error;
  }

  if (!patientId) {
    return NextResponse.json(
      { success: false, error: 'Patient ID (Healthie) is required' },
      { status: 400 }
    );
  }

  try {
    // E2: Use healthieGraphQL from lib/healthieApi (rate-limited)
    const data = await healthieGraphQL<{ dosespot_ui_link: string }>(
      DOSESPOT_IFRAME_QUERY,
      { patient_id: patientId }
    );

    const iframeUrl = data.dosespot_ui_link;

    if (!iframeUrl) {
      return NextResponse.json(
        {
          success: false,
          error: 'DoseSpot iFrame URL not available. Ensure patient has valid phone, DOB, and address in Healthie.',
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        iframe_url: iframeUrl,
        patient_id: patientId,
        expires_note: 'URL is session-scoped. Reload if DoseSpot shows an error.',
      },
    });
  } catch (error) {
    console.error('[Prescriptions/iFrame] Error fetching DoseSpot URL:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch DoseSpot iFrame URL',
      },
      { status: 500 }
    );
  }
}
