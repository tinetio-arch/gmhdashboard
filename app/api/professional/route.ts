import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { fetchProfessionalDashboardPatients } from '@/lib/patientQueries';

export async function GET(request: NextRequest) {
  await requireApiUser(request, 'read');
  try {
    const data = await fetchProfessionalDashboardPatients();
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to fetch professional dashboard data', error);
    return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 });
  }
}
