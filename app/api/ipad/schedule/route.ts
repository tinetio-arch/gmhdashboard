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
        const todayStr = today.toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });

        // Fetch appointments from Healthie — try rate-limited client first, fallback to direct fetch
        let appointments: any[] = [];
        const appointmentQuery = `
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
                    pm_status
                    client {
                        id
                        first_name
                        last_name
                    }
                }
            }
        `;

        try {
            const data = await healthieGraphQL<{
                appointments: any[];
            }>(appointmentQuery, { date: todayStr });

            appointments = data?.appointments || [];
        } catch (err) {
            console.warn('[iPad Schedule] healthieGraphQL failed, trying direct fetch:', err instanceof Error ? err.message : err);

            // Fallback: direct fetch (bypasses rate limiter, like patient-chart route does)
            try {
                const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
                const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';

                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);

                const response = await fetch(HEALTHIE_API_URL, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                        'AuthorizationSource': 'API',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        query: appointmentQuery,
                        variables: { date: todayStr },
                    }),
                    signal: controller.signal,
                });

                clearTimeout(timeout);

                if (response.ok) {
                    const result = await response.json();
                    appointments = result.data?.appointments || [];
                    console.log('[iPad Schedule] Direct fetch succeeded:', appointments.length, 'appointments');
                } else {
                    console.warn('[iPad Schedule] Direct fetch HTTP', response.status);
                }
            } catch (directErr) {
                console.warn('[iPad Schedule] Direct fetch also failed:', directErr instanceof Error ? directErr.message : directErr);
                return NextResponse.json({
                    success: true,
                    patients: [],
                    error: 'Could not reach Healthie — try again in a moment',
                });
            }
        }

        if (appointments.length === 0) {
            return NextResponse.json({ success: true, patients: [] });
        }

        // Cross-reference with local patients using CANONICAL healthie_clients table
        const healthieIds = appointments
            .map(a => a.client?.id)
            .filter(Boolean);

        let patientMap = new Map<string, any>();
        if (healthieIds.length > 0) {
            try {
                const patients = await query<any>(
                    `SELECT p.patient_id, hc.healthie_client_id, p.full_name, p.status_key
                     FROM healthie_clients hc
                     JOIN patients p ON p.patient_id = hc.patient_id
                     WHERE hc.healthie_client_id = ANY($1) AND hc.is_active = true`,
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
                appointment_id: appt.id,
                healthie_id: healthieId,
                patient_id: local?.patient_id || null,
                full_name: local?.full_name || `${appt.client?.first_name || ''} ${appt.client?.last_name || ''}`.trim(),
                appointment_type: appt.appointment_type?.name || 'Appointment',
                provider: appt.provider?.full_name || '',
                appointment_status: appt.pm_status || 'Scheduled',
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
