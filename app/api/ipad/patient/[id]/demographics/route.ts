import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';
import { createHealthieClient } from '@/lib/healthie';

/**
 * PUT /api/ipad/patient/[id]/demographics
 * Update patient demographics → sync to Healthie + GHL + local DB
 */
export async function PUT(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const user = await requireApiUser(request, 'write');
        const rawId = (await params).id;
        const body = await request.json();

        // FIX(2026-03-19): iPad may pass Healthie ID (numeric) instead of UUID patient_id.
        let patientId = rawId;
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId);
        if (!isUuid) {
            const [resolved] = await query<{ patient_id: string }>(
                `SELECT p.patient_id FROM patients p
                 LEFT JOIN healthie_clients hc ON hc.patient_id::text = p.patient_id::text AND hc.is_active = true
                 WHERE hc.healthie_client_id = $1 OR p.healthie_client_id = $1
                 LIMIT 1`,
                [rawId]
            );
            if (!resolved) {
                return NextResponse.json({ error: 'Patient not found for ID: ' + rawId }, { status: 404 });
            }
            patientId = resolved.patient_id;
        }

        const {
            first_name, last_name, dob, gender,
            phone_primary, email,
            address_line_1, address_line_2, city, state, zip,
            regimen, height, weight, preferred_name,
            interesting_facts,
        } = body;

        // FIX(2026-03-19): If only interesting_facts is being saved (no other demographics fields), do a targeted update
        const hasOtherFields = dob || gender || phone_primary || email || address_line_1 || city || state || zip || regimen || height || weight;
        if (interesting_facts !== undefined && !hasOtherFields) {
            await query(
                'UPDATE patients SET interesting_facts = $1::text, updated_at = NOW() WHERE patient_id = $2::uuid',
                [interesting_facts ?? null, String(patientId)]
            );
            console.log(`[demographics] Saved interesting_facts for patient ${patientId}`);
            return NextResponse.json({ success: true, gmh_synced: true, healthie_synced: false, ghl_synced: false });
        }

        if (!first_name || !last_name) {
            return NextResponse.json({ error: 'First and last name required' }, { status: 400 });
        }

        const fullName = `${first_name} ${last_name}`;

        // 1. Update local GMH DB
        await query(
            `UPDATE patients SET
                full_name = $2, preferred_name = $3,
                dob = $4, gender = $5, phone_primary = $6, email = $7,
                address_line1 = $8, address_line2 = $9, city = $10, state = $11, postal_code = $12,
                regimen = $13, interesting_facts = $14, updated_at = NOW()
            WHERE patient_id = $1`,
            [patientId, fullName,
                preferred_name || null,
                dob || null, gender || null, phone_primary || null, email || null,
                address_line_1 || null, address_line_2 || null, city || null, state || null, zip || null,
                regimen || null, interesting_facts !== undefined ? (interesting_facts || null) : null]
        );

        // 2. Sync to Healthie — updateClient for core fields, upsertClientLocation for address
        let healthieSynced = false;
        let healthieError: string | null = null;
        try {
            // FIX(2026-04-21): Check healthie_clients first, then fall back to patients.healthie_client_id.
            // Older patients created before the healthie_clients INSERT fix may only have the ID on the patients row.
            let healthieClientId: string | null = null;
            const hcRows = await query<{ healthie_client_id: string }>(
                `SELECT healthie_client_id FROM healthie_clients WHERE patient_id = $1 AND is_active = true LIMIT 1`,
                [patientId]
            );
            healthieClientId = (hcRows as any[])[0]?.healthie_client_id ?? null;

            if (!healthieClientId) {
                const pRows = await query<{ healthie_client_id: string }>(
                    `SELECT healthie_client_id FROM patients WHERE patient_id = $1 AND healthie_client_id IS NOT NULL`,
                    [patientId]
                );
                healthieClientId = (pRows as any[])[0]?.healthie_client_id ?? null;

                // Back-fill the missing healthie_clients row so future calls take the fast path
                if (healthieClientId) {
                    await query(
                        `INSERT INTO healthie_clients (patient_id, healthie_client_id, is_active, match_method, created_at, updated_at)
                         VALUES ($1, $2, TRUE, 'backfill_demographics', NOW(), NOW())
                         ON CONFLICT (healthie_client_id) DO UPDATE SET
                           patient_id = EXCLUDED.patient_id, is_active = TRUE, updated_at = NOW()`,
                        [patientId, healthieClientId]
                    );
                    console.log(`[demographics] Back-filled healthie_clients row for patient ${patientId} → ${healthieClientId}`);
                }
            }

            if (healthieClientId) {
                // FIX(2026-04-10): Removed height, weight, preferred_name from Healthie mutation.
                // These are NOT valid fields on updateClientInput and caused the entire mutation to fail,
                // which is why demographics were saving to local DB but never syncing to Healthie.
                // Height/weight/preferred_name are stored in local GMH DB only.
                const updateResult = await healthieGraphQL<{
                    updateClient: {
                        user: { id: string; first_name: string; last_name: string } | null;
                        messages: { field: string; message: string }[] | null;
                    };
                }>(`
                    mutation UpdateClient(
                        $id: ID, $first_name: String, $last_name: String, $dob: String,
                        $gender: String, $phone_number: String, $email: String
                    ) {
                        updateClient(input: {
                            id: $id,
                            first_name: $first_name,
                            last_name: $last_name,
                            dob: $dob,
                            gender: $gender,
                            phone_number: $phone_number,
                            email: $email
                        }) {
                            user { id first_name last_name }
                            messages { field message }
                        }
                    }
                `, {
                    id: healthieClientId,
                    first_name, last_name,
                    dob: dob || undefined,
                    gender: gender || undefined,
                    phone_number: phone_primary || undefined,
                    email: email || undefined,
                });

                // Check for Healthie validation messages
                const messages = updateResult?.updateClient?.messages;
                if (messages && messages.length > 0) {
                    const msgText = messages.map(m => `${m.field}: ${m.message}`).join(', ');
                    console.warn('[demographics] Healthie updateClient validation:', msgText);
                    healthieError = msgText;
                } else {
                    healthieSynced = true;
                    console.log(`[demographics] ✅ Synced core demographics to Healthie for ${healthieClientId}`);
                }

                // Sync address via upsertClientLocation — updateClient ignores location fields
                const hasAddress = address_line_1 || city || state || zip;
                if (hasAddress) {
                    try {
                        const healthieClient = createHealthieClient();
                        if (healthieClient) {
                            await healthieClient.upsertClientLocation(healthieClientId, {
                                name: 'Primary',
                                line1: address_line_1 || undefined,
                                line2: address_line_2 || undefined,
                                city: city || undefined,
                                state: state || undefined,
                                zip: zip || undefined,
                                country: 'US',
                            });
                            console.log(`[demographics] ✅ Synced address to Healthie for ${healthieClientId}`);
                        } else {
                            console.warn('[demographics] Could not create Healthie client for location sync');
                        }
                    } catch (locErr: any) {
                        console.error('[demographics] Healthie location sync failed:', locErr?.message || locErr);
                        healthieError = (healthieError ? healthieError + '; ' : '') + 'Address sync failed: ' + (locErr?.message || 'unknown error');
                    }
                }
            } else {
                console.warn('[demographics] No Healthie client ID found for patient', patientId);
                healthieError = 'No Healthie client ID linked to this patient';
            }
        } catch (healthieErr: any) {
            console.error('[demographics] Healthie sync failed:', healthieErr?.message || healthieErr);
            healthieError = healthieErr?.message || 'Healthie sync failed';
        }

        // 3. Sync to GHL
        let ghlSynced = false;
        let ghlError: string | null = null;
        let ghlAttempted = false;
        try {
            const patientRows = await query(
                `SELECT ghl_contact_id FROM patients WHERE patient_id = $1`,
                [patientId]
            );
            const ghlContactId = (patientRows as any[])[0]?.ghl_contact_id;

            if (ghlContactId) {
                const ghlApiKey = process.env.GHL_API_KEY;
                if (ghlApiKey) {
                    ghlAttempted = true;
                    const ghlResp = await fetch(`https://rest.gohighlevel.com/v1/contacts/${ghlContactId}`, {
                        method: 'PUT',
                        headers: {
                            'Authorization': `Bearer ${ghlApiKey}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            firstName: first_name,
                            lastName: last_name,
                            email: email || undefined,
                            phone: phone_primary || undefined,
                            dateOfBirth: dob || undefined,
                            address1: address_line_1 || undefined,
                            city: city || undefined,
                            state: state || undefined,
                            postalCode: zip || undefined,
                        }),
                    });
                    ghlSynced = ghlResp.ok;
                    if (!ghlResp.ok) {
                        // PHASE 2-r (2026-05-19): capture the GHL error body so the persisted
                        // ghl_sync_error column carries the actual upstream reason, not just
                        // a generic HTTP status. Body read is wrapped in its own try because
                        // GHL occasionally returns malformed JSON on 4xx.
                        let errBody = `HTTP ${ghlResp.status}`;
                        try {
                            const text = await ghlResp.text();
                            if (text) errBody += `: ${text.substring(0, 400)}`;
                        } catch { /* keep status-only message */ }
                        ghlError = errBody;
                        console.warn('[demographics] GHL sync HTTP failure:', errBody);
                    }
                }
            }
        } catch (ghlErr: any) {
            console.warn('[demographics] GHL sync failed:', ghlErr);
            ghlError = ghlErr?.message || String(ghlErr);
            ghlAttempted = true;
        }

        // FIX(2026-05-19): persist Healthie sync outcome so blocked patients
        // (e.g. email-collision with a provider record) surface in /ops instead
        // of vanishing into PM2 logs. Matches the column convention used by the
        // /api/patients/[id] PATCH route.
        try {
            const isEmailCollision = !!healthieError && /email\s+is\s+already\s+in\s+use|email\s+has\s+already\s+been\s+taken/i.test(healthieError);
            const nextStatus = healthieSynced
                ? 'ok'
                : (healthieError ? (isEmailCollision ? 'blocked_email_collision' : 'error') : null);
            if (nextStatus) {
                await query(
                    `UPDATE patients
                     SET healthie_sync_status = $1,
                         healthie_sync_error = $2,
                         healthie_last_synced_at = NOW()
                     WHERE patient_id = $3::uuid`,
                    [nextStatus, healthieError ? healthieError.substring(0, 500) : null, String(patientId)]
                );
            }
        } catch (persistErr) {
            console.error('[demographics] Failed to persist healthie_sync_status:', persistErr);
        }

        // PHASE 2-r (2026-05-19): persist the GHL sync outcome the same way we
        // persist Healthie. Only writes when we actually attempted the call
        // (ghlAttempted) — if there's no GHL contact_id or no API key, leave
        // the prior ghl_sync_status alone instead of overwriting it with stale
        // success/failure signal.
        try {
            if (ghlAttempted) {
                const nextGhlStatus: 'ok' | 'error' = ghlSynced ? 'ok' : 'error';
                await query(
                    `UPDATE patients
                     SET ghl_sync_status = $1,
                         ghl_sync_error = $2,
                         ghl_last_synced_at = NOW()
                     WHERE patient_id = $3::uuid`,
                    [nextGhlStatus, ghlError ? ghlError.substring(0, 500) : null, String(patientId)]
                );
            }
        } catch (persistErr) {
            console.error('[demographics] Failed to persist ghl_sync_status:', persistErr);
        }

        return NextResponse.json({
            success: true,
            healthie_synced: healthieSynced,
            healthie_error: healthieError,
            ghl_synced: ghlSynced,
            gmh_synced: true,
        });
    } catch (error: any) {
        if (error?.name === 'UnauthorizedError' || error?.status === 401) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }
        console.error('[/api/ipad/patient/demographics PUT]', error);
        return NextResponse.json({ error: 'Failed to update demographics' }, { status: 500 });
    }
}
