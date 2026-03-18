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

        // DIAGNOSTIC: Log environment
        console.log('[iPad Schedule] HEALTHIE_API_KEY present:', !!HEALTHIE_API_KEY, 'length:', HEALTHIE_API_KEY?.length || 0);
        console.log('[iPad Schedule] HEALTHIE_API_URL:', HEALTHIE_API_URL);

        // Build GraphQL query — try multiple approaches to find today's appointments
        let appointments: any[] = [];

        // Use specificDay to fetch ONLY today's appointments (instead of all 5000+)
        // Also filter by provider_id at API level when available
        const appointmentQuery = providerId
            ? `query GetAppointments($providerId: ID!, $day: String!) {
                appointments(
                    filter: "all",
                    provider_id: $providerId,
                    specificDay: $day,
                    should_paginate: false,
                    is_with_clients: true
                ) {
                    id date length pm_status location other_party_id
                    appointment_type { name }
                    provider { id full_name }
                    attendees { id first_name last_name }
                    user { id first_name last_name }
                    contact_type
                }
            }`
            : `query GetAppointments($day: String!) {
                appointments(
                    filter: "all",
                    specificDay: $day,
                    should_paginate: false,
                    is_with_clients: true
                ) {
                    id date length pm_status location other_party_id
                    appointment_type { name }
                    provider { id full_name }
                    attendees { id first_name last_name }
                    user { id first_name last_name }
                    contact_type
                }
            }`;

        const variables: Record<string, string> = providerId
            ? { providerId, day: todayStr }
            : { day: todayStr };

        // Direct fetch with AbortController
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

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
                // specificDay already filters to today at the API level — no client-side filtering needed
                appointments = result.data?.appointments || [];
                console.log(`[iPad Schedule] Fetched ${appointments.length} appointments for ${todayStr} (specificDay filter, provider: ${providerId || 'all'})`);
            } else {
                console.warn('[iPad Schedule] HTTP', response.status);
            }
        } catch (err: any) {
            clearTimeout(timeout);
            console.warn('[iPad Schedule] Fetch error:', err.name === 'AbortError' ? 'timeout' : err.message);
            return NextResponse.json({ success: true, patients: [], error: 'Could not reach Healthie — try again' });
        }

        // Filter out entries with no patient (Breaks, holds, blocked time, etc.)
        appointments = appointments.filter((a: any) => {
            // ONLY include appointments with actual attendees or user (NOT other_party_id alone, as that's often the provider)
            if (a.attendees?.length > 0 || a.user) return true;
            // Skip entries with no patient data (Breaks, blocked time, or other_party_id = provider)
            console.log('[iPad Schedule] Skipping no-patient entry:', a.appointment_type?.name || 'unknown type',
                a.location || '',
                a.other_party_id ? `(other_party=${a.other_party_id})` : '',
                `provider=${a.provider?.id || 'none'}:${a.provider?.full_name || 'none'}`
            );
            return false;
        });

        if (appointments.length === 0) {
            return NextResponse.json({ success: true, patients: [] });
        }

        // Cross-reference with local patients
        const healthieIds = appointments.map(a => a.attendees?.[0]?.id || a.user?.id).filter(Boolean);
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
                console.log(`[iPad Schedule] Cross-referenced ${patients.length} patients from ${healthieIds.length} healthie IDs`);
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
            // If we have healthieId but no name, we'll need to fetch from Healthie (will be handled in batch below)
            const resolvedName = local?.full_name || attendeeName || userName || '';
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

        // Log what we have after mapping
        console.log(`[iPad Schedule] Mapped ${result.length} patient appointments`);
        if (result.length > 0) {
            console.log(`[iPad Schedule] Sample result:`, JSON.stringify(result[0]));
        }

        // Fetch names from Healthie for any patients without names
        const missingNames = result.filter(r => r.healthie_id && !r.full_name);
        if (missingNames.length > 0) {
            console.log(`[iPad Schedule] Fetching names from Healthie for ${missingNames.length} patients without names`);
            try {
                for (const item of missingNames) {
                    const userQuery = `query { user(id: "${item.healthie_id}") { id first_name last_name } }`;
                    const resp = await fetch(HEALTHIE_API_URL, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                            'AuthorizationSource': 'API',
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ query: userQuery }),
                        signal: AbortSignal.timeout(5000),
                    });
                    if (resp.ok) {
                        const userData = await resp.json();
                        const user = userData.data?.user;
                        if (user) {
                            item.full_name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unknown Patient';
                        }
                    }
                }
            } catch (err) {
                console.warn('[iPad Schedule] Failed to fetch patient names from Healthie:', err);
            }
        }

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
