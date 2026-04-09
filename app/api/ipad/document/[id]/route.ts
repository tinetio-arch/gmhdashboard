import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { healthieGraphQL } from '@/lib/healthieApi';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ipad/document/[id]
 * Fetch document from Healthie and serve it (pattern from labs/pdf/[id])
 */
export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
): Promise<Response> {
    try {
        await requireApiUser(request, 'read');
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        throw error;
    }

    const documentId = params.id;

    try {

        // FIX(2026-04-09): Healthie Document type uses "expiring_url" not "url"
        // (url doesn't exist — was returning GraphQL error, documents could never open)
        const result = await healthieGraphQL<any>(`
            query GetDocument($id: ID!) {
                document(id: $id) {
                    id
                    display_name
                    file_content_type
                    expiring_url
                }
            }
        `, { id: documentId });

        const doc = result?.document;
        if (!doc) {
            return NextResponse.json({ error: 'Document not found' }, { status: 404 });
        }

        if (!doc.expiring_url) {
            return NextResponse.json({ error: 'Document has no download URL' }, { status: 404 });
        }

        console.log(`[Document] Redirecting to ${doc.display_name} from Healthie`);

        return NextResponse.redirect(doc.expiring_url, 302);
    } catch (error) {
        console.error('[Document] Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch document' },
            { status: 500 }
        );
    }
}
