import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET: List recent scribe sessions with note data
export async function GET(request: NextRequest) {
    try { await requireApiUser(request, 'read'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const url = new URL(request.url);
        const limit = parseInt(url.searchParams.get('limit') || '20');
        const patientId = url.searchParams.get('patient_id');

        let whereClause = '';
        const params: any[] = [limit];

        if (patientId) {
            whereClause = 'WHERE ss.patient_id = $2';
            params.push(patientId);
        }

        const sessions = await query<any>(`
            SELECT 
                ss.session_id,
                ss.patient_id,
                p.full_name as patient_name,
                ss.visit_type,
                ss.status,
                ss.transcript_source,
                ss.created_at,
                ss.updated_at,
                CASE WHEN ss.transcript IS NOT NULL THEN LENGTH(ss.transcript) ELSE 0 END as transcript_length,
                sn.note_id,
                sn.healthie_status,
                sn.healthie_note_id,
                CASE WHEN sn.soap_subjective IS NOT NULL THEN true ELSE false END as has_note
            FROM scribe_sessions ss
            LEFT JOIN patients p ON (ss.patient_id::text = p.patient_id::text OR ss.patient_id = p.healthie_client_id)
            LEFT JOIN scribe_notes sn ON ss.session_id = sn.session_id
            ${whereClause}
            ORDER BY ss.created_at DESC
            LIMIT $1
        `, params);

        // Fallback check for new leads not yet synced to the Local DB (like Marley Hershey)
        const missingNames = sessions.filter(s => s.patient_id && !s.patient_name);
        
        if (missingNames.length > 0) {
            try {
                // Collect unique missing Healthie IDs
                const uniqueIds = Array.from(new Set(missingNames.map(s => s.patient_id)));
                const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
                const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';

                // Build a grouped GraphQL query to find these patients in one shot on Healthie
                const qBody = `query GetMissingUsers {
                    users(ids: ${JSON.stringify(uniqueIds)}) {
                        id
                        first_name
                        last_name
                    }
                }`;
                
                const response = await fetch(HEALTHIE_API_URL, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                        'AuthorizationSource': 'API',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ query: qBody })
                });

                if (response.ok) {
                    const result = await response.json();
                    const fetchedUsers = result?.data?.users || [];
                    
                    // Map the found names back into the sessions
                    const nameMap = new Map();
                    fetchedUsers.forEach((u: any) => {
                        nameMap.set(u.id, `${u.first_name || ''} ${u.last_name || ''}`.trim());
                    });

                    for (const s of sessions) {
                        if (s.patient_id && !s.patient_name && nameMap.has(s.patient_id)) {
                            s.patient_name = nameMap.get(s.patient_id);
                        }
                    }
                }
            } catch (fallbackError) {
                console.warn('[Scribe Sessions] Healthie fallback name lookup failed:', fallbackError);
            }
        }

        return NextResponse.json({
            success: true,
            data: sessions,
        });
    } catch (error) {
        console.error('[Scribe Sessions] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}
