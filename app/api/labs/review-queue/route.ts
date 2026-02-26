import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { query, getPool } from '@/lib/db';
import { computeLabStatus } from '@/lib/patientFormatting';

/**
 * Labs Review Queue API
 * 
 * GET /api/labs/review-queue - List pending lab results for provider approval
 * POST /api/labs/review-queue - Approve or reject a lab result
 */

const HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql';
const S3_BUCKET = 'gmh-clinical-data-lake';

const s3Client = new S3Client({ region: 'us-east-2' });

interface LabQueueItem {
    id: string;
    source?: 'access_labs_api' | 'email';
    accession?: string;
    patient_name: string;
    dob?: string;
    gender?: string;
    collection_date?: string;
    healthie_id?: string;
    patient_id?: string;
    match_confidence?: number;
    matched_name?: string;
    top_matches?: Array<[string, number, string]>;
    tests_found?: string[];
    status: 'pending_review' | 'approved' | 'rejected';
    created_at: string;
    uploaded_at?: string;
    approved_at?: string;
    healthie_document_id?: string;
    healthie_lab_order_id?: string;
    rejection_reason?: string;
    pdf_path?: string;
    s3_key?: string;
    upload_status?: 'uploaded_hidden' | 'visible' | 'pending';
    severity?: number;
    critical_tests?: Array<{ name: string; value: string; units: string }>;
    approved_by?: string;
}

/** Load a single queue item by ID from the database */
async function loadQueueItem(id: string): Promise<LabQueueItem | null> {
    const rows = await query<LabQueueItem>(
        `SELECT * FROM lab_review_queue WHERE id = $1 LIMIT 1`,
        [id]
    );
    return rows[0] || null;
}

