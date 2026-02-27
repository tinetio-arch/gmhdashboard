import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const S3_BUCKET = 'gmh-clinical-data-lake';
const s3Client = new S3Client({ region: 'us-east-2' });

// GET: Return a signed S3 URL for a lab PDF
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try { await requireApiUser(request, 'read'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    const { id } = await params;

    try {
        // Look up the lab item to get its S3 key
        const [lab] = await query<any>(
            'SELECT id, s3_key, pdf_path, patient_name FROM lab_review_queue WHERE id = $1',
            [id]
        );

        if (!lab) {
            return NextResponse.json({ success: false, error: 'Lab not found' }, { status: 404 });
        }

        const s3Key = lab.s3_key || lab.pdf_path;
        if (!s3Key) {
            return NextResponse.json({ success: false, error: 'No PDF available for this lab' }, { status: 404 });
        }

        // Generate a pre-signed URL (valid for 15 minutes)
        const command = new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: s3Key,
        });
        const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

        return NextResponse.json({
            success: true,
            url: signedUrl,
            patient_name: lab.patient_name,
        });
    } catch (error) {
        console.error('[Lab PDF] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Failed to get PDF' },
            { status: 500 }
        );
    }
}
