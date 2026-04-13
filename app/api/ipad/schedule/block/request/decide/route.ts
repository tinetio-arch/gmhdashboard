/**
 * iPad — Approve or deny a pending block request (admin only).
 *
 * POST /api/ipad/schedule/block/request/decide/
 * Body: { request_id, decision: 'approve' | 'deny', notes? }
 *
 * On approve: creates the Healthie blocker via createAppointment (with the
 *             recurring payload when the request had one) and persists
 *             healthie_block_id on the row.
 * On deny:    status → 'denied', no Healthie write.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
    try {
        const user = await requireApiUser(request, 'admin');
        const body = await request.json();
        const { request_id, decision, notes } = body as {
            request_id: string;
            decision: 'approve' | 'deny';
            notes?: string;
        };

        if (!request_id || !['approve', 'deny'].includes(decision)) {
            return NextResponse.json(
                { error: 'request_id and decision (approve|deny) are required' },
                { status: 400 }
            );
        }

        const actor = (user as any).email || 'admin';

        const [req] = await query<any>(
            `SELECT * FROM block_requests WHERE request_id = $1`,
            [request_id]
        );
        if (!req) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
        if (req.status !== 'pending') {
            return NextResponse.json(
                { error: `Request already ${req.status}`, status: req.status },
                { status: 409 }
            );
        }

        if (decision === 'deny') {
            await query(
                `UPDATE block_requests
                 SET status='denied', decided_by=$1, decided_at=NOW(), decision_notes=$2
                 WHERE request_id=$3`,
                [actor, notes || null, request_id]
            );
            console.log(`[block-request] DENIED #${request_id} by ${actor}`);
            return NextResponse.json({ success: true, decision: 'denied', request_id });
        }

        // Approve → create the Healthie blocker
        const mutation = `
            mutation CreateBlocker($input: createAppointmentInput!) {
                createAppointment(input: $input) {
                    appointment { id date length is_blocker notes provider { id full_name } }
                    messages { field message }
                }
            }
        `;

        const startDt = new Date(req.start_datetime).toISOString();
        const input: Record<string, any> = {
            is_blocker: true,
            datetime: startDt,
            end_date: req.end_date,
            end_time: req.end_time,
            timezone: 'America/Phoenix',
            other_party_id: req.provider_id,
            notes: req.notes || 'Blocked time',
            contact_type: 'In Person',
        };
        if (req.repeat_interval && req.repeat_times && req.repeat_times > 1) {
            input.recurring_appointment = {
                repeat_interval: req.repeat_interval,
                repeat_times: String(req.repeat_times),
            };
        }

        const result = await healthieGraphQL<{
            createAppointment: {
                appointment: { id: string } | null;
                messages: Array<{ field: string; message: string }>;
            };
        }>(mutation, { input });

        const msgs = result.createAppointment?.messages || [];
        const appt = result.createAppointment?.appointment;
        if (!appt || msgs.length > 0) {
            console.error('[block-request] Healthie rejected blocker create:', msgs);
            return NextResponse.json(
                { error: 'Healthie rejected the block', details: msgs },
                { status: 400 }
            );
        }

        await query(
            `UPDATE block_requests
             SET status='approved', decided_by=$1, decided_at=NOW(),
                 decision_notes=$2, healthie_block_id=$3
             WHERE request_id=$4`,
            [actor, notes || null, appt.id, request_id]
        );

        console.log(
            `[block-request] APPROVED #${request_id} by ${actor} — Healthie blocker #${appt.id} created`
        );

        return NextResponse.json({
            success: true,
            decision: 'approved',
            request_id,
            healthie_block_id: appt.id,
        });
    } catch (error: any) {
        if (error instanceof UnauthorizedError || error?.status === 401) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (error?.status === 403) {
            return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
        }
        console.error('[block-request] DECIDE error:', error);
        return NextResponse.json({ error: error?.message || 'Failed to decide block request' }, { status: 500 });
    }
}
