import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const S3_BUCKET_PDF = 'gmh-clinical-data-lake';
const s3Client = new S3Client({ region: 'us-east-2' }); // Clinical bucket is in us-east-2

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

    const { id } = await params;

    // Get fax record
    const pool = getPool();
    const result = await pool.query('SELECT pdf_s3_key FROM fax_queue WHERE id = $1', [id]);

    if (result.rowCount === 0) {
        return NextResponse.json({ error: 'Fax not found' }, { status: 404 });
    }

    const { pdf_s3_key } = result.rows[0];

    if (!pdf_s3_key) {
        return NextResponse.json({ error: 'No PDF available' }, { status: 404 });
    }

    // Generate presigned URL for S3
    try {
        const command = new GetObjectCommand({
            Bucket: S3_BUCKET_PDF,
            Key: pdf_s3_key,
        });

        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

        // Redirect to presigned URL
        return NextResponse.redirect(presignedUrl);
    } catch (error) {
        console.error('Failed to generate presigned URL:', error);
        return NextResponse.json({ error: 'Failed to access PDF' }, { status: 500 });
    }
}
