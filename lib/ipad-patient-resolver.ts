/**
 * FIX(2026-04-07): Shared patient ID resolver for iPad API routes.
 * FIX(2026-04-15): Stronger dedup before INSERT (healthie_id / email+dob /
 *   phone+name) to stop ghost-row + duplicate-row creation. Email or
 *   ghl_contact_id alone are NOT match keys — families share those legitimately.
 *   When a match is found we MERGE missing fields onto the existing row instead
 *   of creating a new one. Also expanded Healthie fetch to capture more demos.
 */

import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUUID(value: string): boolean {
    return UUID_REGEX.test(value);
}

const normEmail = (e: any) => (e ? String(e).trim().toLowerCase() : '');
const normPhone = (p: any) => (p ? String(p).replace(/\D/g, '') : '');
const normName = (n: any) => (n ? String(n).trim().toLowerCase().replace(/\s+/g, ' ') : '');

/**
 * Find an existing local patient that matches Healthie demographics.
 * Match keys, in order of confidence:
 *   1. healthie_client_id exact (hard match)
 *   2. email + dob (very high confidence — same person, distinguishes spouses)
 *   3. normalized phone + normalized full_name (high confidence)
 * Email-alone and phone-alone are NOT used: families share contact info.
 */
async function findExistingPatient(opts: {
    healthieClientId: string;
    email?: string | null;
    phone?: string | null;
    fullName?: string | null;
    dob?: string | null;
}): Promise<string | null> {
    const { healthieClientId, email, phone, fullName, dob } = opts;

    const [byHealthie] = await query<{ patient_id: string }>(
        `SELECT p.patient_id FROM patients p
         LEFT JOIN healthie_clients hc ON hc.patient_id = p.patient_id::text AND hc.is_active = true
         WHERE p.healthie_client_id = $1 OR hc.healthie_client_id = $1
         LIMIT 1`,
        [healthieClientId]
    );
    if (byHealthie?.patient_id) return byHealthie.patient_id;

    const e = normEmail(email);
    const firstName = normName((fullName || '').split(/\s+/)[0]);
    if (e && dob && firstName) {
        // email+dob alone is unsafe — spouses can share email AND birthdate.
        // Require a first-name match too. Same person → same first name.
        const [row] = await query<{ patient_id: string }>(
            `SELECT patient_id FROM patients
             WHERE LOWER(email) = $1
               AND dob = $2::date
               AND LOWER(SPLIT_PART(TRIM(full_name), ' ', 1)) = $3
             LIMIT 1`,
            [e, dob, firstName]
        );
        if (row?.patient_id) return row.patient_id;
    }

    const ph = normPhone(phone);
    const nm = normName(fullName);
    if (ph && ph.length >= 10 && nm) {
        const [row] = await query<{ patient_id: string }>(
            `SELECT patient_id FROM patients
             WHERE regexp_replace(COALESCE(phone_primary, ''), '\\D', '', 'g') = $1
               AND LOWER(TRIM(full_name)) = $2
             LIMIT 1`,
            [ph, nm]
        );
        if (row?.patient_id) return row.patient_id;
    }

    return null;
}

/**
 * Merge Healthie-fetched fields onto an existing patient row, only filling
 * NULL/blank columns. Never overwrites populated data.
 */
async function mergeHealthieData(patientId: string, u: any, loc: any, healthieClientId: string): Promise<void> {
    const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    const fillIfBlank = (col: string, val: any) => {
        if (val == null || val === '') return;
        sets.push(`${col} = COALESCE(NULLIF(${col}, ''), $${i})`);
        vals.push(val);
        i++;
    };
    fillIfBlank('full_name', fullName);
    fillIfBlank('email', u.email);
    fillIfBlank('phone_primary', u.phone_number);
    fillIfBlank('gender', u.gender);
    fillIfBlank('address_line1', loc?.line1);
    fillIfBlank('address_line2', loc?.line2);
    fillIfBlank('city', loc?.city);
    fillIfBlank('state', loc?.state);
    fillIfBlank('postal_code', loc?.zip);
    fillIfBlank('country', loc?.country);
    // dob is a date column — handle separately, only if currently NULL
    if (u.dob) {
        sets.push(`dob = COALESCE(dob, $${i}::date)`);
        vals.push(u.dob);
        i++;
    }
    // healthie_client_id — only fill if blank
    sets.push(`healthie_client_id = COALESCE(NULLIF(healthie_client_id, ''), $${i})`);
    vals.push(healthieClientId);
    i++;

    if (sets.length === 0) return;
    vals.push(patientId);
    await query(
        `UPDATE patients SET ${sets.join(', ')}, updated_at = NOW() WHERE patient_id = $${i}`,
        vals
    );
}

/**
 * Upsert a Healthie patient into our Postgres (patients + healthie_clients).
 * Uses the same dedup + merge logic as resolvePatientId, so it's safe to call
 * repeatedly (from webhooks OR a reconciliation cron) without creating duplicates.
 *
 * Returns: { patient_id, action: 'created' | 'merged' | 'updated' | 'skipped', fullName }
 * - 'created': new row inserted (truly new patient)
 * - 'merged':  matched an existing patient by email+dob+firstName or phone+name, filled blanks
 * - 'updated': matched by healthie_client_id, filled blanks in existing row
 * - 'skipped': Healthie returned no usable demographics (ghost-row guard)
 */
