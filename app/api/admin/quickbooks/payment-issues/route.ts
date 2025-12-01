import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { getQuickBooksPaymentIssues } from '@/lib/quickbooksDashboard';

export async function GET(req: NextRequest) {
  try {
    await requireApiUser(req, 'admin');
    const issues = await getQuickBooksPaymentIssues(50);
    return NextResponse.json(issues);
  } catch (error) {
    console.error('Error fetching payment issues:', error);
    return NextResponse.json(
      { error: 'Failed to fetch payment issues' },
      { status: 500 }
    );
  }
}
