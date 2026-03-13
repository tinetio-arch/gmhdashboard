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

        // Query Healthie for the document - use url field which gives a downloadable link
        const result = await healthieGraphQL<any>(`
            query GetDocument($id: ID!) {
                document(id: $id) {
                    id
                    display_name
                    file_content_type
                    url
                }
            }
        `, { id: documentId });

        const doc = result?.document;
        if (!doc) {
            return NextResponse.json({ error: 'Document not found' }, { status: 404 });
        }

        if (!doc.url) {
            return NextResponse.json({ error: 'Document has no download URL' }, { status: 404 });
        }

        // The URL field provides a direct download link - just redirect to it
        console.log(`[Document] Redirecting to ${doc.display_name} from Healthie`);

        // Return a redirect to the Healthie URL
        return NextResponse.redirect(doc.url, 302);
    } catch (error) {
        console.error('[Document] Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch document' },
            { status: 500 }
        );
    }
}
