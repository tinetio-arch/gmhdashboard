import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { fetchDispenseHistory } from '@/lib/inventoryQueries';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireApiUser(request, 'write');
    const { id: dispenseId } = params;

    if (!dispenseId) {
      return NextResponse.json({ error: 'Dispense ID is required.' }, { status: 400 });
    }

    const history = await fetchDispenseHistory(dispenseId);

    return NextResponse.json({ history });
  } catch (error: any) {
    console.error('[API] Error fetching dispense history:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch dispense history.' },
      { status: 500 }
    );
  }
}


