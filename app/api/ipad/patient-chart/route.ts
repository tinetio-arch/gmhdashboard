import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Fetch comprehensive patient chart data from Healthie for the scribe chart panel.
// Combines local DB data with Healthie GraphQL for a full picture.
export async function GET(request: NextRequest) {
    try { await requireApiUser(request, 'read'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patient_id');

    if (!patientId) {
        return NextResponse.json({ success: false, error: 'patient_id is required' }, { status: 400 });
    }

    try {
        // 1. Look up patient in local DB
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patientId);
        let patient: any = null;
        if (isUuid) {
            const rows = await query<any>('SELECT * FROM patients WHERE patient_id = $1::uuid', [patientId]);
            patient = rows?.[0] || null;
        }
        if (!patient) {
            const rows = await query<any>('SELECT * FROM patients WHERE healthie_client_id = $1', [patientId]);
            patient = rows?.[0] || null;
        }

        // Look up the real Healthie ID from the canonical healthie_clients table
        let healthieId = '';
        if (patient) {
            const hcRows = await query<any>(
                'SELECT healthie_client_id FROM healthie_clients WHERE patient_id = $1 AND is_active = true LIMIT 1',
                [patient.patient_id]
            );
            healthieId = hcRows?.[0]?.healthie_client_id || '';
        }
        if (!healthieId) healthieId = patientId; // last resort fallback
        const localData: any = { demographics: patient || {} };

        // 2. Fetch from Healthie in parallel (each query fails gracefully)
        // All variable types validated against actual Healthie API error responses
        const [chartNotes, medications, appointments, entries, allergies, documents, userProfile] = await Promise.all([
            // Chart notes (form answer groups)
            safeHealthieQuery<any>('chartNotes', `
                query GetChartNotes($userId: String) {
                    formAnswerGroups(
                        user_id: $userId,
                        offset: 0
                    ) {
                        id
                        name
                        created_at
                        updated_at
                        form_answers {
                            id
                            label
                            answer
                            displayed_answer
                        }
                    }
                }
            `, { userId: healthieId }),

            // Medications
            safeHealthieQuery<any>('medications', `
                query GetMedications($patientId: ID) {
                    medications(patient_id: $patientId, active: true) {
                        id
                        name
                        dosage
                        frequency
                        route
                        directions
                        start_date
                        end_date
                        normalized_status
                    }
                }
            `, { patientId: healthieId }),

            // Appointments — user_id is ID type
            safeHealthieQuery<any>('appointments', `
                query GetAppointments($userId: ID) {
                    appointments(
                        user_id: $userId,
                        is_active: true,
                        offset: 0
                    ) {
                        id
                        date
                        length
                        appointment_type {
                            name
                        }
                        provider {
                            full_name
                        }
                        pm_status
                        location
                    }
                }
            `, { userId: healthieId }),

            // Entries (Vitals) — client_id is String type
            safeHealthieQuery<any>('entries', `
                query GetEntries($clientId: String) {
                    entries(
                        client_id: $clientId,
                        type: "MetricEntry",
                        offset: 0
                    ) {
                        id
                        type
                        category
                        metric_stat
                        created_at
                        description
                    }
                }
            `, { clientId: healthieId }),

            // Allergies — accessed via user object (root allergySensitivities query doesn't exist)
            safeHealthieQuery<any>('allergies', `
                query GetUserAllergies($userId: ID) {
                    user(id: $userId) {
                        allergy_sensitivities {
                            id
                            name
                            reaction
                            severity
                            status
                            category_type
                            onset_date
                        }
                    }
                }
            `, { userId: healthieId }),

            // Documents — viewable_user_id is String, returns file_content_type/friendly_type
            safeHealthieQuery<any>('documents', `
                query GetDocuments($viewableUserId: String) {
                    documents(viewable_user_id: $viewableUserId, offset: 0, page_size: 30) {
                        id
                        display_name
                        file_content_type
                        friendly_type
                        created_at
                        rel_user_id
                    }
                }
            `, { viewableUserId: healthieId }),

            // User profile (for avatar)
            safeHealthieQuery<any>('userProfile', `
                query GetUser($id: ID) {
                    user(id: $id) {
                        id
                        first_name
                        last_name
                        avatar_url
                        dob
                        gender
                        phone_number
                        email
                    }
                }
            `, { id: healthieId }),
        ]);

        // 3. Fetch local scribe history — only if we have a valid uuid patient_id
        let scribeHistory: any[] = [];
        const localPatientId = patient?.patient_id;
        if (localPatientId) {
            scribeHistory = await query<any>(`
                SELECT 
                    ss.session_id, ss.visit_type, ss.status, ss.created_at,
                    sn.soap_subjective, sn.soap_assessment, sn.icd10_codes
                FROM scribe_sessions ss
                LEFT JOIN scribe_notes sn ON ss.session_id = sn.session_id
                WHERE ss.patient_id = $1
                ORDER BY ss.created_at DESC
                LIMIT 10
            `, [localPatientId]);
        }

        return NextResponse.json({
            success: true,
            data: {
                ...localData,
                healthie_id: healthieId,
                chart_notes: chartNotes?.formAnswerGroups || [],
                medications: medications?.medications || [],
                allergies: allergies?.user?.allergy_sensitivities || [],
                appointments: appointments?.appointments || [],
                documents: documents?.documents || [],
                vitals: entries?.entries || [],
                scribe_history: scribeHistory || [],
                avatar_url: userProfile?.user?.avatar_url || null,
            },
        });
    } catch (error) {
        console.error('[iPad:PatientChart] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}

// Direct Healthie fetch — bypasses rate limiter to prevent zombie connection buildup.
// Uses AbortController for proper cancellation of timed-out requests.
const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';

async function safeHealthieQuery<T>(label: string, gql: string, variables: Record<string, unknown>): Promise<T | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
        console.warn(`[iPad:PatientChart] ${label} aborted after 8s`);
    }, 8000);

    try {
        const response = await fetch(HEALTHIE_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                'AuthorizationSource': 'API',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: gql, variables }),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            console.warn(`[iPad:PatientChart] ${label} HTTP ${response.status}`);
            return null;
        }

        const result = await response.json();
        if (result.errors) {
            console.warn(`[iPad:PatientChart] ${label} Healthie query failed:`, result.errors.map((e: any) => e.message).join(', '));
            return null;
        }
        return result.data as T;
    } catch (error: any) {
        clearTimeout(timeout);
        if (error.name === 'AbortError') {
            // Already logged above
        } else {
            console.warn(`[iPad:PatientChart] ${label} error:`, error.message || error);
        }
        return null;
    }
}
