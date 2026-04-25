import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface CountRow {
  to_status: string | null;
  n: string;
}

interface RecentRow {
  patient_id: string;
  patient_name: string | null;
  from_status: string | null;
  to_status: string | null;
  source: string;
  actor: string | null;
  reason: string | null;
  blocked: boolean;
  block_reason: string | null;
  created_at: string;
}

export async function GET(request: NextRequest) {
  try { await requireApiUser(request, 'read'); }
  catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    throw error;
  }

  const url = new URL(request.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '7', 10) || 7, 1), 90);

  try {
    const [byTo, totals, blocked, recent] = await Promise.all([
      query<CountRow>(
        `SELECT to_status, COUNT(*)::text AS n
           FROM patient_status_audit
          WHERE created_at > NOW() - ($1 || ' days')::interval
            AND blocked = FALSE
          GROUP BY to_status
          ORDER BY COUNT(*) DESC`,
        [String(days)]
      ),
      query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM patient_status_audit
           WHERE created_at > NOW() - ($1 || ' days')::interval AND blocked = FALSE`,
        [String(days)]
      ),
      query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM patient_status_audit
           WHERE created_at > NOW() - ($1 || ' days')::interval AND blocked = TRUE`,
        [String(days)]
      ),
      query<RecentRow>(
        `SELECT psa.patient_id, p.full_name AS patient_name,
                psa.from_status, psa.to_status, psa.source, psa.actor,
                psa.reason, psa.blocked, psa.block_reason,
                psa.created_at AT TIME ZONE 'UTC' AS created_at
           FROM patient_status_audit psa
           LEFT JOIN patients p ON p.patient_id = psa.patient_id
          WHERE psa.created_at > NOW() - ($1 || ' days')::interval
          ORDER BY psa.created_at DESC
          LIMIT 25`,
        [String(days)]
      ),
    ]);

    const byToStatus: Record<string, number> = {};
    for (const row of byTo) {
      const key = row.to_status || 'unknown';
      byToStatus[key] = Number(row.n);
    }

    return NextResponse.json({
      success: true,
      data: {
        windowDays: days,
        totalApplied: Number(totals[0]?.n || 0),
        totalBlocked: Number(blocked[0]?.n || 0),
        byToStatus,
        recent: recent.map(r => ({
          patientId: r.patient_id,
          patientName: r.patient_name,
          fromStatus: r.from_status,
          toStatus: r.to_status,
          source: r.source,
          actor: r.actor,
          reason: r.reason,
          blocked: r.blocked,
          blockReason: r.block_reason,
          createdAt: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString(),
        })),
      },
    });
  } catch (error) {
    console.error('[API] status-activity failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch status activity' }, { status: 500 });
  }
}
