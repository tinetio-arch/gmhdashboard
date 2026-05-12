import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';

// Normalize Healthie/local gender values ('Male','male','M' → 'M' ; 'Female','female','F' → 'F')
function normalizeGender(g: any): 'M' | 'F' | null {
    if (!g) return null;
    const s = String(g).trim().toLowerCase();
    if (s === 'm' || s === 'male')   return 'M';
    if (s === 'f' || s === 'female') return 'F';
    return null;
}

// FIX(2026-04-09): Added x-jarvis-secret auth — endpoint was previously unauthenticated
// FIX(2026-04-15): Gender-aware unlock — male patients can't see female pellet
//   appointment types and vice versa. Fixes Brandy Campbell symptom.
// GET: Returns patient tags and unlocked appointment type IDs (gender-filtered).
// Called by the Lambda to determine what services a patient can book.
export async function GET(req: NextRequest) {
    const secret = req.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const healthieUserId = req.nextUrl.searchParams.get('healthie_user_id');
    const patientId = req.nextUrl.searchParams.get('patient_id');

    if (!healthieUserId && !patientId) {
        return NextResponse.json({ error: 'healthie_user_id or patient_id required' }, { status: 400 });
    }

    // Resolve patient_id and gender in one shot (source: local patients row).
    const [patient] = healthieUserId
        ? await query<{ patient_id: string; gender: string | null }>(
            `SELECT patient_id::text AS patient_id, gender FROM patients WHERE healthie_client_id = $1 LIMIT 1`,
            [healthieUserId]
        )
        : await query<{ patient_id: string; gender: string | null }>(
            `SELECT patient_id::text AS patient_id, gender FROM patients WHERE patient_id = $1 LIMIT 1`,
            [patientId]
        );

    const resolvedPatientId = patient?.patient_id || patientId;
    const genderNorm = normalizeGender(patient?.gender);

    // Get patient tags. Lookup by healthie_user_id OR patient_id.
    // FIX(2026-04-09): query() returns rows directly (not {rows}), was causing crash
    const tagRows = healthieUserId
        ? await query<{ tag: string }>(`SELECT tag FROM patient_service_tags WHERE healthie_user_id = $1`, [healthieUserId])
        : await query<{ tag: string }>(`SELECT tag FROM patient_service_tags WHERE patient_id = $1`, [resolvedPatientId]);

    const localTags = new Set(tagRows.map((r) => r.tag));

    // FIX(2026-04-16): Lazy-sync Healthie active_tags into local DB. Tags added via
    // Healthie admin or iPad outside our admin UI weren't reaching this endpoint.
    // Now we also fetch Healthie's active_tags and mirror any missing ones.
    if (healthieUserId && resolvedPatientId) {
        try {
            const r = await healthieGraphQL<any>(
                `query($id: ID) { user(id: $id) { active_tags { id name } } }`,
                { id: healthieUserId }
            );
            const healthieTags: Array<{ name: string }> = r?.user?.active_tags || [];
            for (const t of healthieTags) {
                const name = (t?.name || '').trim();
                if (!name || name === 'test-debug') continue;
                if (!localTags.has(name)) {
                    await query(
                        `INSERT INTO patient_service_tags (patient_id, healthie_user_id, tag, added_by, added_at)
                         VALUES ($1, $2, $3, 'lazy-sync:patient-services', NOW())
                         ON CONFLICT (patient_id, tag) DO NOTHING`,
                        [resolvedPatientId, healthieUserId, name]
                    );
                    localTags.add(name);
                }
            }
        } catch (err) {
            // Don't fail the request if Healthie is slow/down — serve whatever we have locally
            console.warn('[patient-services] Healthie tag sync failed:', (err as any)?.message);
        }
    }

    const tags = Array.from(localTags);

    // Get unlocked appointment type IDs from those tags, filtered by gender.
    // gender column: NULL = applies to both; 'M' or 'F' = restrict to that gender.
    // If patient gender is unknown, only return gender-neutral rows (NULL gender).
    const configRows = tags.length > 0
        ? await query<{ appointment_type_id: string }>(
            `SELECT DISTINCT appointment_type_id
               FROM service_tag_config
              WHERE tag = ANY($1)
                AND appointment_type_id IS NOT NULL
                AND active = true
                AND (gender IS NULL OR gender = $2)`,
            [tags, genderNorm]
        )
        : [];

    const unlockedAppointmentTypeIds = configRows.map((r) => r.appointment_type_id);

    return NextResponse.json({
        tags,
        unlockedAppointmentTypeIds,
        gender: genderNorm,            // surfaced for Lambda debugging
        patient_id: resolvedPatientId,
    });
}
