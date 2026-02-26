/**
 * Specialty Orders PDF Upload API
 * POST - Upload PDF for order and optionally push to Healthie
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { query } from '@/lib/db';

// Use default credential provider chain (reads from ~/.aws/credentials)
const s3 = new S3Client({
    region: 'us-east-2',
    ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
    } : {}),
});

const BUCKET = 'gmh-specialty-orders';

export async function POST(request: Request) {
    try {
        await requireUser('write');
        const formData = await request.formData();

        const orderId = formData.get('order_id') as string;
        const orderType = formData.get('order_type') as 'tirzepatide' | 'farmakaio';
        const file = formData.get('file') as File;
        const healthiePatientId = formData.get('healthie_patient_id') as string | null;

        if (!orderId || !orderType || !file) {
            return NextResponse.json({ error: 'order_id, order_type, and file are required' }, { status: 400 });
        }

        // Read file buffer
        const buffer = Buffer.from(await file.arrayBuffer());
        const s3Key = `${orderType}/${orderId}/${file.name}`;

        // Upload to S3
        await s3.send(new PutObjectCommand({
            Bucket: BUCKET,
            Key: s3Key,
            Body: buffer,
            ContentType: file.type || 'application/pdf',
        }));

        // Update database with S3 key
        const table = orderType === 'tirzepatide' ? 'tirzepatide_orders' : 'farmakaio_orders';
        await query(
            `UPDATE ${table} SET pdf_s3_key = $1, healthie_patient_id = $2, updated_at = NOW() WHERE order_id = $3`,
            [s3Key, healthiePatientId || null, orderId]
        );

        // If Healthie patient ID provided, upload to Healthie chart
        let healthieDocumentId: string | null = null;
        if (healthiePatientId) {
            try {
                healthieDocumentId = await uploadToHealthie(healthiePatientId, buffer, file.name);
                if (healthieDocumentId) {
                    await query(
                        `UPDATE ${table} SET healthie_document_id = $1, uploaded_to_healthie_at = NOW() WHERE order_id = $2`,
                        [healthieDocumentId, orderId]
                    );
                }
            } catch (healthieError) {
                console.error('Failed to upload to Healthie:', healthieError);
                // Don't fail the request - PDF is still saved to S3
            }
        }

        return NextResponse.json({
            success: true,
            s3_key: s3Key,
            healthie_document_id: healthieDocumentId,
        });
    } catch (error) {
        console.error('Error uploading specialty order PDF:', error);
        return NextResponse.json({ error: 'Failed to upload PDF' }, { status: 500 });
    }
}

// Get presigned URL for viewing PDF
export async function GET(request: Request) {
    try {
        await requireUser('read');
        const { searchParams } = new URL(request.url);
        const s3Key = searchParams.get('s3_key');

        if (!s3Key) {
            return NextResponse.json({ error: 's3_key is required' }, { status: 400 });
        }

        const url = await getSignedUrl(
            s3,
            new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }),
            { expiresIn: 3600 }
        );

        return NextResponse.json({ url });
    } catch (error) {
        console.error('Error getting presigned URL:', error);
        return NextResponse.json({ error: 'Failed to get URL' }, { status: 500 });
    }
}

async function uploadToHealthie(patientId: string, pdfBuffer: Buffer, filename: string): Promise<string | null> {
    const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;
    if (!HEALTHIE_API_KEY) {
        console.error('HEALTHIE_API_KEY not configured');
        return null;
    }

    // Base64 encode the PDF with data URL prefix (required by Healthie API)
    const base64Content = pdfBuffer.toString('base64');
    const dataUrl = `data:application/pdf;base64,${base64Content}`;

    // Create document in Healthie
    const mutation = `
        mutation CreateDocument($input: createDocumentInput!) {
            createDocument(input: $input) {
                document {
                    id
                    display_name
                }
                messages {
                    field
                    message
                }
            }
        }
    `;

    const response = await fetch('https://api.gethealthie.com/graphql', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${HEALTHIE_API_KEY}`,
            'AuthorizationSource': 'API',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            query: mutation,
            variables: {
                input: {
                    rel_user_id: patientId,  // Correct field name for patient ID
                    display_name: filename,
                    file_string: dataUrl,    // Must be data URL format
                    include_in_charting: true,
                    description: 'Specialty order document',
                }
            }
        }),
    });

    const result = await response.json();

    if (result.errors || result.data?.createDocument?.messages?.length > 0) {
        console.error('Healthie createDocument error:', result.errors || result.data?.createDocument?.messages);
        return null;
    }

    return result.data?.createDocument?.document?.id || null;
}
