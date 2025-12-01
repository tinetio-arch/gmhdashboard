import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { reprocessClinicSyncMemberships } from '@/lib/clinicsync';

type RequestPayload = {
  clinicsyncPatientIds?: string[];
  limit?: number;
  skipWithoutPatient?: boolean;
  syncJanePaymentPatients?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    await requireApiUser(req, 'admin');

    let payload: RequestPayload = {};
    try {
      payload = (await req.json()) as RequestPayload;
    } catch {
      payload = {};
    }

    const clinicsyncPatientIds = Array.isArray(payload.clinicsyncPatientIds)
      ? payload.clinicsyncPatientIds.filter(
          (id): id is string => typeof id === 'string' && id.trim().length > 0
        )
      : undefined;

    const limit =
      typeof payload.limit === 'number' && Number.isFinite(payload.limit) && payload.limit > 0
        ? Math.floor(payload.limit)
        : undefined;

    const skipWithoutPatient =
      typeof payload.skipWithoutPatient === 'boolean' ? payload.skipWithoutPatient : true;

    const syncJanePaymentPatients =
      typeof payload.syncJanePaymentPatients === 'boolean' ? payload.syncJanePaymentPatients : false;

    const result = await reprocessClinicSyncMemberships({
      clinicsyncPatientIds,
      limit,
      skipWithoutPatient,
      paymentMethodKeys: syncJanePaymentPatients ? ['jane', 'jane_quickbooks'] : undefined,
      paymentMethodLike: syncJanePaymentPatients ? ['%jane%'] : undefined,
    });

    return NextResponse.json(
      {
        success: true,
        processed: result.processed,
        skipped: result.skipped,
        clinicsyncPatientIds,
        limit,
        syncJanePaymentPatients,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[ClinicSync] Reprocess API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to reprocess ClinicSync memberships',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