/** Update specific fields on a queue item in the database */
async function updateQueueItem(id: string, updates: Partial<LabQueueItem>): Promise<void> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    for (const [key, value] of Object.entries(updates)) {
        if (key === 'id') continue; // never update the PK
        setClauses.push(`${key} = $${paramIdx}`);
        values.push(value);
        paramIdx++;
    }

    if (setClauses.length === 0) return;

    values.push(id);
    await query(
        `UPDATE lab_review_queue SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
        values
    );
}

/**
 * Auto-update patient lab dates when a lab is approved.
 * Only triggers for labs containing "Pre Required" tests (Male or Female).
 * Sets last_lab_date to the collection/approval date and next_lab_date to +1 year.
 * Uses the internal patient_id (UUID), looking it up from Healthie ID if needed.
 */
async function updatePatientLabDates(
    item: LabQueueItem,
    healthieId: string
): Promise<void> {
    try {
        // Only update lab dates for Pre Required tests
        const hasPreRequired = (item.tests_found || []).some(
            t => t.toUpperCase().includes('PRE REQUIRED')
        );
        if (!hasPreRequired) {
            console.log(`[LabReviewQueue] Skipping lab date update for ${item.patient_name} — no Pre Required tests (tests: ${(item.tests_found || []).join(', ')})`);
            return;
        }

        // Determine the patient UUID — prefer item.patient_id, fall back to lookup by healthie_client_id
        let patientUuid = item.patient_id;
        if (!patientUuid && healthieId) {
            // Try patients table first
            const [row] = await query<{ patient_id: string }>(
                `SELECT patient_id FROM patients WHERE healthie_client_id = $1 LIMIT 1`,
                [healthieId]
            );
            patientUuid = row?.patient_id;
            // Fall back to healthie_clients mapping table
            if (!patientUuid) {
                const [mapping] = await query<{ patient_id: string }>(
                    `SELECT patient_id FROM healthie_clients WHERE healthie_client_id = $1 LIMIT 1`,
                    [healthieId]
                );
                patientUuid = mapping?.patient_id;
            }
            // Fall back to name-based match (queue stores name as "LAST, FIRST")
            if (!patientUuid && item.patient_name) {
                const parts = item.patient_name.split(',').map(s => s.trim());
                if (parts.length === 2) {
                    const [lastName, firstName] = parts;
                    const [nameMatch] = await query<{ patient_id: string }>(
                        `SELECT patient_id FROM patients 
                         WHERE UPPER(full_name) = UPPER($1)
                         LIMIT 1`,
                        [`${firstName} ${lastName}`]
                    );
                    patientUuid = nameMatch?.patient_id;
                    // Also set healthie_client_id for future lookups
                    if (patientUuid && healthieId) {
                        await query(
                            `UPDATE patients SET healthie_client_id = $2 WHERE patient_id = $1 AND healthie_client_id IS NULL`,
                            [patientUuid, healthieId]
                        );
                    }
                }
            }
        }
        if (!patientUuid) {
            console.log(`[LabReviewQueue] No patient UUID found for ${item.patient_name} — skipping lab date update`);
            return;
        }

        const lastLabDate = item.collection_date || new Date().toISOString().slice(0, 10);
        // Next lab = +1 year from collection date
        const nextDate = new Date(lastLabDate);
        nextDate.setFullYear(nextDate.getFullYear() + 1);
        const nextLabDate = nextDate.toISOString().slice(0, 10);

        // Compute lab status label
        const labStatusInfo = computeLabStatus(lastLabDate, nextLabDate);

        // Upsert labs table (UPDATE first, INSERT if no row exists)
        const pool = getPool();
        const updateResult = await pool.query(
            `UPDATE labs SET last_lab_date = $2, next_lab_date = $3, lab_status = $4, updated_at = NOW()
             WHERE patient_id = $1`,
            [patientUuid, lastLabDate, nextLabDate, labStatusInfo.label]
        );
        if (updateResult.rowCount === 0) {
            await pool.query(
                `INSERT INTO labs (patient_id, last_lab_date, next_lab_date, lab_status)
                 VALUES ($1, $2, $3, $4)`,
                [patientUuid, lastLabDate, nextLabDate, labStatusInfo.label]
            );
        }

        // Also update patients.lab_status
        await query(
            `UPDATE patients SET lab_status = $2, updated_at = NOW() WHERE patient_id = $1`,
            [patientUuid, labStatusInfo.label]
        );

        console.log(`✅ Updated lab dates for patient ${patientUuid}: last=${lastLabDate}, next=${nextLabDate}, status=${labStatusInfo.label}`);
    } catch (error) {
        console.error('[LabReviewQueue] Failed to update patient lab dates:', error);
        // Non-fatal — don't block the approval
    }
}

async function makeDocumentVisible(
    documentId: string
): Promise<{ success: boolean; error?: string }> {
    const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;
    if (!HEALTHIE_API_KEY) {
        return { success: false, error: 'HEALTHIE_API_KEY not configured' };
    }

    const mutation = `
        mutation UpdateDocument($input: updateDocumentInput!) {
            updateDocument(input: $input) {
                document {
                    id
                    shared
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
                        id: documentId,
                        share_with_rel: true  // Make visible to patient
                    }
                }
            })
        });

        const result = await response.json();

        if (result.data?.updateDocument?.document?.id) {
            console.log(`✅ Document ${documentId} made visible to patient`);
            return { success: true };
        } else {
            const errors = result.errors || result.data?.updateDocument?.messages || [];
            return { success: false, error: JSON.stringify(errors) };
        }
    } catch (error) {
        return { success: false, error: String(error) };
    }
}

async function downloadPdfFromS3(s3Key: string): Promise<Buffer | null> {
    try {
        const command = new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: s3Key,
        });
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

async function uploadToHealthieFromBytes(
    patientId: string,
    pdfBytes: Buffer,
    filename: string
): Promise<{ success: boolean; documentId?: string; error?: string }> {
    const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;
    if (!HEALTHIE_API_KEY) {
        return { success: false, error: 'HEALTHIE_API_KEY not configured' };
    }

    try {
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
                        description: 'Lab results from Access Medical Labs',
                        share_with_rel: false, // Initially hidden, made visible on approve
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
            return {
                success: false,
                error: JSON.stringify(errors),
            };
        }
    } catch (error) {
        return {
            success: false,
            error: String(error),
        };
    }
}

