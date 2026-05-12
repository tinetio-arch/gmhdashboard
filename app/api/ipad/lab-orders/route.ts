import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query, pgTimestampToUTCISO } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface LabOrderRow {
  id: number;
  clinic_id: string | null;
  patient_id: string | null;
  patient_first_name: string | null;
  patient_last_name: string | null;
  test_codes: any;
  status: string;
  priority: string | null;
  ordering_provider: string | null;
  submission_error: string | null;
  external_order_id: string | null;
  created_at: unknown;
  submitted_at: unknown;
}

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request, 'read');

    const url = request.nextUrl;
    const statusFilter = url.searchParams.get('status'); // 'pending' | 'submitted' | 'failed' | 'all'
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 500);

    let sql = `
      SELECT id, clinic_id, patient_id, patient_first_name, patient_last_name,
             test_codes, status, priority, ordering_provider, submission_error,
             external_order_id, created_at, submitted_at
      FROM lab_orders
    `;
    const params: any[] = [];
    if (statusFilter && statusFilter !== 'all') {
      sql += ' WHERE status = $1';
      params.push(statusFilter);
    }
    sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const rows = await query<LabOrderRow>(sql, params);

    const orders = rows.map((r) => {
      const first = r.patient_first_name || '';
      const last = r.patient_last_name || '';
      const patientName = `${first} ${last}`.trim() || 'Unknown';
      return {
        id: r.id,
        patient_id: r.patient_id,
        patient_name: patientName,
        patient_first_name: first,
        patient_last_name: last,
        clinic_id: r.clinic_id,
        test_codes: Array.isArray(r.test_codes) ? r.test_codes : [],
        status: r.status,
        priority: r.priority || 'ROUTINE',
        ordering_provider: r.ordering_provider,
        submission_error: r.submission_error,
        external_order_id: r.external_order_id,
        created_at: pgTimestampToUTCISO(r.created_at),
        submitted_at: pgTimestampToUTCISO(r.submitted_at),
      };
    });

    const counts = {
      pending: orders.filter((o) => o.status === 'pending').length,
      pending_approval: orders.filter((o) => o.status === 'pending_approval').length,
      submitted: orders.filter((o) => o.status === 'submitted').length,
      failed: orders.filter((o) => o.status === 'failed').length,
      total: orders.length,
    };

    return NextResponse.json({ success: true, orders, counts });
  } catch (error: any) {
    if (error?.status === 401) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[iPad Lab Orders] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch lab orders' }, { status: 500 });
  }
}
