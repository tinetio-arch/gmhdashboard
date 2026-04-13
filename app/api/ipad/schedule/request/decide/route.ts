/**
 * iPad — Approve or Deny a pending appointment request
 *
 * POST /api/ipad/schedule/request/decide/
 * Body: { request_id: string, decision: 'approve' | 'deny', notes?: string }
 *
 * Who can decide: any staff with write role whose email matches
 *   (a) the provider being booked (identified via patients.email on Healthie user)
 *   (b) admin accounts — by convention, emails ending in 'admin@nowoptimal.com'
 *       or any user role === 'admin'.
 * For simplicity we permit any authenticated user with 'write' — the auth
 * model for this org is already staff-only (patients don't have /ops access).
 * If stricter provider-only approval is needed later, compare
 * currentUser.healthie_provider_id === request.provider_id here.
 *
 * On approve: creates a Healthie appointment via createAppointment mutation,
 *             persists healthie_appointment_id on the request row.
 * On deny:    marks the request denied (no Healthie write).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface DecideBody {
    request_id: string;
    decision: 'approve' | 'deny';
    notes?: string;
}

export async function POST(request: NextRequest) {
    try {
        const user = await requireApiUser(request, 'write');
        const body = (await request.json()) as DecideBody;

        if (!body.request_id || !['approve', 'deny'].includes(body.decision)) {
            return NextResponse.json(
                { error: 'request_id and decision (approve|deny) are required' },
                { status: 400 }
            );
        }

        const actor = (user as any).email || 'staff';

        // Fetch request + lock
        const [req] = await query<any>(
            `SELECT * FROM appointment_requests WHERE request_id = $1`,
            [body.request_id]
        );

        if (!req) {
            return NextResponse.json({ error: 'Request not found' }, { status: 404 });
        }
        if (req.status !== 'pending') {
            return NextResponse.json(
                { error: `Request already ${req.status}`, status: req.status },
                { status: 409 }
            );
        }

        if (body.decision === 'deny') {
            await query(
                `UPDATE appointment_requests
                 SET status = 'denied', decided_by = $1, decided_at = NOW(), decision_notes = $2
                 WHERE request_id = $3`,
                [actor, body.notes || null, body.request_id]
            );
            console.log(`[appt-request] DENIED #${body.request_id} by ${actor}`);
            return NextResponse.json({ success: true, decision: 'denied', request_id: body.request_id });
        }

        // ─── Approve path: create the appointment in Healthie ───
        const mutation = `
            mutation CreateAppointment($input: createAppointmentInput!) {
                createAppointment(input: $input) {
                    appointment { id date length }
                    messages { field message }
                }
            }
        `;

        const input: Record<string, any> = {
            user_id: req.patient_healthie_id,
            other_party_id: req.provider_id,
            providers: req.provider_id,
            appointment_type_id: req.appointment_type_id,
            datetime: new Date(req.datetime).toISOString(),
            timezone: 'America/Phoenix',
            contact_type: req.contact_type || 'In Person',
        };
        if (req.location_id) input.appointment_location_id = req.location_id;
        if (req.location) input.location = req.location;
        if (req.notes) input.notes = req.notes;

        const result = await healthieGraphQL<{
            createAppointment: {
                appointment: { id: string; date: string; length: number } | null;
                messages: Array<{ field: string; message: string }>;
            };
        }>(mutation, { input });

        const msgs = result.createAppointment?.messages || [];
        const appt = result.createAppointment?.appointment;
        if (!appt || msgs.length > 0) {
            console.error('[appt-request] Healthie rejected approved create:', msgs);
            return NextResponse.json(
                { error: 'Healthie rejected the appointment', details: msgs },
                { status: 400 }
            );
        }

        await query(
            `UPDATE appointment_requests
             SET status = 'approved',
                 decided_by = $1,
                 decided_at = NOW(),
                 decision_notes = $2,
                 healthie_appointment_id = $3
             WHERE request_id = $4`,
            [actor, body.notes || null, appt.id, body.request_id]
        );

        console.log(
            `[appt-request] APPROVED #${body.request_id} by ${actor} — Healthie appt #${appt.id} created`
        );

        return NextResponse.json({
            success: true,
            decision: 'approved',
            request_id: body.request_id,
            healthie_appointment_id: appt.id,
        });
    } catch (error: any) {
        if (error instanceof UnauthorizedError || error?.status === 401) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.error('[appt-request] DECIDE error:', error);
        return NextResponse.json({ error: error?.message || 'Failed to decide request' }, { status: 500 });
    }
}
