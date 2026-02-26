import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql';
const S3_BUCKET_RAW = 'gmh-incoming-faxes-east1';
const S3_BUCKET_PDF = 'gmh-clinical-data-lake';

const s3Client = new S3Client({ region: 'us-east-2' }); // Clinical bucket is in us-east-2

async function downloadPdfFromS3(bucket: string, key: string): Promise<Buffer | null> {
    try {
        const command = new GetObjectCommand({ Bucket: bucket, Key: key });
        const response = await s3Client.send(command);

        if (response.Body) {
            const chunks: Uint8Array[] = [];
            for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
                chunks.push(chunk);
            }
            return Buffer.concat(chunks);
        }
        return null;
    } catch (error) {
        console.error(`Failed to download from S3: ${error}`);
        return null;
    }
}

async function uploadToHealthie(
    patientId: string,
    pdfBytes: Buffer,
    filename: string,
    shareWithPatient: boolean = true
): Promise<{ success: boolean; documentId?: string; error?: string }> {
    const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;
    if (!HEALTHIE_API_KEY) {
        return { success: false, error: 'HEALTHIE_API_KEY not configured' };
    }

    const pdfBase64 = pdfBytes.toString('base64');

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

    try {
        const response = await fetch(HEALTHIE_API_URL, {
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
                        rel_user_id: patientId,
                        display_name: filename,
                        file_string: `data:application/pdf;base64,${pdfBase64}`,
                        description: 'Fax uploaded via GMH Dashboard',
                        share_with_rel: shareWithPatient,
                    },
                },
            }),
        });

        const result = await response.json();

        if (result.data?.createDocument?.document?.id) {
            return {
                success: true,
                documentId: result.data.createDocument.document.id,
            };
        } else {
            const errors = result.errors || result.data?.createDocument?.messages || [];
            return { success: false, error: JSON.stringify(errors) };
        }
    } catch (error) {
        return { success: false, error: String(error) };
    }
}

// GET: List fax queue
export async function GET(request: NextRequest): Promise<Response> {
    try {
        await requireApiUser(request, 'read');
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }
        throw error;
    }

    try {
        const pool = getPool();
        const url = new URL(request.url);
        const status = url.searchParams.get('status') || 'pending_review';

        const result = await pool.query(`
            SELECT * FROM fax_queue 
            WHERE status = $1 
            ORDER BY received_at DESC 
            LIMIT 100
        `, [status]);

        return NextResponse.json({
            success: true,
            items: result.rows,
            count: result.rowCount,
        });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}

// POST: Approve or reject a fax
export async function POST(request: NextRequest): Promise<Response> {
    let user;
    try {
        user = await requireApiUser(request, 'write');
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }
        throw error;
    }

    let body: {
        id: string;
        action: 'approve' | 'reject' | 'unreject';
        healthie_patient_id?: string;
        rejection_reason?: string;
        visible_to_patient?: boolean;
    };

    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
    }

    const { id, action, healthie_patient_id, rejection_reason, visible_to_patient } = body;

    if (!id || !action) {
        return NextResponse.json({ success: false, error: 'Missing id or action' }, { status: 400 });
    }

    const pool = getPool();

    // Get the fax record
    const faxResult = await pool.query('SELECT * FROM fax_queue WHERE id = $1', [id]);
    if (faxResult.rowCount === 0) {
        return NextResponse.json({ success: false, error: 'Fax not found' }, { status: 404 });
    }

    const fax = faxResult.rows[0];

    if (action === 'approve') {
        if (!healthie_patient_id) {
            return NextResponse.json({ success: false, error: 'Patient ID required' }, { status: 400 });
        }

        // Check if we have a PDF to upload
        if (!fax.pdf_s3_key) {
            // Update status without PDF upload
            await pool.query(`
                UPDATE fax_queue 
                SET status = 'approved', 
                    healthie_patient_id = $1, 
                    approved_at = NOW(),
                    approved_by = $2
                WHERE id = $3
            `, [healthie_patient_id, user.email, id]);

            return NextResponse.json({
                success: true,
                message: 'Fax approved (no PDF to upload)',
            });
        }

        // Download PDF from S3
        const pdfBytes = await downloadPdfFromS3(S3_BUCKET_PDF, fax.pdf_s3_key);
        if (!pdfBytes) {
            return NextResponse.json({ success: false, error: 'Failed to download PDF' }, { status: 500 });
        }

        // Generate filename
        const filename = `Fax_${fax.subject?.replace(/[^a-zA-Z0-9]/g, '_') || 'Document'}_${new Date().toISOString().slice(0, 10)}.pdf`;

        // Upload to Healthie
        const shareWithPatient = visible_to_patient !== false; // Default to true
        const uploadResult = await uploadToHealthie(healthie_patient_id, pdfBytes, filename, shareWithPatient);

        if (!uploadResult.success) {
            return NextResponse.json({ success: false, error: uploadResult.error }, { status: 500 });
        }

        // Update fax record
        await pool.query(`
            UPDATE fax_queue 
            SET status = 'approved', 
                healthie_patient_id = $1,
                healthie_document_id = $2,
                approved_at = NOW(),
                approved_by = $3
            WHERE id = $4
        `, [healthie_patient_id, uploadResult.documentId, user.email, id]);

        return NextResponse.json({
            success: true,
            message: 'Fax approved and uploaded to Healthie',
            documentId: uploadResult.documentId,
        });

    } else if (action === 'reject') {
        await pool.query(`
            UPDATE fax_queue 
            SET status = 'rejected', 
                rejection_reason = $1
            WHERE id = $2
        `, [rejection_reason || 'Rejected', id]);

        return NextResponse.json({
            success: true,
            message: 'Fax rejected',
        });
    } else if (action === 'unreject') {
        await pool.query(`
            UPDATE fax_queue 
            SET status = 'pending_review', 
                rejection_reason = NULL
            WHERE id = $1
        `, [id]);

        return NextResponse.json({
            success: true,
            message: 'Fax moved back to pending',
        });
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
}
