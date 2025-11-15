import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '../../../../../lib/auth';
import { fetchDispenseHistory } from '../../../../../lib/inventoryQueries';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  await requireApiUser(request, 'read');
  try {
    const history = await fetchDispenseHistory(params.id);
    return NextResponse.json({ history });
  } catch (error) {
    console.error('Failed to fetch dispense history', error);
    return NextResponse.json({ error: 'Failed to fetch dispense history.' }, { status: 500 });
  }
}
