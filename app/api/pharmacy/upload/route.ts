/**
 * Pharmacy PDF Upload API
 * Handles PDF uploads to S3 and optionally to Healthie patient charts
 */

import { NextResponse } from 'next/server';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { updatePharmacyOrder, getPharmacyOrder, PharmacyType } from '@/lib/specialtyOrderQueries';
import { requireUser } from '@/lib/auth';

const VALID_PHARMACIES: PharmacyType[] = ['tirzepatide', 'farmakaio', 'olympia', 'toprx', 'carrieboyd'];
const BUCKET_NAME = 'gmh-specialty-orders';

// Use default credential provider chain (reads from ~/.aws/credentials)
// Only use explicit credentials if env vars are set
const s3Client = new S3Client({
    region: 'us-east-2',
    ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
    } : {}),
});

// GET - Get presigned URL for viewing PDF
export async function GET(request: Request) {
    try {
        await requireUser('read');
        const { searchParams } = new URL(request.url);
        const s3Key = searchParams.get('s3_key');

        if (!s3Key) {
            return NextResponse.json({ error: 's3_key is required' }, { status: 400 });
        }

        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: s3Key,
        });

        const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        return NextResponse.json({ url });
    } catch (error) {
        console.error('Error getting presigned URL:', error);
        return NextResponse.json({ error: 'Failed to get PDF URL' }, { status: 500 });
    }
}

// POST - Upload PDF to S3 and optionally to Healthie
export async function POST(request: Request) {
    try {
        await requireUser('write');
        const formData = await request.formData();

        const orderId = formData.get('order_id') as string;
        const orderType = formData.get('order_type') as PharmacyType;
        const file = formData.get('file') as File;

        if (!orderId || !orderType || !file) {
            return NextResponse.json({ error: 'order_id, order_type, and file are required' }, { status: 400 });
        }

        if (!VALID_PHARMACIES.includes(orderType)) {
            return NextResponse.json({ error: 'Invalid pharmacy type' }, { status: 400 });
        }

        // Get existing order to check for Healthie patient ID
        const order = await getPharmacyOrder(orderType, orderId);
        const healthiePatientId = order?.healthie_patient_id;

        // Read file buffer
        const buffer = Buffer.from(await file.arrayBuffer());

        // Generate S3 key
        const timestamp = Date.now();
        const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const s3Key = `${orderType}/${orderId}/${timestamp}_${sanitizedName}`;

        // Upload to S3
        await s3Client.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: s3Key,
            Body: buffer,
            ContentType: 'application/pdf',
        }));

        // Update order with S3 key
        await updatePharmacyOrder(orderType, orderId, { pdf_s3_key: s3Key });

        // If Healthie patient ID exists, upload to patient chart
        let healthieDocumentId: string | null = null;
        if (healthiePatientId) {
            try {
                healthieDocumentId = await uploadToHealthie(healthiePatientId, buffer, file.name);
                if (healthieDocumentId) {
                    // Mark order as "in chart"
                    await updatePharmacyOrder(orderType, orderId, {
                        order_in_chart: true,
                    });
                    console.log(`Uploaded PDF to Healthie chart for patient ${healthiePatientId}: ${healthieDocumentId}`);
                }
            } catch (healthieError) {
                console.error('Failed to upload to Healthie:', healthieError);
                // Don't fail - PDF is saved to S3
            }
        }

        return NextResponse.json({
            success: true,
            s3_key: s3Key,
            healthie_document_id: healthieDocumentId,
            uploaded_to_healthie: !!healthieDocumentId,
        });
    } catch (error) {
        console.error('Error uploading PDF:', error);
        return NextResponse.json({ error: 'Failed to upload PDF' }, { status: 500 });
    }
}

/**
 * Upload PDF to Healthie patient chart as a document
 */
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
                    description: 'Pharmacy order document',
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