export async function upsertHealthiePatient(
    healthieId: string
): Promise<{ patient_id: string | null; action: 'created' | 'merged' | 'updated' | 'skipped'; fullName: string | null }> {
    try {
        const result = await healthieGraphQL<any>(`
            query GetUser($id: ID) {
                user(id: $id) {
                    id first_name last_name legal_name
                    email dob gender phone_number
                    locations { line1 line2 city state zip country }
                }
            }
        `, { id: healthieId });

        const u = result?.user;
        if (!u) return { patient_id: null, action: 'skipped', fullName: null };

        const loc = u.locations?.[0];
        const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
        const healthieClientId = u.id || healthieId;

        if (!fullName && !u.email && !u.phone_number) {
            console.warn(`[upsertHealthiePatient] Skipping Healthie ID ${healthieClientId} — no name/email/phone`);
            return { patient_id: null, action: 'skipped', fullName: null };
        }

        // Already linked by healthie_client_id?
        const [existingByHealthie] = await query<{ patient_id: string }>(
            `SELECT p.patient_id FROM patients p
             LEFT JOIN healthie_clients hc ON hc.patient_id = p.patient_id::text AND hc.is_active = true
             WHERE p.healthie_client_id = $1 OR hc.healthie_client_id = $1
             LIMIT 1`,
            [healthieClientId]
        );
        if (existingByHealthie?.patient_id) {
            await mergeHealthieData(existingByHealthie.patient_id, u, loc, healthieClientId);
            return { patient_id: existingByHealthie.patient_id, action: 'updated', fullName };
        }

        // Existing patient matched by demographics?
        const existingId = await findExistingPatient({
            healthieClientId,
            email: u.email,
            phone: u.phone_number,
            fullName,
            dob: u.dob,
        });
        if (existingId) {
            await mergeHealthieData(existingId, u, loc, healthieClientId);
            await query(
                `INSERT INTO healthie_clients (patient_id, healthie_client_id, is_active, match_method)
                 VALUES ($1, $2, true, 'upsert_demographics_match')
                 ON CONFLICT (healthie_client_id) DO NOTHING`,
                [existingId, healthieClientId]
            );
            return { patient_id: existingId, action: 'merged', fullName };
        }

        // Truly new — insert
        const [newPatient] = await query<{ patient_id: string }>(
            `INSERT INTO patients (full_name, email, dob, gender, phone_primary, healthie_client_id,
             address_line1, address_line2, city, state, postal_code, country, status, status_key, date_added)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Active', 'active', NOW())
             RETURNING patient_id`,
            [
                fullName, u.email || null, u.dob || null, u.gender || null,
                u.phone_number || null, healthieClientId,
                loc?.line1 || null, loc?.line2 || null, loc?.city || null,
                loc?.state || null, loc?.zip || null, loc?.country || null,
            ]
        );
        if (!newPatient?.patient_id) return { patient_id: null, action: 'skipped', fullName };

        await query(
            `INSERT INTO healthie_clients (patient_id, healthie_client_id, is_active, match_method)
             VALUES ($1, $2, true, 'upsert_new')
             ON CONFLICT (healthie_client_id) DO NOTHING`,
            [newPatient.patient_id, healthieClientId]
        );
        console.log(`[upsertHealthiePatient] Created local patient ${newPatient.patient_id} for Healthie ${healthieClientId} (${fullName})`);
        return { patient_id: newPatient.patient_id, action: 'created', fullName };
    } catch (err) {
        console.error(`[upsertHealthiePatient] Failed for Healthie ID ${healthieId}:`, err);
        return { patient_id: null, action: 'skipped', fullName: null };
    }
}

/**
 * Resolve any ID the iPad sends (Healthie numeric ID or UUID) to a local patient_id (UUID).
 * If the patient exists in Healthie but not locally, auto-creates a local record.
 * Returns null if Healthie has no usable demographics (no name, email, or phone) —
 * we refuse to create ghost rows.
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

    // Patient not in local DB — fetch from Healthie and try to match by demographics
    console.log(`[iPadResolver] Patient not found locally for ID ${idFromiPad}, fetching from Healthie...`);
    try {
        const result = await healthieGraphQL<any>(`
            query GetUser($id: ID) {
                user(id: $id) {
                    id first_name last_name legal_name
                    email dob gender phone_number
                    locations { line1 line2 city state zip country }
                }
            }
        `, { id: idFromiPad });

        const u = result?.user;
        if (!u) {
            console.log(`[iPadResolver] Healthie returned no user for ID ${idFromiPad}`);
            return null;
        }

        const loc = u.locations?.[0];
        const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
        const healthieClientId = u.id || idFromiPad;

        // GHOST-ROW GUARD: refuse to create a row with no usable identity
        if (!fullName && !u.email && !u.phone_number) {
            console.warn(`[iPadResolver] REFUSING auto-create: Healthie ID ${healthieClientId} has no name/email/phone`);
            return null;
        }

        // Try to find an existing local patient by stronger keys before inserting
        const existingId = await findExistingPatient({
            healthieClientId,
            email: u.email,
            phone: u.phone_number,
            fullName,
            dob: u.dob,
        });

        if (existingId) {
            console.log(`[iPadResolver] Matched existing patient ${existingId} for Healthie ID ${healthieClientId} — merging fields, not inserting`);
            await mergeHealthieData(existingId, u, loc, healthieClientId);
            await query(
                `INSERT INTO healthie_clients (patient_id, healthie_client_id, is_active, match_method)
                 VALUES ($1, $2, true, 'ipad_auto_resolve_match')
                 ON CONFLICT (healthie_client_id) DO NOTHING`,
                [existingId, healthieClientId]
            );
            return existingId;
        }

        const [newPatient] = await query<{ patient_id: string }>(
            `INSERT INTO patients (full_name, email, dob, gender, phone_primary, healthie_client_id,
             address_line1, address_line2, city, state, postal_code, country, status, status_key, date_added)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Active', 'active', NOW())
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
