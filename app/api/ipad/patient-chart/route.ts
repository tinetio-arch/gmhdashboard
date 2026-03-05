import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';

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

        const healthieId = patient?.healthie_client_id || patientId;
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

            // Appointments
            safeHealthieQuery<any>('appointments', `
                query GetAppointments($userId: String) {
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

            // Entries (Vitals)
            safeHealthieQuery<any>('entries', `
                query GetEntries($clientId: ID) {
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

            // Allergies & Sensitivities
            safeHealthieQuery<any>('allergies', `
                query AllergySensitivities($patientId: String) {
                    allergySensitivities(patient_id: $patientId) {
                        id
                        name
                        reaction
                        severity
                        notes
                    }
                }
            `, { patientId: healthieId }),

            // Documents
            safeHealthieQuery<any>('documents', `
                query GetDocuments($clientId: String) {
                    documents(client_id: $clientId, offset: 0) {
                        id
                        display_name
                        document_type
                        created_at
                        file_content_type
                        rel_user_id
                    }
                }
            `, { clientId: healthieId }),

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
                allergies: allergies?.allergySensitivities || [],
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

// Safe wrapper with 10s timeout to avoid one Healthie query blocking the whole chart
async function safeHealthieQuery<T>(label: string, gql: string, variables: Record<string, unknown>): Promise<T | null> {
    try {
        const result = await Promise.race([
            healthieGraphQL<T>(gql, variables),
            new Promise<null>((resolve) => setTimeout(() => {
                console.warn(`[iPad:PatientChart] ${label} timed out after 10s`);
                resolve(null);
            }, 10000)),
        ]);
        return result;
    } catch (error) {
        console.warn(`[iPad:PatientChart] ${label} Healthie query failed:`, error instanceof Error ? error.message : error);
        return null;
    }
}
