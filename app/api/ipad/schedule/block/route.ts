/**
 * iPad — Provider Schedule Block ("Break" button)
 *
 * Creates, lists, and removes Healthie "blocker" appointments (is_blocker=true).
 * Blockers are honored by ALL Healthie-connected systems:
 *   - abxtac.com booking pages (via Healthie availability API)
 *   - nowoptimal.com booking pages
 *   - Google Calendar sync
 *   - Healthie patient portal
 *   - Dashboard / iPad booking flow
 *
 * Any authenticated staff member may create a block for any provider.
 *
 * Endpoints:
 *   POST   /api/ipad/schedule/block/         — create block (single or recurring)
 *   GET    /api/ipad/schedule/block/?provider_id=&start_date=&end_date=  — list blocks
 *   DELETE /api/ipad/schedule/block/?id=     — remove block
 *
 * All times use America/Phoenix (no DST — Arizona).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { healthieGraphQL } from '@/lib/healthieApi';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TIMEZONE = 'America/Phoenix';

interface CreateBlockBody {
    provider_id: string;
    /** ISO8601 local or date+time — "2026-04-15T12:00" */
    start: string;
    /** ISO8601 local or date+time — "2026-04-15T13:00" */
    end: string;
    notes?: string;
    /** If set, create a recurring block */
    recurring?: {
        interval: 'Daily' | 'Weekly' | 'Monthly';
        /** Total occurrences including the first — e.g. 4 = this one + 3 more */
        times: number;
    };
}

/**
 * Normalize a local datetime string to ISO with Phoenix (-07:00) offset.
 * Arizona has no DST, so the offset is always -07:00.
 */
function toPhoenixISO(local: string): string {
    // Accept inputs like "2026-04-15T12:00" or "2026-04-15 12:00" or full ISO
    const cleaned = local.replace(' ', 'T').trim();
    // If it already has a tz offset or Z, leave it alone
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(cleaned)) return cleaned;
    // If it has seconds, keep them; if not, append :00
    const withSeconds = /T\d{2}:\d{2}:\d{2}/.test(cleaned) ? cleaned : `${cleaned}:00`;
    return `${withSeconds}-07:00`;
}

export async function POST(request: NextRequest) {
    try {
        const user = await requireApiUser(request, 'write');
        const body = (await request.json()) as CreateBlockBody;

        if (!body.provider_id || !body.start || !body.end) {
            return NextResponse.json(
                { error: 'provider_id, start, and end are required' },
                { status: 400 }
            );
        }

        const datetime = toPhoenixISO(body.start);
        const end_datetime = toPhoenixISO(body.end);

        if (new Date(end_datetime) <= new Date(datetime)) {
            return NextResponse.json({ error: 'end must be after start' }, { status: 400 });
        }

        const notes = (body.notes || 'Blocked time').slice(0, 500);

        const input: Record<string, unknown> = {
            is_blocker: true,
            datetime,
            end_datetime,
            timezone: TIMEZONE,
            provider_id: body.provider_id,
            notes,
            contact_type: 'In Person',
        };

        if (body.recurring && body.recurring.times > 1) {
            input.is_repeating = true;
            input.repeat_interval = body.recurring.interval;
            input.repeat_times = Math.min(body.recurring.times, 52); // safety cap
        }

        const mutation = `
            mutation CreateBlocker($input: createAppointmentInput!) {
                createAppointment(input: $input) {
                    appointment {
                        id
                        datetime
                        end_datetime
                        is_blocker
                        notes
                        provider { id full_name }
                    }
                    messages { field message }
                }
            }
        `;

        const result = await healthieGraphQL<{
            createAppointment: {
                appointment: { id: string; datetime: string; end_datetime: string; is_blocker: boolean; notes: string; provider: { id: string; full_name: string } } | null;
                messages: Array<{ field: string; message: string }>;
            };
        }>(mutation, { input });

        const msgs = result.createAppointment?.messages || [];
        if (msgs.length > 0 || !result.createAppointment?.appointment) {
            console.error('[schedule-block] Healthie rejected create:', msgs);
            return NextResponse.json(
                { error: 'Healthie rejected the block', details: msgs },
                { status: 400 }
            );
        }

        console.log(
            `[schedule-block] Created block #${result.createAppointment.appointment.id} for provider ${body.provider_id} by ${(user as any).email || 'staff'} (${datetime} → ${end_datetime})${body.recurring ? ` repeat ${body.recurring.interval}x${body.recurring.times}` : ''}`
        );

        return NextResponse.json({
            success: true,
            block: result.createAppointment.appointment,
            recurring: body.recurring || null,
        });
    } catch (error: any) {
        if (error instanceof UnauthorizedError || error?.status === 401) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.error('[schedule-block] POST error:', error);
        return NextResponse.json({ error: error?.message || 'Failed to create block' }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    try {
        await requireApiUser(request, 'read');

        const { searchParams } = new URL(request.url);
        const providerId = searchParams.get('provider_id');
        const startDate = searchParams.get('start_date');
        const endDate = searchParams.get('end_date');

        if (!providerId || !startDate || !endDate) {
            return NextResponse.json(
                { error: 'provider_id, start_date, and end_date are required' },
                { status: 400 }
            );
        }

        // Pull appointments in range, then filter to blockers client-side.
        // (Healthie's filter strings vary by API version; client-side filter is safe.)
        const q = `
            query GetBlockers($providerId: ID!, $start: String!, $end: String!) {
                appointments(
                    filter: "all",
                    provider_id: $providerId,
                    startDate: $start,
                    endDate: $end,
                    should_paginate: false
                ) {
                    id datetime end_datetime is_blocker notes
                    provider { id full_name }
                }
            }
        `;

        const data = await healthieGraphQL<{ appointments: any[] }>(q, {
            providerId,
            start: startDate,
            end: endDate,
        });

        const blocks = (data.appointments || []).filter((a) => a.is_blocker === true);

        return NextResponse.json({ success: true, blocks });
    } catch (error: any) {
        if (error instanceof UnauthorizedError || error?.status === 401) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.error('[schedule-block] GET error:', error);
        return NextResponse.json({ error: error?.message || 'Failed to fetch blocks' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const user = await requireApiUser(request, 'write');
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'id query param required' }, { status: 400 });
        }

        const mutation = `
            mutation DeleteBlock($input: deleteAppointmentInput!) {
                deleteAppointment(input: $input) {
                    appointment { id }
                    messages { field message }
                }
            }
        `;

        const result = await healthieGraphQL<{
            deleteAppointment: {
                appointment: { id: string } | null;
                messages: Array<{ field: string; message: string }>;
            };
        }>(mutation, { input: { id } });

        const msgs = result.deleteAppointment?.messages || [];
        if (msgs.length > 0) {
            console.error('[schedule-block] Healthie rejected delete:', msgs);
            return NextResponse.json(
                { error: 'Healthie rejected delete', details: msgs },
                { status: 400 }
            );
        }

        console.log(`[schedule-block] Deleted block #${id} by ${(user as any).email || 'staff'}`);

        return NextResponse.json({ success: true, id });
    } catch (error: any) {
        if (error instanceof UnauthorizedError || error?.status === 401) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.error('[schedule-block] DELETE error:', error);
        return NextResponse.json({ error: error?.message || 'Failed to delete block' }, { status: 500 });
    }
}
