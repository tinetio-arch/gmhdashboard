import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { getQuickBooksDashboardMetrics } from '@/lib/quickbooksDashboard';

export async function GET(req: NextRequest) {
  try {
    await requireApiUser(req, 'admin');
    const metrics = await getQuickBooksDashboardMetrics();
    return NextResponse.json(metrics);
  } catch (error) {
    console.error('Error fetching QuickBooks metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch metrics' },
      { status: 500 }
    );
  }
}
