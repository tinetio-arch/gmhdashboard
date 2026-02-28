import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/ipad/schedule
 * Lightweight schedule endpoint — ONLY fetches today's Healthie appointments
 * and cross-references with local patients. No Telegram, no email, no inventory.
 */
export async function GET(request: NextRequest) {
    try {
        await requireApiUser(request, 'read');
    } catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        // Fetch appointments from Healthie with a timeout
        let appointments: any[] = [];
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 12000);

            const data = await healthieGraphQL<{
                appointments: any[];
            }>(`
                query GetTodayAppointments($date: String) {
                    appointments(
                        filter_by_date_range: true,
                        date_from: $date,
                        date_to: $date,
                        should_paginate: false
                    ) {
                        id
                        date
                        appointment_type { name }
                        provider { full_name }
                        status
                        client {
                            id
                            first_name
                            last_name
                        }
                    }
                }
            `, { date: todayStr });

            clearTimeout(timeout);
            appointments = data?.appointments || [];
        } catch (err) {
            console.warn('[iPad Schedule] Healthie appointments fetch failed:', err instanceof Error ? err.message : err);
            // Return empty schedule rather than failing
            return NextResponse.json({
                success: true,
                patients: [],
                error: 'Could not reach Healthie — try again in a moment',
            });
        }

        if (appointments.length === 0) {
            return NextResponse.json({ success: true, patients: [] });
        }

        // Cross-reference with local patients
        const healthieIds = appointments
            .map(a => a.client?.id)
            .filter(Boolean);

        let patientMap = new Map<string, any>();
        if (healthieIds.length > 0) {
            try {
                const patients = await query<any>(
                    `SELECT patient_id, healthie_client_id, full_name, status_key
                     FROM patients WHERE healthie_client_id = ANY($1)`,
                    [healthieIds]
                );
                patientMap = new Map(patients.map((p: any) => [p.healthie_client_id, p]));
            } catch (err) {
                console.warn('[iPad Schedule] Patient cross-ref failed:', err);
            }
        }

        const result = appointments.map(appt => {
            const healthieId = appt.client?.id || '';
            const local = patientMap.get(healthieId);
            return {
                healthie_id: healthieId,
                patient_id: local?.patient_id || null,
                full_name: local?.full_name || `${appt.client?.first_name || ''} ${appt.client?.last_name || ''}`.trim(),
                appointment_type: appt.appointment_type?.name || 'Appointment',
                provider: appt.provider?.full_name || '',
                appointment_status: appt.status || 'unknown',
                time: appt.date ? new Date(appt.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '',
            };
        });

        return NextResponse.json({ success: true, patients: result });
    } catch (error) {
        console.error('[iPad Schedule] Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to load schedule' },
            { status: 500 }
        );
    }
}
