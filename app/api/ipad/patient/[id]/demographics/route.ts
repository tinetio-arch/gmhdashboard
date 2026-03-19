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
                 LEFT JOIN healthie_clients hc ON hc.patient_id = p.patient_id AND hc.is_active = true
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
        } = body;

        if (!first_name || !last_name) {
            return NextResponse.json({ error: 'First and last name required' }, { status: 400 });
        }

        const fullName = `${first_name} ${last_name}`;

        // 1. Update local GMH DB
        await query(
            `UPDATE patients SET
                full_name = $2,
                preferred_name = $3,
                dob = $4, gender = $5, phone_primary = $6, email = $7,
                address_line1 = $8, address_line2 = $9, city = $10, state = $11, postal_code = $12,
                regimen = $13,
                updated_at = NOW()
            WHERE patient_id = $1`,
            [patientId, fullName,
                preferred_name || null,
                dob || null, gender || null, phone_primary || null, email || null,
                address_line_1 || null, address_line_2 || null, city || null, state || null, zip || null,
                regimen || null]
        );

        // 2. Sync to Healthie — updateClient for core fields, upsertClientLocation for address
        let healthieSynced = false;
        let healthieError: string | null = null;
        try {
            const patientRows = await query(
                `SELECT healthie_client_id FROM healthie_clients WHERE patient_id = $1 AND is_active = true LIMIT 1`,
                [patientId]
            );
            const healthieClientId = (patientRows as any[])[0]?.healthie_client_id;

            if (healthieClientId) {
                // FIX(2026-03-19): updateClient mutation — check response messages for Healthie validation errors
                const updateResult = await healthieGraphQL<{
                    updateClient: {
                        user: { id: string; first_name: string; last_name: string } | null;
                        messages: { field: string; message: string }[] | null;
                    };
                }>(`
                    mutation UpdateClient(
                        $id: ID, $first_name: String, $last_name: String, $dob: String,
                        $gender: String, $phone_number: String, $email: String,
                        $height: String, $weight: String, $preferred_name: String
                    ) {
                        updateClient(input: {
                            id: $id,
                            first_name: $first_name,
                            last_name: $last_name,
                            dob: $dob,
                            gender: $gender,
                            phone_number: $phone_number,
                            email: $email,
                            height: $height,
                            weight: $weight,
                            preferred_name: $preferred_name
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
                    height: height || undefined,
                    weight: weight || undefined,
                    preferred_name: preferred_name || undefined,
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
        try {
            const patientRows = await query(
                `SELECT ghl_contact_id FROM patients WHERE patient_id = $1`,
                [patientId]
            );
            const ghlContactId = (patientRows as any[])[0]?.ghl_contact_id;

            if (ghlContactId) {
                const ghlApiKey = process.env.GHL_API_KEY;
                if (ghlApiKey) {
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
                }
            }
        } catch (ghlErr) {
            console.warn('[demographics] GHL sync failed:', ghlErr);
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
