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

/**
 * PUT /api/ipad/appointment-status
 * Edit an existing appointment. All fields except appointment_id are optional —
 * only fields that are provided are forwarded to Healthie. Supports changing:
 *   - datetime (reschedule)
 *   - provider_id           → Healthie other_party_id
 *   - appointment_type_id
 *   - contact_type          ('In Person' | 'Healthie Video Call' | 'Phone Call')
 *   - location              (free-text location label)
 *   - length                (minutes, 5–120; converted to end_time in Phoenix TZ)
 *   - notes
 */
export async function PUT(request: NextRequest) {
    try {
        await requireApiUser(request, 'write');
    } catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const body = await request.json();
        const {
            appointment_id,
            datetime,
            provider_id,
            location,
            contact_type,
            appointment_type_id,
            length,
            notes,
        } = body as {
            appointment_id?: string;
            datetime?: string;
            provider_id?: string;
            location?: string;
            contact_type?: string;
            appointment_type_id?: string;
            length?: number;
            notes?: string;
        };

        if (!appointment_id) {
            return NextResponse.json({ error: 'appointment_id is required' }, { status: 400 });
        }

        const input: Record<string, unknown> = { id: appointment_id };
        let needsTimezone = false;
        if (datetime) { input.datetime = datetime; needsTimezone = true; }
        if (provider_id) input.other_party_id = provider_id;
        if (location !== undefined) input.location = location;
        if (contact_type) input.contact_type = contact_type;
        if (appointment_type_id) input.appointment_type_id = appointment_type_id;
        if (notes !== undefined) input.notes = notes;

        // Length → end_time. Healthie wants the local-TZ ISO of the new end.
        if (length !== undefined && length !== null) {
            const lengthMin = Math.floor(Number(length));
            if (!Number.isFinite(lengthMin) || lengthMin < 5 || lengthMin > 120) {
                return NextResponse.json({ error: 'length must be a number between 5 and 120 minutes' }, { status: 400 });
            }

            // Need a start instant. Prefer the one we're setting, otherwise fetch current.
            let startMs: number;
            if (datetime) {
                startMs = Date.parse(datetime);
            } else {
                const cur = await healthieGraphQL<{ appointment: { date: string } | null }>(
                    `query GetAppt($id: ID) { appointment(id: $id) { date } }`,
                    { id: appointment_id }
                );
                const startStr = cur?.appointment?.date;
                if (!startStr) {
                    return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
                }
                startMs = Date.parse(startStr);
            }
            if (!Number.isFinite(startMs)) {
                return NextResponse.json({ error: 'Invalid appointment start datetime' }, { status: 400 });
            }

            const endMs = startMs + lengthMin * 60_000;
            const d = new Date(endMs);
            const az = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'America/Phoenix',
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
            }).formatToParts(d).reduce((o: Record<string, string>, p) => { o[p.type] = p.value; return o; }, {});
            // Phoenix is UTC-07 year-round (no DST).
            input.end_time = `${az.year}-${az.month}-${az.day}T${az.hour === '24' ? '00' : az.hour}:${az.minute}:${az.second}-07:00`;
            needsTimezone = true;
        }

        if (needsTimezone) input.timezone = 'America/Phoenix';

        // Bail out early if nothing besides id was supplied.
        if (Object.keys(input).length <= 1) {
            return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 });
        }

        const data = await healthieGraphQL<{
            updateAppointment: {
                appointment: {
                    id: string;
                    date: string;
                    length: number | null;
                    contact_type: string | null;
                    location: string | null;
                    notes: string | null;
                    appointment_type: { id: string; name: string } | null;
                    provider: { id: string; full_name: string } | null;
                } | null;
                messages: Array<{ field: string; message: string }>;
            };
        }>(`
            mutation EditAppointment($input: updateAppointmentInput!) {
                updateAppointment(input: $input) {
                    appointment {
                        id
                        date
                        length
                        contact_type
                        location
                        notes
                        appointment_type { id name }
                        provider { id full_name }
                    }
                    messages { field message }
                }
            }
        `, { input });

        if (data.updateAppointment?.messages?.length) {
            const errMsg = data.updateAppointment.messages.map(m => m.message).join(', ');
            return NextResponse.json({ error: errMsg }, { status: 400 });
        }

        const appt = data.updateAppointment?.appointment;
        console.log(
            `[iPad Appointment Edit] Updated ${appointment_id}: ${Object.keys(input).filter(k => k !== 'id' && k !== 'timezone').join(', ')}`
        );

        return NextResponse.json({ success: true, appointment: appt });
    } catch (error) {
        console.error('[iPad Appointment Edit] Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to update appointment' },
            { status: 500 }
        );
    }
}
