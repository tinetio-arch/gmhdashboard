import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';

/**
 * GET /api/ipad/schedule?provider_id=12088269
 * Fetches Healthie appointments, optionally filtered by provider and date range.
 *
 * Query params:
 *   - provider_id (optional): Healthie provider ID to filter by
 *   - date (optional): Override date (YYYY-MM-DD), defaults to today (Phoenix TZ)
 *   - start_date (optional): Range start (YYYY-MM-DD) — if set, fetches each day in range
 *   - end_date (optional): Range end (YYYY-MM-DD) — required with start_date
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
        const startDate = searchParams.get('start_date') || null;
        const endDate = searchParams.get('end_date') || null;

        const todayStr = dateOverride || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });

        // Build list of days to fetch
        let daysToFetch: string[] = [];
        if (startDate && endDate) {
            const start = new Date(startDate + 'T00:00:00');
            const end = new Date(endDate + 'T00:00:00');
            // Cap at 31 days to prevent abuse
            const maxDays = 31;
            let d = new Date(start);
            let count = 0;
            while (d <= end && count < maxDays) {
                daysToFetch.push(d.toISOString().split('T')[0]);
                d.setDate(d.getDate() + 1);
                count++;
            }
        } else {
            daysToFetch = [todayStr];
        }

        console.log('[iPad Schedule] Fetching', daysToFetch.length, 'day(s):', daysToFetch[0], daysToFetch.length > 1 ? '...' + daysToFetch[daysToFetch.length - 1] : '');

        // Build GraphQL query — try multiple approaches to find today's appointments
        let appointments: any[] = [];

        // Use specificDay to fetch ONLY today's appointments (instead of all 5000+)
        // Also filter by provider_id at API level when available
        // FIX(2026-03-19): Healthie API key only returns the key owner's appointments.
        // Must query each provider separately and combine results.
        const PROVIDER_IDS = [
            '12088269',  // Phil Schafer NP
            '12093125',  // Aaron Whitten (Dr. Whitten)
        ];

        const appointmentQuery = `query GetAppointments($providerId: ID!, $day: String!) {
                appointments(
                    filter: "all",
                    provider_id: $providerId,
                    specificDay: $day,
                    should_paginate: false
                ) {
                    id date length pm_status location other_party_id
                    appointment_type { name }
                    provider { id full_name }
                    attendees { id first_name last_name }
                    user { id first_name last_name }
                    contact_type
                }
            }`;

        // Fetch appointments for a provider on a specific day
        const fetchProviderAppts = async (provId: string, day: string) => {
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
                    body: JSON.stringify({
                        query: appointmentQuery,
                        variables: { providerId: provId, day },
                    }),
                    signal: controller.signal,
                    cache: 'no-store',
                } as any);
                clearTimeout(timeout);
                if (response.ok) {
                    const result = await response.json();
                    return result.data?.appointments || [];
                }
                return [];
            } catch {
                clearTimeout(timeout);
                return [];
            }
        };

        try {
            // Fetch all days x all providers in parallel (capped to avoid overwhelming API)
            const fetchPromises: Promise<any[]>[] = [];
            for (const day of daysToFetch) {
                for (const provId of PROVIDER_IDS) {
                    fetchPromises.push(fetchProviderAppts(provId, day));
                }
            }
            const allResults = await Promise.all(fetchPromises);
            // Combine and deduplicate by appointment ID
            const seenIds = new Set<string>();
            for (const provAppts of allResults) {
                for (const appt of provAppts) {
                    if (!seenIds.has(appt.id)) {
                        seenIds.add(appt.id);
                        appointments.push(appt);
                    }
                }
            }
            console.log(`[iPad Schedule] Fetched ${appointments.length} appointments for ${daysToFetch.length} day(s) across ${PROVIDER_IDS.length} providers`);
        } catch (err: any) {
            console.warn('[iPad Schedule] Fetch error:', err.message);
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
                appointment_status: appt.pm_status && appt.pm_status !== 'None' ? appt.pm_status : 'Scheduled',
                time: appt.date ? new Date(appt.date).toLocaleTimeString('en-US', {
                    hour: 'numeric', minute: '2-digit', timeZone: 'America/Phoenix'
                }) : '',
                date: appt.date || '',
                length: appt.length || null,
                location: appt.location || '',
                contact_type: appt.contact_type || 'In Person',
            };
        });

        // Log what we have after mapping
        console.log(`[iPad Schedule] Mapped ${result.length} patient appointments`);
        if (result.length > 0) {
            console.log(`[iPad Schedule] Sample result:`, JSON.stringify(result[0]));
        }

        // FIX: Batch fetch names from Healthie instead of N+1 individual queries
        const missingNames = result.filter(r => r.healthie_id && !r.full_name);
        if (missingNames.length > 0) {
            console.log(`[iPad Schedule] Fetching names from Healthie for ${missingNames.length} patients without names`);
            try {
                // Batch: fetch up to 10 at a time using individual queries in parallel
                const batchSize = 10;
                for (let i = 0; i < missingNames.length; i += batchSize) {
                    const batch = missingNames.slice(i, i + batchSize);
                    const promises = batch.map(async (item) => {
                        const resp = await fetch(HEALTHIE_API_URL, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                                'AuthorizationSource': 'API',
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                query: `query GetUser($id: ID) { user(id: $id) { id first_name last_name } }`,
                                variables: { id: item.healthie_id },
                            }),
                            signal: AbortSignal.timeout(5000),
                            cache: 'no-store',
                        } as any);
                        if (resp.ok) {
                            const userData = await resp.json();
                            const user = userData.data?.user;
                            if (user) {
                                item.full_name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unknown Patient';
                            }
                        }
                    });
                    await Promise.allSettled(promises);
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

/**
 * POST /api/ipad/schedule
 * Create a new appointment in Healthie or fetch appointment types.
 *
 * Body:
 *   - action: 'create' | 'get_appointment_types' | 'search_patients'
 *
 *   For 'create':
 *     - patient_id: string (Healthie user ID)
 *     - provider_id: string (Healthie provider ID)
 *     - appointment_type_id: string
 *     - datetime: string (ISO 8601)
 *     - length: number (minutes, optional)
 *     - location: string (optional)
 *     - contact_type: string (optional, e.g. 'In-Person', 'Telehealth')
 *
 *   For 'get_appointment_types':
 *     (no extra params)
 *
 *   For 'search_patients':
 *     - search: string
 */
