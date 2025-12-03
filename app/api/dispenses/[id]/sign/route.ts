import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { signDispense } from '@/lib/inventoryQueries';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireApiUser(request, 'write');
    const { id: dispenseId } = params;
    const body = await request.json();

    if (!dispenseId) {
      return NextResponse.json({ error: 'Dispense ID is required.' }, { status: 400 });
    }

    // Check if user can sign (admin or has can_sign permission)
    if (user.role !== 'admin' && !user.can_sign) {
      return NextResponse.json(
        { error: 'You do not have permission to sign dispenses.' },
        { status: 403 }
      );
    }

    // Get client IP address
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || null;

    await signDispense({
      dispenseId,
      signerUserId: user.user_id,
      signerRole: user.role,
      signatureNote: body.note ?? null,
      signatureStatus: 'signed',
      signedIp: ip,
    });

    return NextResponse.json({ success: true, message: 'Dispense signed successfully.' });
  } catch (error: any) {
    console.error('[API] Error signing dispense:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to sign dispense.' },
      { status: 500 }
    );
  }
}

