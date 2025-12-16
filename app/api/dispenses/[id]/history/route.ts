import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { fetchDispenseHistory } from '@/lib/inventoryQueries';

export const dynamic = 'force-dynamic';

export async function GET(
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
    const history = await fetchDispenseHistory(dispenseId);

    return NextResponse.json({ history });
  } catch (error: any) {
    console.error('[API] Error fetching dispense history:', error);
    
    // Ensure we always return JSON, even on unexpected errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { 
        success: false,
        error: errorMessage || 'Failed to fetch dispense history.',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}