export async function POST(request: NextRequest) {
    try {
        await requireApiUser(request, 'write');
    } catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const body = await request.json();
        const { action } = body;

        if (action === 'get_appointment_types') {
            // FIX(2026-03-25): Healthie removed is_visible from AppointmentType; use clients_can_book
            const data = await healthieGraphQL<{
                appointmentTypes: Array<{
                    id: string;
                    name: string;
                    length: number;
                    available_contact_types: string[];
                    clients_can_book: boolean;
                }>;
            }>(`
                query GetAppointmentTypes {
                    appointmentTypes {
                        id name length
                        available_contact_types
                        clients_can_book
                    }
                }
            `);

            // Map appointment types to their clinic/brand groups based on name patterns
            const getClinicGroup = (name: string): string => {
                const nameLower = name.toLowerCase();

                // Men's Health patterns
                if (nameLower.includes('male hormone') ||
                    nameLower.includes('nmh ') ||
                    nameLower.includes('trt ') ||
                    nameLower.includes('mens health')) {
                    return 'NowMensHealth.Care';
                }

                // Primary Care patterns
                if (nameLower.includes('primary care') ||
                    nameLower.includes('sick visit') ||
                    nameLower.includes('sick consult') ||
                    nameLower.includes('sports physical') ||
                    nameLower.includes('medical clearance') ||
                    nameLower.includes('tb test') ||
                    nameLower.includes('wound care') ||
                    nameLower.includes('allergy') ||
                    nameLower.includes('injection') ||
                    nameLower.includes('nowprimary') ||
                    nameLower.includes('female hormone')) {
                    return 'NowPrimary.Care';
                }

                // Longevity patterns
                if (nameLower.includes('pelleting') ||
                    nameLower.includes('evexipel') ||
                    nameLower.includes('weight loss') ||
                    nameLower.includes('longevity') ||
                    nameLower.includes('iv therapy') ||
                    nameLower.includes('peptide')) {
                    return 'NowLongevity.Care';
                }

                // Mental Health patterns
                if (nameLower.includes('mental health') ||
                    nameLower.includes('therapy') ||
                    nameLower.includes('psychiatric') ||
                    nameLower.includes('ketamine')) {
                    return 'NowMentalHealth.Care';
                }

                // ABX TAC patterns
                if (nameLower.includes('abx tac')) {
                    return 'ABXTAC';
                }

                // Default to General if no match
                return 'General';
            };

            // Group appointment types by clinic
            const groupedTypes: Record<string, Array<any>> = {};

            (data.appointmentTypes || []).forEach(t => {
                const clinicGroup = getClinicGroup(t.name);

                if (!groupedTypes[clinicGroup]) {
                    groupedTypes[clinicGroup] = [];
                }

                groupedTypes[clinicGroup].push({
                    id: t.id,
                    name: t.name,
                    length: t.length,
                    contact_types: t.available_contact_types || [],
                    clinic_group: clinicGroup,
                });
            });

            // Sort groups alphabetically, but put General last
            const sortedGroups = Object.keys(groupedTypes).sort((a, b) => {
                if (a === 'General') return 1;
                if (b === 'General') return -1;
                return a.localeCompare(b);
            });

            // Build the response with grouped types
            const groupedResponse = sortedGroups.map(group => ({
                group_name: group,
                appointment_types: groupedTypes[group].sort((a, b) => a.name.localeCompare(b.name))
            }));

            // Also include flat array for backwards compatibility
            const types = (data.appointmentTypes || [])
                .map(t => ({
                    id: t.id,
                    name: t.name,
                    length: t.length,
                    contact_types: t.available_contact_types || [],
                    clinic_group: getClinicGroup(t.name),
                }));

            return NextResponse.json({
                success: true,
                appointment_types: types,
                grouped_appointment_types: groupedResponse
            });
        }

        if (action === 'search_patients') {
            const { search } = body;
            if (!search?.trim()) {
                return NextResponse.json({ error: 'search is required' }, { status: 400 });
            }

            // Search local DB first for fast results
            const patients = await query<any>(
                `SELECT p.patient_id, p.full_name, p.email, p.phone, p.status_key,
                        hc.healthie_client_id
                 FROM patients p
                 LEFT JOIN healthie_clients hc ON hc.patient_id = p.patient_id::text AND hc.is_active = true
                 WHERE p.full_name ILIKE $1 OR p.email ILIKE $1
                 ORDER BY p.full_name
                 LIMIT 20`,
                [`%${search.trim()}%`]
            );

            return NextResponse.json({
                success: true,
                patients: patients.map((p: any) => ({
                    patient_id: p.patient_id,
                    healthie_id: p.healthie_client_id || null,
                    full_name: p.full_name,
                    email: p.email,
                    phone: p.phone,
                    status: p.status_key,
                })),
            });
        }

        if (action === 'create') {
            const { patient_id, provider_id, appointment_type_id, datetime, length, location, contact_type } = body;

            if (!patient_id || !provider_id || !appointment_type_id || !datetime) {
                return NextResponse.json({
                    error: 'patient_id, provider_id, appointment_type_id, and datetime are required'
                }, { status: 400 });
            }

            const data = await healthieGraphQL<{
                createAppointment: {
                    appointment: {
                        id: string;
                        date: string;
                        appointment_type: { name: string } | null;
                        provider: { full_name: string } | null;
                    } | null;
                    messages: Array<{ field: string; message: string }>;
                };
            }>(`
                mutation CreateAppointment(
                    $patientId: String!,
                    $providerId: String!,
                    $typeId: String!,
                    $datetime: String!,
                    $location: String,
                    $contactType: String
                ) {
                    createAppointment(input: {
                        user_id: $patientId,
                        other_party_id: $providerId,
                        providers: $providerId,
                        appointment_type_id: $typeId,
                        datetime: $datetime,
                        location: $location,
                        contact_type: $contactType
                    }) {
                        appointment {
                            id date
                            appointment_type { name }
                            provider { full_name }
                        }
                        messages { field message }
                    }
                }
            `, {
                patientId: patient_id,
                providerId: provider_id,
                typeId: appointment_type_id,
                datetime,
                location: location || null,
                contactType: contact_type || null,
            });

            if (data.createAppointment?.messages?.length) {
                const errMsg = data.createAppointment.messages.map(m => m.message).join(', ');
                return NextResponse.json({ error: errMsg }, { status: 400 });
            }

            const appt = data.createAppointment?.appointment;
            console.log('[iPad Schedule] Created appointment:', appt?.id, 'for patient', patient_id);

            return NextResponse.json({
                success: true,
                appointment: appt ? {
                    id: appt.id,
                    date: appt.date,
                    type: appt.appointment_type?.name || 'Appointment',
                    provider: appt.provider?.full_name || '',
                } : null,
            });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error) {
        console.error('[iPad Schedule] POST Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to process request' },
            { status: 500 }
        );
    }
}
