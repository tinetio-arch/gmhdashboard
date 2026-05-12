import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { healthieGraphQL } from '@/lib/healthieApi';

export const dynamic = 'force-dynamic';

const HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql';

/**
 * PATCH /api/ipad/document/[id]
 *
 * Toggle document visibility (shared with patient or provider-only).
 * Body: { shared: true|false }
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: { id: string } }
): Promise<Response> {
    try {
        await requireApiUser(request, 'write');
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        throw error;
    }

    const documentId = params.id;

    try {
        const body = await request.json();
        const shared = body.shared === true;

        const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;
        if (!HEALTHIE_API_KEY) {
            return NextResponse.json({ error: 'HEALTHIE_API_KEY not configured' }, { status: 500 });
        }

        const response = await fetch(HEALTHIE_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                'AuthorizationSource': 'API',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: `
                    mutation UpdateDocument($input: updateDocumentInput!) {
                        updateDocument(input: $input) {
                            document { id shared }
                            messages { field message }
                        }
                    }
                `,
                variables: {
                    input: {
                        id: documentId,
                        share_with_rel: shared,
                    },
                },
            }),
        });

        const result = await response.json();
        if (result.data?.updateDocument?.document?.id) {
            console.log(`[Document] ${documentId} visibility set to ${shared ? 'patient-visible' : 'provider-only'}`);
            return NextResponse.json({ success: true, shared });
        } else {
            const errors = result.errors || result.data?.updateDocument?.messages || [];
            return NextResponse.json({ success: false, error: JSON.stringify(errors) }, { status: 400 });
        }
    } catch (error) {
        console.error('[Document] Toggle visibility error:', error);
        return NextResponse.json({ error: 'Failed to update document visibility' }, { status: 500 });
    }
}

const S3_BUCKET = 'gmh-clinical-data-lake';
const S3_PREFIX = 'documents/healthie/';
const PRESIGNED_TTL = 3600; // 1 hour

/**
 * GET /api/ipad/document/[id]
 *
 * Proxy Healthie documents through our S3 to avoid their 10-second expiring URLs.
 * Flow:
 *   1. Check if document is already cached in our S3
 *   2. If not, fetch fresh expiring_url from Healthie, download bytes, upload to S3
 *   3. Return a presigned URL from our S3 (1-hour TTL)
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
        const { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
        const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

        const s3 = new S3Client({ region: 'us-east-2' });

        // Step 1: Check if we already have this document cached in S3
        const s3Key = `${S3_PREFIX}${documentId}`;
        let contentType = 'application/pdf';

        try {
            const head = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
            contentType = head.ContentType || 'application/pdf';

            // Document exists in our S3 — generate presigned URL and redirect
            const presignedUrl = await getSignedUrl(s3, new GetObjectCommand({
                Bucket: S3_BUCKET,
                Key: s3Key,
                // ContentType already set on the object at upload time
            }), { expiresIn: PRESIGNED_TTL });

            console.log(`[Document] Cache hit: ${documentId} → S3 presigned (1hr TTL)`);
            return NextResponse.redirect(presignedUrl, 302);
        } catch (headErr: any) {
            if (headErr?.name !== 'NotFound' && headErr?.$metadata?.httpStatusCode !== 404) {
                console.warn(`[Document] S3 head check error:`, headErr.message);
            }
            // Not cached yet — fall through to fetch from Healthie
        }

        // Step 2: Fetch document metadata (including fresh expiring_url) from Healthie
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
            return NextResponse.json({ error: 'Document not found in Healthie' }, { status: 404 });
        }

        if (!doc.expiring_url) {
            return NextResponse.json({ error: 'Document has no download URL' }, { status: 404 });
        }

        contentType = doc.file_content_type || 'application/pdf';

        // Step 3: Download the document bytes from Healthie's S3 (within 10-second window)
        const healthieResp = await fetch(doc.expiring_url);
        if (!healthieResp.ok) {
            console.error(`[Document] Healthie S3 download failed: ${healthieResp.status} for doc ${documentId}`);
            return NextResponse.json({ error: 'Failed to download document from Healthie' }, { status: 502 });
        }

        const docBytes = Buffer.from(await healthieResp.arrayBuffer());
        console.log(`[Document] Downloaded ${documentId} from Healthie: ${docBytes.length} bytes`);

        // Step 4: Upload to our S3
        const fileName = doc.display_name || `document_${documentId}`;
        await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: s3Key,
            Body: docBytes,
            ContentType: contentType,
            Metadata: {
                'healthie-document-id': documentId,
                'healthie-display-name': fileName,
                'cached-at': new Date().toISOString(),
            },
        }));

        console.log(`[Document] Cached ${documentId} to S3: ${s3Key} (${docBytes.length} bytes)`);

        // Step 5: Generate presigned URL and redirect
        const presignedUrl = await getSignedUrl(s3, new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: s3Key,
            // ContentType already set on the object at upload time
        }), { expiresIn: PRESIGNED_TTL });

        return NextResponse.redirect(presignedUrl, 302);
    } catch (error) {
        console.error('[Document] Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch document' },
            { status: 500 }
        );
    }
}
