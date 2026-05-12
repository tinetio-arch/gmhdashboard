import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';

/**
 * GET /api/headless/family-members?healthie_id=12345
 *
 * Returns family members a patient can access (for the patient app profile switcher).
 * Combines Healthie linked_relatives (accounts this user has portal access to)
 * with local DB parent/spouse/dependent relationships.
 *
 * Auth: x-jarvis-secret header
 */
export async function GET(request: NextRequest) {
    const secret = request.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const healthieId = request.nextUrl.searchParams.get('healthie_id');
    if (!healthieId) {
        return NextResponse.json({ error: 'healthie_id parameter is required' }, { status: 400 });
    }

    try {
        interface FamilyMember {
            healthie_id: string;
            first_name: string;
            last_name: string;
            relationship: string;
            contact_type: string;
            user_group_id: string | null;
            source: 'healthie' | 'local' | 'both';
        }

        const membersMap = new Map<string, FamilyMember>();

        // 1. Query Healthie linked_relatives (accounts this user can access)
        try {
            const hData = await healthieGraphQL<any>(`
                query GetFamilyLinks($id: ID) {
                    user(id: $id) {
                        linked_relatives {
                            id
                            user_id
                            relationship
                            contact_type
                            client_portal_access
                            user {
                                id
                                first_name
                                last_name
                                email
                                user_group {
                                    id
                                    name
                                }
                            }
                        }
                    }
                }
            `, { id: healthieId });

            for (const rel of (hData?.user?.linked_relatives || [])) {
                if (!rel.client_portal_access) continue; // Only include accounts with portal access
                const depUser = rel.user;
                if (!depUser?.id || depUser.id === healthieId) continue; // Skip self-references

                membersMap.set(depUser.id, {
                    healthie_id: depUser.id,
                    first_name: depUser.first_name || '',
                    last_name: depUser.last_name || '',
                    relationship: rel.relationship || 'family_member',
                    contact_type: rel.contact_type || 'adult',
                    user_group_id: depUser.user_group?.id || null,
                    source: 'healthie',
                });
            }
        } catch (hErr) {
            console.warn('[Family Members API] Healthie query failed:', (hErr as Error).message);
        }

        // 2. Query local DB for additional relationships not in Healthie
        try {
            const localMembers = await query<{
                patient_id: string;
                full_name: string;
                healthie_client_id: string | null;
                healthie_group_id: string | null;
                relationship_type: string;
                dob: string | null;
            }>(`
                SELECT p.patient_id::text, p.full_name, p.healthie_client_id,
                       p.healthie_group_id, p.dob::text,
                       CASE
                         WHEN p.patient_id = me.parent_patient_id THEN 'parent'
                         WHEN p.parent_patient_id = me.patient_id THEN 'dependent'
                         WHEN p.patient_id = me.spouse_patient_id THEN 'spouse'
                       END as relationship_type
                FROM patients p
                CROSS JOIN patients me
                WHERE me.healthie_client_id = $1
                  AND (p.patient_id = me.parent_patient_id
                    OR p.parent_patient_id = me.patient_id
                    OR p.patient_id = me.spouse_patient_id)
            `, [healthieId]);

            for (const lm of localMembers) {
                const hid = lm.healthie_client_id;
                if (!hid) continue;
                if (hid === healthieId) continue;

                if (membersMap.has(hid)) {
                    // Already from Healthie — mark as both
                    membersMap.get(hid)!.source = 'both';
                } else {
                    // Parse name
                    const parts = (lm.full_name || '').split(/\s+/);
                    const isMinor = lm.dob ? ((Date.now() - new Date(lm.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) < 18 : false;

                    membersMap.set(hid, {
                        healthie_id: hid,
                        first_name: parts[0] || '',
                        last_name: parts.slice(1).join(' ') || '',
                        relationship: lm.relationship_type || 'family_member',
                        contact_type: isMinor ? 'minor' : 'adult',
                        user_group_id: lm.healthie_group_id || null,
                        source: 'local',
                    });
                }
            }
        } catch (dbErr) {
            console.warn('[Family Members API] Local DB query failed:', (dbErr as Error).message);
        }

        const members = Array.from(membersMap.values());

        return NextResponse.json({ members });
    } catch (error) {
        console.error('[Family Members API] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
