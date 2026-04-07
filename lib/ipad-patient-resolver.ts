/**
 * FIX(2026-04-07): Shared patient ID resolver for iPad API routes.
 *
 * The iPad sometimes sends a numeric Healthie ID (e.g. "12742686") and sometimes
 * a UUID (our internal patient_id). Every iPad route that touches the patients table
 * must handle both formats. If the patient exists in Healthie but not locally,
 * auto-create a local record to avoid "Patient not found" errors.
 */

import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUUID(value: string): boolean {
    return UUID_REGEX.test(value);
}

/**
 * Resolve any ID the iPad sends (Healthie numeric ID or UUID) to a local patient_id (UUID).
 * If the patient exists in Healthie but not locally, auto-creates a local record.
 */
export async function resolvePatientId(idFromiPad: string): Promise<string | null> {
    if (isUUID(idFromiPad)) {
        const [row] = await query<{ patient_id: string }>(
            'SELECT patient_id FROM patients WHERE patient_id = $1 LIMIT 1',
            [idFromiPad]
        );
        if (row?.patient_id) return row.patient_id;
        // UUID but not in patients — might be a healthie_clients.patient_id (text)
        // Fall through to Healthie lookup below
    }

    // Numeric Healthie ID — look up in patients or healthie_clients
    const [patient] = await query<{ patient_id: string }>(
        `SELECT p.patient_id FROM patients p
         LEFT JOIN healthie_clients hc ON hc.patient_id = p.patient_id::text AND hc.is_active = true
         WHERE p.healthie_client_id = $1 OR hc.healthie_client_id = $1
         LIMIT 1`,
        [idFromiPad]
    );
    if (patient?.patient_id) return patient.patient_id;

    // Patient not in local DB — auto-create from Healthie
    console.log(`[iPadResolver] Patient not found locally for ID ${idFromiPad}, fetching from Healthie...`);
    try {
        const result = await healthieGraphQL<any>(`
            query GetUser($id: ID) {
                user(id: $id) {
                    id first_name last_name email dob gender phone_number
                    locations { line1 line2 city state zip country }
                }
            }
        `, { id: idFromiPad });

        const u = result?.user;
        if (!u) return null;

        const loc = u.locations?.[0];
        const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ');
        const healthieClientId = u.id || idFromiPad;

        // Check if patient already exists with this healthie_client_id (race condition guard)
        const [existing] = await query<{ patient_id: string }>(
            'SELECT patient_id FROM patients WHERE healthie_client_id = $1 LIMIT 1',
            [healthieClientId]
        );
        if (existing?.patient_id) {
            console.log(`[iPadResolver] Patient already exists for Healthie ID ${healthieClientId}: ${existing.patient_id}`);
            return existing.patient_id;
        }

        const [newPatient] = await query<{ patient_id: string }>(
            `INSERT INTO patients (full_name, email, dob, gender, phone_primary, healthie_client_id,
             address_line1, address_line2, city, state, postal_code, country, status, date_added)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Active', NOW())
             RETURNING patient_id`,
            [
                fullName, u.email || null, u.dob || null, u.gender || null,
                u.phone_number || null, healthieClientId,
                loc?.line1 || null, loc?.line2 || null, loc?.city || null,
                loc?.state || null, loc?.zip || null, loc?.country || null,
            ]
        );

        if (newPatient?.patient_id) {
            await query(
                `INSERT INTO healthie_clients (patient_id, healthie_client_id, is_active, match_method)
                 VALUES ($1, $2, true, 'ipad_auto_resolve')
                 ON CONFLICT (healthie_client_id) DO NOTHING`,
                [newPatient.patient_id, healthieClientId]
            );
            console.log(`[iPadResolver] Auto-created local patient ${newPatient.patient_id} for Healthie ID ${healthieClientId} (${fullName})`);
            return newPatient.patient_id;
        }
    } catch (err) {
        console.error(`[iPadResolver] Failed to auto-create patient from Healthie ID ${idFromiPad}:`, err);
    }
    return null;
}

/**
 * Resolve whatever ID the iPad sends to a numeric Healthie ID (for Healthie API calls).
 */
export async function resolveHealthieId(idFromiPad: string): Promise<string> {
    if (isUUID(idFromiPad)) {
        const [resolved] = await query<{ healthie_client_id: string }>(
            'SELECT healthie_client_id FROM patients WHERE patient_id = $1 AND healthie_client_id IS NOT NULL LIMIT 1',
            [idFromiPad]
        );
        if (resolved?.healthie_client_id) {
            console.log(`[iPadResolver] Resolved UUID ${idFromiPad} → Healthie ID ${resolved.healthie_client_id}`);
            return resolved.healthie_client_id;
        }
    }
    // Already a Healthie ID or couldn't resolve — pass through
    return idFromiPad;
}
