/**
 * iPad — List pending block requests (admin only).
 *
 * Creation is routed through the existing /api/ipad/schedule/block/ POST,
 * which automatically stashes the request here when the caller isn't an admin.
 *
 * GET /api/ipad/schedule/block/request/?status=pending
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        await requireApiUser(request, 'read');
        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status') || 'pending';

        const where: string[] = [];
        const args: any[] = [];
        let i = 1;
        if (status !== 'all') {
            where.push(`status = $${i++}`);
            args.push(status);
        }
        const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

        const rows = await query<any>(
            `SELECT request_id, provider_id, provider_name, start_datetime,
                    end_date, end_time, notes,
                    repeat_interval, repeat_times,
                    requested_by, requested_at,
                    status, decided_by, decided_at, decision_notes, healthie_block_id
             FROM block_requests
             ${whereSql}
             ORDER BY start_datetime ASC, requested_at ASC
             LIMIT 200`,
            args
        );

        return NextResponse.json({ success: true, requests: rows, count: rows.length });
    } catch (error: any) {
        if (error instanceof UnauthorizedError || error?.status === 401) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.error('[block-request] GET error:', error);
        return NextResponse.json({ error: error?.message || 'Failed to list block requests' }, { status: 500 });
    }
}
