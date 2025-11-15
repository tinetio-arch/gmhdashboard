'use server';

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { fetchProviderSignatureQueue, fetchProviderSignatureSummary } from '@/lib/inventoryQueries';

export async function GET(request: NextRequest) {
  const user = await requireApiUser(request, 'read');
  if (!(user.can_sign || user.role === 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const [queue, summary] = await Promise.all([fetchProviderSignatureQueue(), fetchProviderSignatureSummary()]);
    return NextResponse.json({ queue, summary });
  } catch (error) {
    console.error('Failed to fetch provider signature queue', error);
    return NextResponse.json({ error: 'Failed to fetch signature queue.' }, { status: 500 });
  }
}
