/**
 * Packing Sheet Upload for Peptide Orders
 * POST - Upload a packing sheet (PDF/image) to S3, save URL to order
 * GET  - Return presigned download URL for the packing sheet
 */

import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

const BUCKET = 'gmh-clinical-data-lake';
const PREFIX = 'pharmacy/packing-sheets';
const s3Client = new S3Client({ region: 'us-east-2' });

export async function POST(
    request: NextRequest,
    { params }: { params: { orderId: string } }
) {
    try {
        const user = await requireApiUser(request, 'write');
        const formData = await request.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        const maxSize = 20 * 1024 * 1024; // 20MB
        if (file.size > maxSize) {
            return NextResponse.json({ error: 'File too large (max 20MB)' }, { status: 400 });
        }

        const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(file.type)) {
            return NextResponse.json(
                { error: `Unsupported file type: ${file.type}. Allowed: PDF, JPEG, PNG, WebP` },
                { status: 400 }
            );
        }

        const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf';
        const s3Key = `${PREFIX}/${params.orderId}.${ext}`;

        const buffer = Buffer.from(await file.arrayBuffer());
        await s3Client.send(new PutObjectCommand({
            Bucket: BUCKET,
            Key: s3Key,
            Body: buffer,
            ContentType: file.type,
        }));

        const s3Url = `s3://${BUCKET}/${s3Key}`;
        await query(
            'UPDATE peptide_orders SET packing_sheet_url = $1 WHERE order_id = $2',
            [s3Url, params.orderId]
        );

        console.log(`[peptides] Packing sheet uploaded for order ${params.orderId} by ${user.name || user.email}: ${s3Key}`);
        return NextResponse.json({ success: true, key: s3Key });
    } catch (error: any) {
        if (error?.name === 'UnauthorizedError') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.error('Error uploading packing sheet:', error);
        return NextResponse.json({ error: 'Failed to upload packing sheet' }, { status: 500 });
    }
}

export async function GET(
    request: NextRequest,
    { params }: { params: { orderId: string } }
) {
    try {
        await requireApiUser(request, 'read');

        const rows = await query<{ packing_sheet_url: string | null }>(
            'SELECT packing_sheet_url FROM peptide_orders WHERE order_id = $1',
            [params.orderId]
        );

        if (!rows[0]?.packing_sheet_url) {
            return NextResponse.json({ error: 'No packing sheet found' }, { status: 404 });
        }

        const s3Url = rows[0].packing_sheet_url;
        const key = s3Url.replace(`s3://${BUCKET}/`, '');

        const signedUrl = await getSignedUrl(
            s3Client,
            new GetObjectCommand({ Bucket: BUCKET, Key: key }),
            { expiresIn: 3600 }
        );

        return NextResponse.json({ url: signedUrl });
    } catch (error: any) {
        if (error?.name === 'UnauthorizedError') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.error('Error fetching packing sheet:', error);
        return NextResponse.json({ error: 'Failed to fetch packing sheet' }, { status: 500 });
    }
}
