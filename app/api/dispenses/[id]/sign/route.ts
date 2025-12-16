import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { signDispense } from '@/lib/inventoryQueries';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Handle params as either Promise or direct object (Next.js 13+ compatibility)
    const resolvedParams = params instanceof Promise ? await params : params;
    const { id: dispenseId } = resolvedParams;

    if (!dispenseId) {
      return NextResponse.json({ error: 'Dispense ID is required.' }, { status: 400 });
    }

    const user = await requireApiUser(request, 'write');

    // Check if user can sign (admin or has can_sign permission)
    if (user.role !== 'admin' && !user.can_sign) {
      return NextResponse.json(
        { error: 'You do not have permission to sign dispenses.' },
        { status: 403 }
      );
    }

    // Parse request body with error handling
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error('[API] Error parsing request body:', parseError);
      return NextResponse.json(
        { error: 'Invalid request body. Expected JSON.' },
        { status: 400 }
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
    
    // Ensure we always return JSON, even on unexpected errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { 
        success: false,
        error: errorMessage || 'Failed to sign dispense.',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}




