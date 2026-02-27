import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';

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
        const patientId = params.id;
        const body = await request.json();

        const {
            first_name, last_name, dob, gender,
            phone_primary, email,
            address_line_1, city, state, zip,
        } = body;

        if (!first_name || !last_name) {
            return NextResponse.json({ error: 'First and last name required' }, { status: 400 });
        }

        const fullName = `${first_name} ${last_name}`;

        // 1. Update local GMH DB
        await query(
            `UPDATE patient_360 SET
                full_name = $2, first_name = $3, last_name = $4,
                dob = $5, gender = $6, phone_primary = $7, email = $8,
                address_line_1 = $9, city = $10, state = $11, zip = $12,
                updated_at = NOW()
            WHERE patient_id = $1`,
            [patientId, fullName, first_name, last_name,
                dob || null, gender || null, phone_primary || null, email || null,
                address_line_1 || null, city || null, state || null, zip || null]
        );

        // 2. Sync to Healthie
        let healthieSynced = false;
        try {
            const patientRows = await query(
                `SELECT healthie_client_id FROM patient_360 WHERE patient_id = $1`,
                [patientId]
            );
            const healthieClientId = (patientRows as any[])[0]?.healthie_client_id;

            if (healthieClientId) {
                await healthieGraphQL(`
                    mutation UpdateClient($id: ID, $first_name: String, $last_name: String, $dob: String, $gender: String, $phone_number: String, $email: String) {
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
                healthieSynced = true;
            }
        } catch (healthieErr) {
            console.warn('[demographics] Healthie sync failed:', healthieErr);
        }

        // 3. Sync to GHL
        let ghlSynced = false;
        try {
            const patientRows = await query(
                `SELECT ghl_contact_id FROM patient_360 WHERE patient_id = $1`,
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
