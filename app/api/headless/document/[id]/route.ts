import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const S3_BUCKET = 'gmh-clinical-data-lake';
const S3_PREFIX = 'documents/healthie/';
const PRESIGNED_TTL = 3600; // 1 hour

/**
 * GET /api/headless/document/[id]
 *
 * Patient-facing document viewer — short URL that redirects to S3 presigned URL.
 * Used by the mobile app to avoid passing 1700+ character presigned URLs through
 * Linking.openURL() which can fail on iOS.
 *
 * Flow:
 *   1. Check S3 cache for document
 *   2. If not cached, fetch from Healthie and cache
 *   3. 302 redirect to S3 presigned URL
 *
 * Auth: x-jarvis-secret header (same as other headless endpoints)
 */
export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
): Promise<Response> {
    // Accept auth via header (API calls) or query param (browser opens from mobile app)
    const secret = request.headers.get('x-jarvis-secret') ||
                   request.nextUrl.searchParams.get('secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const documentId = params.id;

    // FIX(2026-04-22): Validate documentId format to prevent path traversal
    if (!documentId || !/^[a-zA-Z0-9_\-]+$/.test(documentId)) {
        return NextResponse.json({ error: 'Invalid document ID' }, { status: 400 });
    }

    try {
        const { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
        const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

        const s3 = new S3Client({ region: 'us-east-2' });
        const s3Key = `${S3_PREFIX}${documentId}`;

        // Helper: stream document bytes directly (no redirect — avoids iOS Safari issues)
        async function streamFromS3(s3Client: any, bucket: string, key: string): Promise<Response> {
            const obj = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
            const bodyBytes = await obj.Body.transformToByteArray();
            const ct = obj.ContentType || 'application/pdf';
            console.log(`[Headless Document] Serving ${documentId}: ${bodyBytes.length} bytes`);
            return new Response(bodyBytes, {
                status: 200,
                headers: {
                    'Content-Type': ct,
                    'Content-Disposition': `inline; filename="document_${documentId}.pdf"`,
                    'Cache-Control': 'private, max-age=3600',
                },
            });
        }

        // Check S3 cache
        try {
            await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
            console.log(`[Headless Document] Cache hit: ${documentId}`);
            return await streamFromS3(s3, S3_BUCKET, s3Key);
        } catch (headErr: any) {
            if (headErr?.$metadata?.httpStatusCode !== 404 && headErr?.name !== 'NotFound') {
                console.warn(`[Headless Document] S3 head error:`, headErr.message);
            }
        }

        // Not cached — fetch from Healthie
        const { healthieGraphQL } = await import('@/lib/healthieApi');
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
        if (!doc?.expiring_url) {
            return NextResponse.json({ error: 'Document not found' }, { status: 404 });
        }

        // Download from Healthie within 10-second window
        const healthieResp = await fetch(doc.expiring_url);
        if (!healthieResp.ok) {
            return NextResponse.json({ error: 'Failed to download document' }, { status: 502 });
        }

        const docBytes = Buffer.from(await healthieResp.arrayBuffer());
        const contentType = doc.file_content_type || 'application/pdf';

        // Upload to our S3
        await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: s3Key,
            Body: docBytes,
            ContentType: contentType,
            Metadata: {
                'healthie-document-id': documentId,
                'healthie-display-name': doc.display_name || '',
                'cached-at': new Date().toISOString(),
            },
        }));

        console.log(`[Headless Document] Cached ${documentId}: ${docBytes.length} bytes`);

        // Serve directly (no redirect — prevents iOS app crash from redirect chain)
        return await streamFromS3(s3, S3_BUCKET, s3Key);
    } catch (error) {
        console.error('[Headless Document] Error:', error);
        return NextResponse.json({ error: 'Failed to fetch document' }, { status: 500 });
    }
}
