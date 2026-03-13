import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';

/**
 * GET /api/ipad/schedule?provider_id=12088269
 * Fetches today's Healthie appointments, optionally filtered by provider.
 * 
 * Query params:
 *   - provider_id (optional): Healthie provider ID to filter by
 *   - date (optional): Override date (YYYY-MM-DD), defaults to today (Phoenix TZ)
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
        const { searchParams } = new URL(request.url);
        const providerId = searchParams.get('provider_id') || null;
        const dateOverride = searchParams.get('date') || null;

        const todayStr = dateOverride || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });

        // Build GraphQL query — try multiple approaches to find today's appointments
        let appointments: any[] = [];

        // Primary query: use date range WITHOUT is_active (which was filtering out results)
        const appointmentQuery = providerId
            ? `query GetAppointments($startDate: String, $endDate: String, $providerId: ID) {
                appointments(
                    startDate: $startDate,
                    endDate: $endDate,
                    provider_id: $providerId,
                    should_paginate: false
                ) {
                    id date length pm_status location
                    appointment_type { name }
                    provider { id full_name }
                    attendees { id first_name last_name }
                    user { id first_name last_name }
                    contact_type
                }
            }`
            : `query GetAppointments($startDate: String, $endDate: String) {
                appointments(
                    startDate: $startDate,
                    endDate: $endDate,
                    should_paginate: false
                ) {
                    id date length pm_status location
                    appointment_type { name }
                    provider { id full_name }
                    attendees { id first_name last_name }
                    user { id first_name last_name }
                    contact_type
                }
            }`;

        const variables: Record<string, string> = { startDate: todayStr, endDate: todayStr };
        if (providerId) variables.providerId = providerId;

        // Direct fetch with AbortController
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(HEALTHIE_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                    'AuthorizationSource': 'API',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query: appointmentQuery, variables }),
                signal: controller.signal,
            });

            clearTimeout(timeout);

            if (response.ok) {
                const result = await response.json();
                if (result.errors) {
                    console.error('[iPad Schedule] Healthie errors:', JSON.stringify(result.errors));
                }
                appointments = result.data?.appointments || [];
                console.log('[iPad Schedule] Fetched', appointments.length, 'appointments for', todayStr, providerId ? `(provider: ${providerId})` : '(all)');
            } else {
                console.warn('[iPad Schedule] HTTP', response.status);
            }
        } catch (err: any) {
            clearTimeout(timeout);
            console.warn('[iPad Schedule] Fetch error:', err.name === 'AbortError' ? 'timeout' : err.message);
            return NextResponse.json({ success: true, patients: [], error: 'Could not reach Healthie — try again' });
        }

        // Fallback: if 0 results, try with filter=upcoming and wider date range
        if (appointments.length === 0) {
            console.log('[iPad Schedule] 0 results with date range, trying fallback with filter...');
            const fallbackQuery = `query GetAppointments {
                appointments(
                    filter: "upcoming",
                    should_paginate: false
                ) {
                    id date length pm_status location
                    appointment_type { name }
                    provider { id full_name }
                    attendees { id first_name last_name }
                    user { id first_name last_name }
                    contact_type
                }
            }`;

            const controller2 = new AbortController();
            const timeout2 = setTimeout(() => controller2.abort(), 10000);
            try {
                const response2 = await fetch(HEALTHIE_API_URL, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                        'AuthorizationSource': 'API',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ query: fallbackQuery }),
                    signal: controller2.signal,
                });
                clearTimeout(timeout2);

                if (response2.ok) {
                    const result2 = await response2.json();
                    if (result2.errors) {
                        console.error('[iPad Schedule] Fallback errors:', JSON.stringify(result2.errors));
                    }
                    const allUpcoming = result2.data?.appointments || [];
                    // Filter to today only
                    appointments = allUpcoming.filter((a: any) => {
                        if (!a.date) return false;
                        const apptDate = new Date(a.date).toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });
                        return apptDate === todayStr;
                    });
                    // If provider filter, apply it
                    if (providerId) {
                        appointments = appointments.filter((a: any) => a.provider?.id === providerId);
                    }
                    console.log('[iPad Schedule] Fallback found', allUpcoming.length, 'upcoming,', appointments.length, 'for today');
                    // Debug: log first appointment structure
                    if (appointments.length > 0) {
                        console.log('[iPad Schedule] Sample appt:', JSON.stringify(appointments[0]));
                    }
                }
            } catch (err: any) {
                clearTimeout(timeout2);
                console.warn('[iPad Schedule] Fallback error:', err.name === 'AbortError' ? 'timeout' : err.message);
            }
        }

        // Filter out entries with no patient (Breaks, holds, blocked time, etc.)
        appointments = appointments.filter((a: any) => {
            // Has at least one attendee OR a user object
            if (a.attendees?.length > 0 || a.user) return true;
            // Skip entries with no patient data (Breaks, blocked time)
            console.log('[iPad Schedule] Skipping no-patient entry:', a.appointment_type?.name || 'unknown type', a.location || '');
            return false;
        });

        if (appointments.length === 0) {
            return NextResponse.json({ success: true, patients: [] });
        }

        // Cross-reference with local patients
        const healthieIds = appointments.map(a => a.attendees?.[0]?.id).filter(Boolean);
        let patientMap = new Map<string, any>();
        if (healthieIds.length > 0) {
            try {
                const patients = await query<any>(
                    `SELECT p.patient_id, hc.healthie_client_id, p.full_name, p.status_key
                     FROM healthie_clients hc
                     JOIN patients p ON p.patient_id::text = hc.patient_id
                     WHERE hc.healthie_client_id = ANY($1) AND hc.is_active = true`,
                    [healthieIds]
                );
                patientMap = new Map(patients.map((p: any) => [p.healthie_client_id, p]));
            } catch (err) {
                console.warn('[iPad Schedule] Patient cross-ref failed:', err);
            }
        }

        const result = appointments.map(appt => {
            const attendee = appt.attendees?.[0];
            const user = appt.user;
            const healthieId = attendee?.id || user?.id || '';
            const local = patientMap.get(healthieId);
            // Try multiple name sources: local DB > attendee name > user name
            const attendeeName = `${attendee?.first_name || ''} ${attendee?.last_name || ''}`.trim();
            const userName = `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
            const resolvedName = local?.full_name || attendeeName || userName || 'Unknown';
            return {
                appointment_id: appt.id,
                healthie_id: healthieId,
                patient_id: local?.patient_id || null,
                full_name: resolvedName,
                appointment_type: appt.appointment_type?.name || 'Appointment',
                provider: appt.provider?.full_name || '',
                provider_id: appt.provider?.id || '',
                appointment_status: appt.pm_status || 'Scheduled',
                time: appt.date ? new Date(appt.date).toLocaleTimeString('en-US', {
                    hour: 'numeric', minute: '2-digit', timeZone: 'America/Phoenix'
                }) : '',
                date: appt.date || '',
                length: appt.length || null,
                location: appt.location || '',
            };
        });

        // Sort by appointment time
        result.sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());

        return NextResponse.json({ success: true, patients: result });
    } catch (error) {
        console.error('[iPad Schedule] Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to load schedule' },
            { status: 500 }
        );
    }
}
