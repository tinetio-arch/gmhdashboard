import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const user = await requireApiUser(req, 'admin');

    // Get unresolved payment issues with patient details
    const issues = await query<{
      issue_id: string;
      patient_id: string;
      patient_name: string;
      issue_type: string;
      amount_owed: number;
      days_overdue: number;
      created_at: string;
    }>(`
      SELECT
        pi.issue_id,
        pi.patient_id,
        p.full_name as patient_name,
        pi.issue_type,
        pi.amount_owed,
        pi.days_overdue,
        pi.created_at
      FROM payment_issues pi
      JOIN patients p ON p.patient_id = pi.patient_id
      WHERE pi.resolved_at IS NULL
        AND p.status_key NOT IN ('inactive', 'discharged')
      ORDER BY pi.days_overdue DESC, pi.amount_owed DESC
      LIMIT 50
    `);

    return NextResponse.json(issues);
  } catch (error) {
    console.error('Error fetching payment issues:', error);
    return NextResponse.json(
      { error: 'Failed to fetch payment issues' },
      { status: 500 }
    );
  }
}
