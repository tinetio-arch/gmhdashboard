import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  getTotalJaneRevenue,
  getJanePatientRevenue,
  getJaneRevenueByPeriod,
  getJaneRevenueDaily,
  getJaneRevenueWeekly,
  getJaneRevenueMonthly
} from '@/lib/janeRevenueQueries';

export async function GET(request: NextRequest) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const period = searchParams.get('period'); // 'total', 'daily', 'weekly', 'monthly', 'range'
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const type = searchParams.get('type'); // 'summary', 'patients', 'breakdown'

    // Default to last 30 days if no dates provided
    const defaultEndDate = new Date();
    const defaultStartDate = new Date();
    defaultStartDate.setDate(defaultStartDate.getDate() - 30);

    const start = startDate ? new Date(startDate) : defaultStartDate;
    const end = endDate ? new Date(endDate) : defaultEndDate;

    switch (period) {
      case 'daily':
        const daily = await getJaneRevenueDaily(start, end);
        return NextResponse.json({ success: true, period: 'daily', data: daily });

      case 'weekly':
        const weekly = await getJaneRevenueWeekly(start, end);
        return NextResponse.json({ success: true, period: 'weekly', data: weekly });

      case 'monthly':
        const monthly = await getJaneRevenueMonthly(start, end);
        return NextResponse.json({ success: true, period: 'monthly', data: monthly });

      case 'range':
        const range = await getJaneRevenueByPeriod(start, end);
        return NextResponse.json({ success: true, period: 'range', data: range });

      case 'patients':
        const patients = await getJanePatientRevenue();
        return NextResponse.json({ success: true, period: 'patients', data: patients });

      case 'total':
      default:
        const total = await getTotalJaneRevenue();
        return NextResponse.json({ success: true, period: 'total', data: total });
    }
  } catch (error) {
    console.error('Error fetching Jane revenue:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

