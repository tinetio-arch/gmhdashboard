import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { healthieGraphQL } from '@/lib/healthieApi';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/ipad/appointment-status
 * Updates an appointment's status in Healthie.
 * Used by iPad Schedule view when staff clicks to advance status.
 */
export async function PATCH(request: NextRequest) {
    try {
        await requireApiUser(request, 'write');
    } catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const body = await request.json();
        const { appointment_id, status } = body;

        if (!appointment_id || !status) {
            return NextResponse.json(
                { error: 'appointment_id and status are required' },
                { status: 400 }
            );
        }

        // Validate status against known Healthie appointment statuses
        const validStatuses = [
            'Scheduled', 'Confirmed', 'Checked In',
            'In Progress', 'Completed', 'No Show', 'Cancelled'
        ];
        if (!validStatuses.includes(status)) {
            return NextResponse.json(
                { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
                { status: 400 }
            );
        }

        // Update appointment status in Healthie via GraphQL mutation
        const data = await healthieGraphQL<{
            updateAppointment: { appointment: { id: string; pm_status: string } };
        }>(`
            mutation UpdateAppointmentStatus($id: ID, $pm_status: String) {
                updateAppointment(input: { id: $id, pm_status: $pm_status }) {
                    appointment {
                        id
                        pm_status
                    }
                }
            }
        `, { id: appointment_id, pm_status: status });

        const updated = data?.updateAppointment?.appointment;
        if (!updated) {
            return NextResponse.json(
                { error: 'Healthie did not return updated appointment' },
                { status: 502 }
            );
        }

        return NextResponse.json({
            success: true,
            appointment_id: updated.id,
            status: updated.pm_status,
        });
    } catch (error) {
        console.error('[iPad Appointment Status] Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to update status' },
            { status: 500 }
        );
    }
}