async function uploadToHealthie(
    patientId: string,
    pdfPath: string,
    filename: string
): Promise<{ success: boolean; documentId?: string; error?: string }> {
    const fs = await import('fs');

    const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;
    if (!HEALTHIE_API_KEY) {
        return { success: false, error: 'HEALTHIE_API_KEY not configured' };
    }

    try {
        // Read PDF and encode as base64
        const pdfBytes = await fs.promises.readFile(pdfPath);
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
                        description: 'Lab results uploaded via GMH Dashboard',
                        share_with_rel: true,
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
            return {
                success: false,
                error: JSON.stringify(errors),
            };
        }
    } catch (error) {
        return {
            success: false,
            error: String(error),
        };
    }
}

// GET: List pending lab results
export async function GET(request: NextRequest): Promise<Response> {
    try {
        await requireApiUser(request, 'read');
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }
        throw error;
    }

    const url = new URL(request.url);
    const status = url.searchParams.get('status') || 'pending_review';
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    // Query items from database
    let filtered: LabQueueItem[];
    if (status === 'all') {
        filtered = await query<LabQueueItem>(
            `SELECT * FROM lab_review_queue ORDER BY created_at DESC LIMIT $1`,
            [limit]
        );
    } else {
        filtered = await query<LabQueueItem>(
            `SELECT * FROM lab_review_queue WHERE status = $1 ORDER BY created_at DESC LIMIT $2`,
            [status, limit]
        );
    }

    // Get counts from database
    const countRows = await query<{ status: string; count: string }>(
        `SELECT status, COUNT(*)::text as count FROM lab_review_queue GROUP BY status`
    );
    const totalRow = await query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM lab_review_queue`
    );

    const counts: Record<string, number> = {
        pending_review: 0,
        approved: 0,
        rejected: 0,
        total: parseInt(totalRow[0]?.count || '0', 10),
    };
    for (const row of countRows) {
        counts[row.status] = parseInt(row.count, 10);
    }

    return NextResponse.json({
        success: true,
        items: filtered,
        counts,
    });
}

// POST: Approve or reject a lab result
export async function POST(request: NextRequest): Promise<Response> {
    let currentUser: { name: string } | null = null;
    try {
        const user = await requireApiUser(request, 'write');
        currentUser = { name: user.name || user.email || 'Unknown' };
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }
        throw error;
    }

    let body: {
        id: string;
        action: 'approve' | 'reject';
        corrected_patient_id?: string;
        rejection_reason?: string;
    };

    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
    }

    const { id, action, corrected_patient_id, rejection_reason } = body;

    if (!id || !action) {
        return NextResponse.json(
            { success: false, error: 'Missing id or action' },
            { status: 400 }
        );
    }

    const item = await loadQueueItem(id);

    if (!item) {
        return NextResponse.json(
            { success: false, error: 'Item not found' },
            { status: 404 }
        );
    }

    if (action === 'approve') {
        // Determine patient ID (use corrected if provided)
        const patientId = corrected_patient_id || item.healthie_id;

        if (!patientId) {
            return NextResponse.json(
                { success: false, error: 'No patient ID available. Please select a patient.' },
                { status: 400 }
            );
        }

        // SAFETY CHECK: Verify the target patient is active in Healthie before uploading
        try {
            const healthieApiKey = process.env.HEALTHIE_API_KEY;
            if (healthieApiKey) {
                const checkResponse = await fetch('https://api.gethealthie.com/graphql', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${healthieApiKey}`,
                        'AuthorizationSource': 'API',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        query: `query { user(id: "${patientId}") { id first_name last_name active } }`,
                    }),
                });
                const checkResult = await checkResponse.json();
                const user = checkResult?.data?.user;
                if (user && user.active === false) {
                    return NextResponse.json(
                        {
                            success: false,
                            error: `Cannot upload to archived patient: ${user.first_name} ${user.last_name} (ID: ${patientId}). Please select an active patient instead.`
                        },
                        { status: 400 }
                    );
                }
            }
        } catch (activeCheckError) {
            console.error('[LabReviewQueue] Active status check failed (proceeding anyway):', activeCheckError);
        }

        // Check if already uploaded (hidden) - just need to make visible
        if (item.healthie_document_id && item.upload_status === 'uploaded_hidden') {
            // Make document visible via updateDocument mutation
            const visibilityResult = await makeDocumentVisible(item.healthie_document_id);

            if (!visibilityResult.success) {
                return NextResponse.json(
                    { success: false, error: `Failed to make document visible: ${visibilityResult.error}` },
                    { status: 500 }
                );
            }

            // Update queue item in database
            await updateQueueItem(id, {
                status: 'approved',
                upload_status: 'visible',
                approved_at: new Date().toISOString(),
                approved_by: currentUser?.name,
            });

            // Auto-update patient lab dates
            await updatePatientLabDates(item, patientId);

            return NextResponse.json({
                success: true,
                message: 'Lab result approved and made visible to patient',
                documentId: item.healthie_document_id,
            });
        }

        // New S3 flow: Check if we have an s3_key to download PDF from
        if (item.s3_key) {
            // Download PDF from S3
            const pdfBytes = await downloadPdfFromS3(item.s3_key);
            if (!pdfBytes) {
                return NextResponse.json(
                    { success: false, error: 'Failed to download PDF from S3' },
                    { status: 500 }
                );
            }

            // Generate filename
            const patientName = (item.patient_name || 'Unknown')
                .replace(',', '')
                .replace(/\s+/g, '_');
            const collectionDate = item.collection_date || new Date().toISOString().slice(0, 10);
            const filename = `Lab_Results_${patientName}_${collectionDate}.pdf`;

            // Upload to Healthie (initially hidden)
            const uploadResult = await uploadToHealthieFromBytes(patientId, pdfBytes, filename);

            if (!uploadResult.success) {
                return NextResponse.json(
                    { success: false, error: `Upload failed: ${uploadResult.error}` },
                    { status: 500 }
                );
            }

            // Make document visible immediately since this is an approval
            if (uploadResult.documentId) {
                await makeDocumentVisible(uploadResult.documentId);
            }

            // Update queue item in database
            await updateQueueItem(id, {
                status: 'approved',
                healthie_id: patientId,
                healthie_document_id: uploadResult.documentId,
                upload_status: 'visible',
                approved_at: new Date().toISOString(),
                approved_by: currentUser?.name,
            });

            // Auto-update patient lab dates
            await updatePatientLabDates(item, patientId);

            return NextResponse.json({
                success: true,
                message: 'Lab result approved and uploaded to Healthie',
                documentId: uploadResult.documentId,
            });
        }

        // Legacy flow: Check if we have a local PDF to upload
        if (!item.pdf_path) {
            return NextResponse.json(
                { success: false, error: 'No PDF file (S3 or local) associated with this item' },
                { status: 400 }
            );
        }

        // Generate filename
        const patientName = (item.patient_name || 'Unknown')
            .replace(',', '')
            .replace(/\s+/g, '_');
        const collectionDate = item.collection_date || new Date().toISOString().slice(0, 10);
        const filename = `Lab_Results_${patientName}_${collectionDate}.pdf`;

        // Upload to Healthie (as visible for legacy flow)
        const uploadResult = await uploadToHealthie(patientId, item.pdf_path, filename);

        if (!uploadResult.success) {
            return NextResponse.json(
                { success: false, error: `Upload failed: ${uploadResult.error}` },
                { status: 500 }
            );
        }

        // Update queue item in database
        await updateQueueItem(id, {
            status: 'approved',
            healthie_id: patientId,
            healthie_document_id: uploadResult.documentId,
            uploaded_at: new Date().toISOString(),
            approved_by: currentUser?.name,
        });

        // Auto-update patient lab dates
        await updatePatientLabDates(item, patientId);

        // Clean up PDF file
        try {
            const fs = await import('fs');
            await fs.promises.unlink(item.pdf_path);
        } catch {
            // Ignore cleanup errors
        }

        return NextResponse.json({
            success: true,
            message: 'Lab result approved and uploaded',
            documentId: uploadResult.documentId,
        });

    } else if (action === 'reject') {
        await updateQueueItem(id, {
            status: 'rejected',
            rejection_reason: rejection_reason || 'Rejected by provider',
        });

        return NextResponse.json({
            success: true,
            message: 'Lab result rejected',
        });
    }

    return NextResponse.json(
        { success: false, error: 'Invalid action' },
        { status: 400 }
    );
}
