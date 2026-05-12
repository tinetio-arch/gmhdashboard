import { NextRequest, NextResponse } from 'next/server';
import { getPatientAccessStatus } from '@/lib/appAccessControl';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/headless/documents?healthie_id=XXX[&type=lab]
 *
 * Lists Healthie documents for a patient (labs, discharge instructions, care plans, etc.).
 * Patient-facing — used by the Now Optimal mobile app to populate the Labs tab.
 *
 * Pairs with /api/headless/document/[id] which streams an individual document's bytes.
 *
 * Auth: x-jarvis-secret header.
 */
export async function GET(request: NextRequest): Promise<Response> {
    const secret = request.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const healthieId = request.nextUrl.searchParams.get('healthie_id');
    const typeFilter = (request.nextUrl.searchParams.get('type') || '').toLowerCase();

    if (!healthieId) {
        return NextResponse.json({ error: 'healthie_id parameter is required' }, { status: 400 });
    }

    try {
        // Access control — same gate the other headless endpoints use
        const pool = getPool();
        const patientResult = await pool.query<{ patient_id: string }>(`
            SELECT patient_id FROM patients WHERE healthie_client_id = $1
            UNION
            SELECT patient_id::uuid FROM healthie_clients WHERE healthie_client_id = $1 AND is_active = true
            LIMIT 1
        `, [healthieId]);

        if (patientResult.rows.length === 0) {
            return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
        }

        const accessCheck = await getPatientAccessStatus(patientResult.rows[0].patient_id);
        if (accessCheck.status === 'revoked' || accessCheck.status === 'suspended') {
            return NextResponse.json({ error: 'Access denied' }, { status: 403 });
        }

        // Healthie documents — consolidated_user_id returns the full set; we filter to
        // patient-visible (shared = true) so provider-only notes never leak to the app.
        const { healthieGraphQL } = await import('@/lib/healthieApi');
        const result = await healthieGraphQL<any>(`
            query GetDocuments($consolidatedUserId: String) {
                documents(consolidated_user_id: $consolidatedUserId, offset: 0, page_size: 100, should_paginate: false) {
                    id
                    display_name
                    file_content_type
                    friendly_type
                    created_at
                    shared
                }
            }
        `, { consolidatedUserId: healthieId });

        const docs: any[] = Array.isArray(result?.documents) ? result.documents : [];

        const labKeywords = ['lab', 'quest', 'labcorp', 'cbc', 'cmp', 'lipid', 'psa', 'testosterone', 'hormone'];
        const isLab = (d: any) => {
            const hay = `${d.display_name || ''} ${d.friendly_type || ''}`.toLowerCase();
            return labKeywords.some(k => hay.includes(k));
        };

        const visible = docs.filter(d => d.shared === true);
        const filtered = typeFilter === 'lab' ? visible.filter(isLab) : visible;

        const documents = filtered.map(d => ({
            id: d.id,
            display_name: d.display_name,
            file_content_type: d.file_content_type,
            friendly_type: d.friendly_type,
            created_at: d.created_at,
            is_lab: isLab(d),
            // Mobile app should fetch via this URL (streams bytes, handles iOS redirect quirks)
            url: `/api/headless/document/${d.id}`,
        }));

        return NextResponse.json({ healthie_id: healthieId, count: documents.length, documents });
    } catch (error) {
        console.error('[Headless Documents] Error:', error);
        return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 });
    }
}
