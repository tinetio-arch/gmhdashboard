import { NextRequest, NextResponse } from 'next/server';
import { getMembershipMonthlyRevenue, getMembershipRevenueByMonth } from '@/lib/janeMembershipRevenue';
import { requireApiUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request, 'read');

    const searchParams = request.nextUrl.searchParams;
    const period = searchParams.get('period') || 'summary';

    if (period === 'monthly') {
      const months = parseInt(searchParams.get('months') || '12', 10);
      const monthlyRevenue = await getMembershipRevenueByMonth(months);
      return NextResponse.json({ success: true, data: monthlyRevenue });
    }

    // Default: summary
    const summary = await getMembershipMonthlyRevenue();
    return NextResponse.json({ success: true, data: summary });
  } catch (error) {
    console.error('Error fetching membership revenue:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}






