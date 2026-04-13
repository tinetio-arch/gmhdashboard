/**
 * iPad — Appointment Requests (pending approval over blocked time)
 *
 * POST   /api/ipad/schedule/request/          — create a pending request
 * GET    /api/ipad/schedule/request/?status=pending&provider_id=&date_from=&date_to=
 *                                              — list requests (filterable)
 *
 * Approve / deny live at /api/ipad/schedule/request/decide/ to keep
 * verb-level routing explicit.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface CreateRequestBody {
    patient_healthie_id: string;
    patient_name?: string;
    provider_id: string;
    provider_name?: string;
    appointment_type_id: string;
    appointment_type_name?: string;
    datetime: string;          // ISO with TZ offset, e.g. "2026-04-14T10:00:00-07:00"
    length_minutes?: number;
    contact_type?: string;
    location?: string;
    location_id?: string;
    notes?: string;
    block_id: string;
    block_reason?: string;
}

export async function POST(request: NextRequest) {
    try {
        const user = await requireApiUser(request, 'write');
        const body = (await request.json()) as CreateRequestBody;

        if (!body.patient_healthie_id || !body.provider_id || !body.appointment_type_id || !body.datetime || !body.block_id) {
            return NextResponse.json(
                { error: 'patient_healthie_id, provider_id, appointment_type_id, datetime, and block_id are required' },
                { status: 400 }
            );
        }

        const actor = (user as any).email || 'staff';

        const [row] = await query<any>(
            `INSERT INTO appointment_requests
               (patient_healthie_id, patient_name, provider_id, provider_name,
                appointment_type_id, appointment_type_name, datetime, length_minutes,
                contact_type, location, location_id, notes,
                block_id, block_reason, requested_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
             RETURNING *`,
            [
                body.patient_healthie_id,
                body.patient_name || null,
                body.provider_id,
                body.provider_name || null,
                body.appointment_type_id,
                body.appointment_type_name || null,
                body.datetime,
                body.length_minutes || 30,
                body.contact_type || null,
                body.location || null,
                body.location_id || null,
                body.notes || null,
                body.block_id,
                body.block_reason || null,
                actor,
            ]
        );

        console.log(
            `[appt-request] Created #${row.request_id} by ${actor} — patient=${body.patient_name || body.patient_healthie_id} provider=${body.provider_name || body.provider_id} at ${body.datetime}`
        );

        return NextResponse.json({ success: true, request: row });
    } catch (error: any) {
        if (error instanceof UnauthorizedError || error?.status === 401) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.error('[appt-request] POST error:', error);
        return NextResponse.json({ error: error?.message || 'Failed to create request' }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    try {
        await requireApiUser(request, 'read');

        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status') || 'pending';
        const providerId = searchParams.get('provider_id');
        const dateFrom = searchParams.get('date_from');
        const dateTo = searchParams.get('date_to');
        const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10), 500);

        const where: string[] = [];
        const args: any[] = [];
        let i = 1;

        if (status !== 'all') {
            where.push(`status = $${i++}`);
            args.push(status);
        }
        if (providerId) {
            where.push(`provider_id = $${i++}`);
            args.push(providerId);
        }
        if (dateFrom) {
            where.push(`datetime >= $${i++}`);
            args.push(dateFrom);
        }
        if (dateTo) {
            where.push(`datetime <= $${i++}`);
            args.push(dateTo);
        }

        const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
        const sql = `
            SELECT request_id, patient_healthie_id, patient_name, provider_id, provider_name,
                   appointment_type_id, appointment_type_name, datetime, length_minutes,
                   contact_type, location, location_id, notes,
                   block_id, block_reason, requested_by, requested_at,
                   status, decided_by, decided_at, decision_notes, healthie_appointment_id
            FROM appointment_requests
            ${whereSql}
            ORDER BY datetime ASC, requested_at ASC
            LIMIT ${limit}
        `;

        const rows = await query<any>(sql, args);

        return NextResponse.json({ success: true, requests: rows, count: rows.length });
    } catch (error: any) {
        if (error instanceof UnauthorizedError || error?.status === 401) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.error('[appt-request] GET error:', error);
        return NextResponse.json({ error: error?.message || 'Failed to list requests' }, { status: 500 });
    }
}
