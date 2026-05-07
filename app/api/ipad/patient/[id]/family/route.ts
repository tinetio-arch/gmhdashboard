import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query, getPool } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';
import { upsertHealthiePatient } from '@/lib/ipad-patient-resolver';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Valid Healthie relationship values (verified via API testing)
const VALID_RELATIONSHIPS = [
    'spouse', 'child', 'dependent', 'caregiver',
    'legal_guardian', 'family_member', 'other',
] as const;

type HealthieRelationship = typeof VALID_RELATIONSHIPS[number];

interface FamilyMember {
    patient_id: string;
    full_name: string;
    healthie_client_id: string | null;
    dob: string | null;
    relationship_type: 'parent' | 'spouse' | 'dependent';
    healthie_contact_id: string | null;
    healthie_linked: boolean;
}

// ─── GET: Return family connections ───────────────────────────
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> | { id: string } }
) {
    const resolvedParams = params instanceof Promise ? await params : params;
    const { id: patientId } = resolvedParams;

    try { await requireApiUser(request, 'read'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        // 1. Get this patient's relationship FKs
        const [patient] = await query<{
            patient_id: string;
            full_name: string;
            healthie_client_id: string | null;
            parent_patient_id: string | null;
            spouse_patient_id: string | null;
        }>(
            `SELECT patient_id::text, full_name, healthie_client_id,
                    parent_patient_id::text, spouse_patient_id::text
             FROM patients WHERE patient_id = $1`,
            [patientId]
        );

        if (!patient) {
            return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
        }

        // 2. Fetch all relationships from junction table + reverse dependents
        const [directRels, reverseParents] = await Promise.all([
            query<{ patient_id: string; full_name: string; healthie_client_id: string | null; dob: string | null; relationship_type: string }>(
                `SELECT rp.patient_id::text, rp.full_name, rp.healthie_client_id, rp.dob::text, r.relationship_type
                 FROM patient_relationships r
                 JOIN patients rp ON rp.patient_id = r.related_patient_id
                 WHERE r.patient_id = $1
                 ORDER BY r.relationship_type, rp.full_name`,
                [patientId]
            ),
            query<{ patient_id: string; full_name: string; healthie_client_id: string | null; dob: string | null }>(
                `SELECT rp.patient_id::text, rp.full_name, rp.healthie_client_id, rp.dob::text
                 FROM patient_relationships r
                 JOIN patients rp ON rp.patient_id = r.patient_id
                 WHERE r.related_patient_id = $1 AND r.relationship_type = 'parent'
                 ORDER BY rp.full_name`,
                [patientId]
            ),
        ]);
        const parentRows = directRels.filter(r => r.relationship_type === 'parent');
        const spouseRows = directRels.filter(r => r.relationship_type === 'spouse');
        const dependentRows = reverseParents;

        // 3. Fetch Healthie linked_relatives + notification_contacts (if patient has Healthie ID)
        let healthieContacts: any[] = [];
        let healthieRelatives: any[] = [];

        if (patient.healthie_client_id) {
            try {
                const hData = await healthieGraphQL<any>(`
                    query GetFamilyLinks($id: ID) {
                        user(id: $id) {
                            notification_contacts {
                                id user_id
                                linked_client_id
                                linked_client { id first_name last_name }
                                relationship contact_type client_portal_access
                            }
                            linked_relatives {
                                id user_id
                                linked_client_id
                                user { id first_name last_name }
                                relationship contact_type client_portal_access
                            }
                        }
                    }
                `, { id: patient.healthie_client_id });

                healthieContacts = hData?.user?.notification_contacts || [];
                healthieRelatives = hData?.user?.linked_relatives || [];
            } catch (err) {
                console.warn('[Family API] Healthie query failed (serving local data only):', (err as Error).message);
            }
        }

        // 4. Build a map of Healthie contact IDs by linked healthie_client_id for matching
        const healthieContactByLinkedId = new Map<string, { id: string; client_portal_access: boolean }>();
        for (const c of healthieContacts) {
            if (c.linked_client_id) {
                healthieContactByLinkedId.set(c.linked_client_id, {
                    id: c.id,
                    client_portal_access: c.client_portal_access,
                });
            }
        }
        // Also check linked_relatives (where this patient is the linked_client)
        const healthieRelativeByUserId = new Map<string, { id: string; client_portal_access: boolean }>();
        for (const r of healthieRelatives) {
            if (r.user_id) {
                healthieRelativeByUserId.set(String(r.user_id), {
                    id: r.id,
                    client_portal_access: r.client_portal_access,
                });
            }
        }

        // 5. Build unified response
        const buildMember = (
            row: { patient_id: string; full_name: string; healthie_client_id: string | null; dob: string | null },
            relType: FamilyMember['relationship_type']
        ): FamilyMember => {
            const hid = row.healthie_client_id;
            // Check both directions for Healthie link
            const contactMatch = hid ? healthieContactByLinkedId.get(hid) : undefined;
            const relativeMatch = hid ? healthieRelativeByUserId.get(hid) : undefined;
            const match = contactMatch || relativeMatch;
            return {
                patient_id: row.patient_id,
                full_name: row.full_name,
                healthie_client_id: hid,
                dob: row.dob ? row.dob.slice(0, 10) : null,
                relationship_type: relType,
                healthie_contact_id: match?.id || null,
                healthie_linked: !!match,
            };
        };

        const parents = parentRows.map(p => buildMember(p, 'parent'));
        const spouses = spouseRows.map(s => buildMember(s, 'spouse'));
        const dependents = dependentRows.map(d => buildMember(d, 'dependent'));

        return NextResponse.json({
            success: true,
            data: { parents, spouses, dependents },
        });

    } catch (error) {
        console.error('[Family API] GET error:', error);
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// ─── POST: Create a family link ──────────────────────────────
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> | { id: string } }
) {
    const resolvedParams = params instanceof Promise ? await params : params;
    const { id: patientId } = resolvedParams;

    try { await requireApiUser(request, 'write'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const body = await request.json();
        const { relatedPatientId, relationshipType } = body;

        if (!relatedPatientId || !relationshipType) {
            return NextResponse.json(
                { success: false, error: 'relatedPatientId and relationshipType are required' },
                { status: 400 }
            );
        }

        if (relatedPatientId === patientId) {
            return NextResponse.json(
                { success: false, error: 'Cannot link a patient to themselves' },
                { status: 400 }
            );
        }

        // Fetch both patients — relatedPatientId may be a UUID or a Healthie ID
        const isRelatedUUID = UUID_RE.test(relatedPatientId);

        type PatientRow = { patient_id: string; full_name: string; healthie_client_id: string | null; dob: string | null };
        let patients: PatientRow[];

        if (isRelatedUUID) {
            patients = await query<PatientRow>(
                `SELECT patient_id::text, full_name, healthie_client_id, dob::text
                 FROM patients WHERE patient_id = ANY($1::uuid[])`,
                [[patientId, relatedPatientId]]
            );
        } else {
            // relatedPatientId is a Healthie ID — look up by healthie_client_id
            patients = await query<PatientRow>(
                `SELECT patient_id::text, full_name, healthie_client_id, dob::text
                 FROM patients WHERE patient_id = $1 OR healthie_client_id = $2`,
                [patientId, relatedPatientId]
            );
        }

        const currentPatient = patients.find(p => p.patient_id === patientId);
        let relatedPatient = patients.find(p =>
            p.patient_id === relatedPatientId || p.healthie_client_id === relatedPatientId
        );

        // If related patient not in local DB but is a Healthie ID, auto-create from Healthie
        if (!relatedPatient && !isRelatedUUID) {
            const upsertResult = await upsertHealthiePatient(relatedPatientId);
            if (upsertResult.patient_id) {
                const [newRow] = await query<PatientRow>(
                    `SELECT patient_id::text, full_name, healthie_client_id, dob::text
                     FROM patients WHERE patient_id = $1`,
                    [upsertResult.patient_id]
                );
                if (newRow) relatedPatient = newRow;
                console.log(`[Family API] Auto-created local patient for Healthie ${relatedPatientId}: ${upsertResult.fullName}`);
            }
        }

        if (!currentPatient || !relatedPatient) {
            return NextResponse.json(
                { success: false, error: 'One or both patients not found' },
                { status: 404 }
            );
        }

        // ─── Update local DB via junction table ───
        const curUUID = currentPatient.patient_id;
        const relUUID = relatedPatient.patient_id;

        const pool = getPool();
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            if (relationshipType === 'spouse') {
                // Bidirectional: insert both directions
                await client.query(
                    `INSERT INTO patient_relationships (patient_id, related_patient_id, relationship_type)
                     VALUES ($1::uuid, $2::uuid, 'spouse')
                     ON CONFLICT (patient_id, related_patient_id, relationship_type) DO NOTHING`,
                    [curUUID, relUUID]
                );
                await client.query(
                    `INSERT INTO patient_relationships (patient_id, related_patient_id, relationship_type)
                     VALUES ($1::uuid, $2::uuid, 'spouse')
                     ON CONFLICT (patient_id, related_patient_id, relationship_type) DO NOTHING`,
                    [relUUID, curUUID]
                );
            } else if (relationshipType === 'parent') {
                // Current patient lists related as parent
                await client.query(
                    `INSERT INTO patient_relationships (patient_id, related_patient_id, relationship_type)
                     VALUES ($1::uuid, $2::uuid, 'parent')
                     ON CONFLICT (patient_id, related_patient_id, relationship_type) DO NOTHING`,
                    [curUUID, relUUID]
                );
            } else if (relationshipType === 'child') {
                // Related patient lists current as parent
                await client.query(
                    `INSERT INTO patient_relationships (patient_id, related_patient_id, relationship_type)
                     VALUES ($1::uuid, $2::uuid, 'parent')
                     ON CONFLICT (patient_id, related_patient_id, relationship_type) DO NOTHING`,
                    [relUUID, curUUID]
                );
            } else {
                // caregiver, legal_guardian, family_member, other — symmetric so both charts show it
                await client.query(
                    `INSERT INTO patient_relationships (patient_id, related_patient_id, relationship_type)
                     VALUES ($1::uuid, $2::uuid, $3)
                     ON CONFLICT (patient_id, related_patient_id, relationship_type) DO NOTHING`,
                    [curUUID, relUUID, relationshipType]
                );
                await client.query(
                    `INSERT INTO patient_relationships (patient_id, related_patient_id, relationship_type)
                     VALUES ($1::uuid, $2::uuid, $3)
                     ON CONFLICT (patient_id, related_patient_id, relationship_type) DO NOTHING`,
                    [relUUID, curUUID, relationshipType]
                );
            }

            await client.query('COMMIT');
        } catch (dbErr) {
            await client.query('ROLLBACK');
            throw dbErr;
        } finally {
            client.release();
        }

        // ─── Create Healthie NotificationContact(s) ───
        let healthieResult: { contact_id: string | null; error: string | null } = { contact_id: null, error: null };

        const curHid = currentPatient.healthie_client_id;
        const relHid = relatedPatient.healthie_client_id;

        if (curHid && relHid) {
            // Determine direction: user_id = dependent (whose profile), linked_client_id = parent (who gets access)
            let userId: string;
            let linkedClientId: string;
            let healthieRelationship: string;
            let contactType = 'adult';

            // Auto-detect minor based on DOB
            const isMinor = (dob: string | null) => {
                if (!dob) return false;
                const birthDate = new Date(dob.slice(0, 10));
                const age = (Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
                return age < 18;
            };

            if (relationshipType === 'spouse') {
                // Create two links: one on each patient's profile
                userId = curHid;
                linkedClientId = relHid;
                healthieRelationship = 'spouse';
            } else if (relationshipType === 'parent') {
                // Current patient is dependent, related is parent
                userId = curHid; // contact on current (dependent) profile
                linkedClientId = relHid; // related (parent) gets access
                healthieRelationship = 'dependent';
                if (isMinor(currentPatient.dob)) contactType = 'minor';
            } else if (relationshipType === 'child') {
                // Related patient is dependent, current is parent
                userId = relHid; // contact on related (dependent) profile
                linkedClientId = curHid; // current (parent) gets access
                healthieRelationship = 'dependent';
                if (isMinor(relatedPatient.dob)) contactType = 'minor';
            } else {
                // caregiver, legal_guardian, family_member, other
                userId = curHid;
                linkedClientId = relHid;
                healthieRelationship = relationshipType;
            }

            try {
                // Check if link already exists to prevent duplicates
                const existingCheck = await healthieGraphQL<any>(`
                    query CheckExisting($id: ID) {
                        user(id: $id) {
                            notification_contacts { id linked_client_id }
                        }
                    }
                `, { id: userId });
                const existingContact = (existingCheck?.user?.notification_contacts || [])
                    .find((c: any) => c.linked_client_id === linkedClientId);

                if (existingContact) {
                    healthieResult.contact_id = existingContact.id;
                    console.log(`[Family API] Healthie link already exists (contact ${existingContact.id}), skipping create`);
                } else {
                    const hResult = await healthieGraphQL<any>(`
                        mutation CreateLink($input: createNotificationContactInput!) {
                            createNotificationContact(input: $input) {
                                notificationContact { id user_id linked_client_id relationship client_portal_access contact_type }
                                messages { field message }
                            }
                        }
                    `, {
                        input: {
                            user_id: userId,
                            linked_client_id: linkedClientId,
                            relationship: healthieRelationship,
                            contact_type: contactType,
                            client_portal_access: true,
                            send_invitation: false,
                            emergency: false,
                        },
                    });

                    const nc = hResult?.createNotificationContact;
                    if (nc?.notificationContact?.id) {
                        healthieResult.contact_id = nc.notificationContact.id;
                    } else if (nc?.messages?.length) {
                        healthieResult.error = nc.messages.map((m: any) => m.message).join(', ');
                        console.warn('[Family API] Healthie createNotificationContact messages:', nc.messages);
                    }
                }

                // For spouses, create reverse link too
                if (relationshipType === 'spouse') {
                    try {
                        // Check if reverse link already exists
                        const revCheck = await healthieGraphQL<any>(`
                            query CheckExisting($id: ID) {
                                user(id: $id) { notification_contacts { id linked_client_id } }
                            }
                        `, { id: relHid });
                        const revExists = (revCheck?.user?.notification_contacts || [])
                            .find((c: any) => c.linked_client_id === curHid);

                        if (!revExists) {
                            await healthieGraphQL<any>(`
                                mutation CreateLink($input: createNotificationContactInput!) {
                                    createNotificationContact(input: $input) {
                                        notificationContact { id }
                                        messages { field message }
                                    }
                                }
                            `, {
                                input: {
                                    user_id: relHid,
                                    linked_client_id: curHid,
                                    relationship: 'spouse',
                                    contact_type: 'adult',
                                    client_portal_access: true,
                                    send_invitation: false,
                                    emergency: false,
                                },
                            });
                        } else {
                            console.log(`[Family API] Reverse spouse link already exists (contact ${revExists.id}), skipping`);
                        }
                    } catch (revErr) {
                        console.warn('[Family API] Reverse spouse link failed:', (revErr as Error).message);
                    }
                }
            } catch (hErr) {
                healthieResult.error = (hErr as Error).message;
                console.error('[Family API] Healthie link creation failed:', hErr);
            }
        } else {
            healthieResult.error = 'One or both patients missing Healthie ID — local DB updated only';
        }

        console.log(`[Family API] Linked ${currentPatient.full_name} ↔ ${relatedPatient.full_name} (${relationshipType}), Healthie: ${healthieResult.contact_id || healthieResult.error}`);

        return NextResponse.json({
            success: true,
            data: {
                db_updated: true,
                healthie_linked: !!healthieResult.contact_id,
                healthie_contact_id: healthieResult.contact_id,
                healthie_error: healthieResult.error,
            },
        });

    } catch (error) {
        console.error('[Family API] POST error:', error);
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// ─── DELETE: Remove a family link ────────────────────────────
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> | { id: string } }
) {
    const resolvedParams = params instanceof Promise ? await params : params;
    const { id: patientId } = resolvedParams;

    try { await requireApiUser(request, 'write'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const body = await request.json();
        const { relatedPatientId, relationshipType } = body;

        if (!relatedPatientId || !relationshipType) {
            return NextResponse.json(
                { success: false, error: 'relatedPatientId and relationshipType are required' },
                { status: 400 }
            );
        }

        // Resolve relatedPatientId if it's a Healthie ID
        let resolvedRelatedId = relatedPatientId;
        if (!UUID_RE.test(relatedPatientId)) {
            const [resolved] = await query<{ patient_id: string }>(
                'SELECT patient_id::text FROM patients WHERE healthie_client_id = $1 LIMIT 1',
                [relatedPatientId]
            );
            if (resolved) resolvedRelatedId = resolved.patient_id;
        }

        // ─── Update local DB (delete from junction table) ───
        // FIX: previous version updated deprecated patients.spouse_patient_id /
        // parent_patient_id columns, which the GET path doesn't read — so unlink
        // appeared to do nothing. Source of truth is patient_relationships.
        const pool = getPool();
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            if (relationshipType === 'spouse') {
                // Bidirectional
                await client.query(
                    `DELETE FROM patient_relationships
                     WHERE relationship_type = 'spouse'
                       AND ((patient_id = $1::uuid AND related_patient_id = $2::uuid)
                         OR (patient_id = $2::uuid AND related_patient_id = $1::uuid))`,
                    [patientId, resolvedRelatedId]
                );
            } else if (relationshipType === 'parent') {
                // Current lists related as parent
                await client.query(
                    `DELETE FROM patient_relationships
                     WHERE patient_id = $1::uuid AND related_patient_id = $2::uuid AND relationship_type = 'parent'`,
                    [patientId, resolvedRelatedId]
                );
            } else if (relationshipType === 'dependent') {
                // Reverse: related lists current as parent
                await client.query(
                    `DELETE FROM patient_relationships
                     WHERE patient_id = $1::uuid AND related_patient_id = $2::uuid AND relationship_type = 'parent'`,
                    [resolvedRelatedId, patientId]
                );
            } else {
                // caregiver, legal_guardian, family_member, other — symmetric, so delete both directions
                await client.query(
                    `DELETE FROM patient_relationships
                     WHERE relationship_type = $3
                       AND ((patient_id = $1::uuid AND related_patient_id = $2::uuid)
                         OR (patient_id = $2::uuid AND related_patient_id = $1::uuid))`,
                    [patientId, resolvedRelatedId, relationshipType]
                );
            }

            await client.query('COMMIT');
        } catch (dbErr) {
            await client.query('ROLLBACK');
            throw dbErr;
        } finally {
            client.release();
        }

        // ─── Remove Healthie NotificationContact(s) ───
        let healthieUnlinked = false;
        const [currentPatient] = await query<{ healthie_client_id: string | null }>(
            'SELECT healthie_client_id FROM patients WHERE patient_id = $1', [patientId]
        );
        const [relatedPatient] = await query<{ healthie_client_id: string | null }>(
            'SELECT healthie_client_id FROM patients WHERE patient_id = $1', [resolvedRelatedId]
        );

        const curHid = currentPatient?.healthie_client_id;
        const relHid = relatedPatient?.healthie_client_id;

        if (curHid && relHid) {
            try {
                // Find and delete notification contacts between these two users
                const hData = await healthieGraphQL<any>(`
                    query FindContacts($id: ID) {
                        user(id: $id) {
                            notification_contacts {
                                id linked_client_id
                            }
                            linked_relatives {
                                id user_id
                            }
                        }
                    }
                `, { id: curHid });

                const contactsToDelete: string[] = [];

                // Contacts on current patient's profile linking to related
                for (const c of (hData?.user?.notification_contacts || [])) {
                    if (c.linked_client_id === relHid) contactsToDelete.push(c.id);
                }
                // Linked relatives where current patient is linked_client and user is the related
                for (const r of (hData?.user?.linked_relatives || [])) {
                    if (String(r.user_id) === relHid) contactsToDelete.push(r.id);
                }

                // Also check from the other side for spouse
                if (relationshipType === 'spouse') {
                    const hData2 = await healthieGraphQL<any>(`
                        query FindContacts($id: ID) {
                            user(id: $id) {
                                notification_contacts { id linked_client_id }
                                linked_relatives { id user_id }
                            }
                        }
                    `, { id: relHid });
                    for (const c of (hData2?.user?.notification_contacts || [])) {
                        if (c.linked_client_id === curHid) contactsToDelete.push(c.id);
                    }
                    for (const r of (hData2?.user?.linked_relatives || [])) {
                        if (String(r.user_id) === curHid) contactsToDelete.push(r.id);
                    }
                }

                // Delete unique contact IDs
                const uniqueIds = [...new Set(contactsToDelete)];
                for (const contactId of uniqueIds) {
                    await healthieGraphQL<any>(`
                        mutation DeleteContact($input: deleteNotificationContactInput!) {
                            deleteNotificationContact(input: $input) {
                                notificationContact { id }
                                messages { field message }
                            }
                        }
                    `, { input: { id: contactId } });
                }

                healthieUnlinked = uniqueIds.length > 0;
                if (uniqueIds.length > 0) {
                    console.log(`[Family API] Deleted ${uniqueIds.length} Healthie notification contact(s)`);
                }
            } catch (hErr) {
                console.error('[Family API] Healthie unlink failed:', hErr);
            }
        }

        return NextResponse.json({
            success: true,
            data: { db_updated: true, healthie_unlinked: healthieUnlinked },
        });

    } catch (error) {
        console.error('[Family API] DELETE error:', error);
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        );
    }
}
