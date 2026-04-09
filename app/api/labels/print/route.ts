/**
 * Server-Side Print Queue for Clinic Labels
 *
 * POST /api/labels/print — Submit a label to the print queue
 *   Body: { label_type, printer, params }
 *   - label_type: 'dispense' | 'lab' | 'testosterone' | 'peptide'
 *   - printer: 'zebra' (default) | 'brother'
 *   - params: label-specific parameters (same as /api/labels/generate query params)
 *
 * GET /api/labels/print?status=pending — Poll for pending print jobs (Mac polling script)
 *   Returns oldest pending jobs with PDF data as base64
 *
 * PATCH /api/labels/print — Mark job as printed or failed (Mac polling script)
 *   Body: { id, status: 'printed' | 'failed', error?: string }
 *
 * Architecture:
 *   iPad taps "Print to Clinic Printer"
 *   → POST /api/labels/print (generates PDF, saves to print_queue)
 *   → Mac polling script checks GET /api/labels/print?status=pending every 5s
 *   → Mac downloads PDF, sends to local CUPS printer via lp
 *   → Mac calls PATCH to mark as printed
 *
 * Printers:
 *   - Zebra_Technologies_ZTC_GK420d__EPL_ (dispensing labels)
 *   - Zebra_Technologies_ZTC_GK420d__EPL__2 (dispensing labels, backup)
 *   - Brother_MFC_L5850DW_series (default, full-page)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { generateLabelPdf, LabelParams } from '@/lib/pdf/labelGenerator';
import { generateLabLabels, LabLabelParams } from '@/lib/pdf/labLabelGenerator';

export const dynamic = 'force-dynamic';

// Printer name mapping
// Exact CUPS printer names from clinic Mac (lpstat -a on 2026-04-09)
const PRINTERS: Record<string, string> = {
    zebra: 'Zebra_Technologies_ZTC_GK420d__EPL_',
    zebra2: 'Zebra_Technologies_ZTC_GK420d_',
    dymo: 'DYMO_LabelWriter_450',
    hp: 'HP_ColorLaserJet_MFP_M282-M285',
    brother: 'Brother_MFC_L5850DW_series',
    canon: 'Canon_MF642C_643C_644C__e0_ac_58___12___e0_ac_5___e0_ac_58___7_',
};

/**
 * POST — Submit a print job
 */
export async function POST(request: NextRequest) {
    try {
        const user = await requireApiUser(request, 'write');
        const body = await request.json();
        const { label_type, printer = 'zebra', params, dispense_id } = body;

        if (!label_type) {
            return NextResponse.json({ error: 'label_type is required' }, { status: 400 });
        }

        let pdfBuffer: Buffer;

        if (label_type === 'lab') {
            // Lab specimen labels — look up patient info from lab_orders
            const orderId = params.orderId || dispense_id;
            if (orderId) {
                const orderResult = await query<any>(
                    `SELECT patient_first_name, patient_last_name, patient_dob,
                            external_order_id, created_at
                     FROM lab_orders WHERE id = $1`, [orderId]);
                if (orderResult.length > 0) {
                    const order = orderResult[0];
                    const labParams: LabLabelParams = {
                        patientName: `${order.patient_first_name || ''} ${order.patient_last_name || ''}`.trim(),
                        patientDob: order.patient_dob || '',
                        drawDateTime: order.created_at || new Date().toISOString(),
                        orderId: order.external_order_id || `GMH-${orderId}`,
                    };
                    pdfBuffer = await generateLabLabels(labParams);
                } else {
                    return NextResponse.json({ error: 'Lab order not found' }, { status: 404 });
                }
            } else {
                // Fallback: use params directly
                const labParams: LabLabelParams = {
                    patientName: params.patientName || '',
                    patientDob: params.patientDob || '',
                    drawDateTime: params.drawDateTime || new Date().toISOString(),
                    orderId: params.orderId,
                };
                pdfBuffer = await generateLabLabels(labParams);
            }

        } else if (label_type === 'requisition') {
            // Requisition form — fetch the existing PDF from the requisition endpoint
            const orderId = params.orderId || dispense_id;
            if (!orderId) {
                return NextResponse.json({ error: 'orderId required for requisition' }, { status: 400 });
            }
            // Fetch the requisition PDF internally
            const reqUrl = `${request.nextUrl.origin}/ops/api/labs/orders/${orderId}/requisition/`;
            const reqResp = await fetch(reqUrl, {
                headers: { cookie: request.headers.get('cookie') || '' },
            });
            if (!reqResp.ok) {
                return NextResponse.json({ error: 'Requisition not found' }, { status: 404 });
            }
            pdfBuffer = Buffer.from(await reqResp.arrayBuffer());

        } else if (label_type === 'dispense' && dispense_id) {
            // Peptide dispense label — look up from DB (same as /api/ipad/billing/label)
            const result = await query<any>(`
                SELECT d.sale_id, d.patient_name,
                       COALESCE(d.patient_dob, pt.dob::text) as patient_dob,
                       d.sale_date,
                       p.name as product_name, p.category, p.label_directions
                FROM peptide_dispenses d
                JOIN peptide_products p ON p.product_id = d.product_id
                LEFT JOIN patients pt ON pt.full_name ILIKE d.patient_name
                WHERE d.sale_id = $1
            `, [dispense_id]);

            if (result.length === 0) {
                return NextResponse.json({ error: 'Dispense not found' }, { status: 404 });
            }

            const d = result[0];
            const labelParams: LabelParams = {
                type: 'peptide',
                patientName: d.patient_name || '',
                patientDob: d.patient_dob || '',
                medication: d.product_name || '',
                dosage: d.label_directions || '',
                provider: 'Dr. Aaron Whitten NMD',
                dateDispensed: d.sale_date || new Date().toLocaleDateString(),
                lotNumber: '',
                volume: '',
                vialNumber: '',
                amountDispensed: '',
                expDate: '',
            };
            pdfBuffer = await generateLabelPdf(labelParams);

        } else {
            // Generic label (testosterone or peptide) — use params directly
            const labelParams: LabelParams = {
                type: (params.type as 'peptide' | 'testosterone') || 'peptide',
                patientName: params.patientName || '',
                patientDob: params.patientDob || '',
                medication: params.medication || '',
                dosage: params.dosage || '',
                provider: params.provider || 'Dr. Aaron Whitten NMD - DEA: MW6359574',
                dateDispensed: params.dateDispensed || new Date().toLocaleDateString(),
                lotNumber: params.lotNumber || '',
                volume: params.volume || '',
                vialNumber: params.vialNumber || '',
                amountDispensed: params.amountDispensed || '',
                expDate: params.expDate || '',
            };
            pdfBuffer = await generateLabelPdf(labelParams);
        }

        // Save to print queue
        const printerName = PRINTERS[printer] || PRINTERS.zebra;
        const jobs = await query<{ id: number }>(
            `INSERT INTO print_queue (printer, label_type, params, pdf_data, status, created_by)
             VALUES ($1, $2, $3, $4, 'pending', $5)
             RETURNING id`,
            [printerName, label_type, JSON.stringify(params || {}), pdfBuffer, (user as any).email || 'staff']
        );

        const jobId = jobs[0]?.id;
        console.log(`[Print Queue] Job #${jobId} queued — ${label_type} on ${printerName} by ${(user as any).email}`);

        return NextResponse.json({
            success: true,
            job_id: jobId,
            printer: printerName,
            label_type,
            message: 'Label sent to clinic printer queue',
        });

    } catch (error) {
        if (error instanceof UnauthorizedError) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.error('[Print Queue] POST Error:', error);
        return NextResponse.json({ error: 'Failed to queue print job' }, { status: 500 });
    }
}

/**
 * GET — Poll for pending print jobs (Mac polling script)
 * Returns up to 5 pending jobs with PDF as base64
 */
export async function GET(request: NextRequest) {
    // Allow polling without session cookie — use a shared secret for the Mac script
    const secret = request.headers.get('x-print-secret');
    if (secret !== process.env.PRINT_RELAY_SECRET) {
        // Fall back to session auth
        try {
            await requireApiUser(request, 'read');
        } catch {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    try {
        const jobs = await query<{
            id: number;
            printer: string;
            label_type: string;
            params: any;
            pdf_data: Buffer;
            created_at: string;
            created_by: string;
        }>(`
            SELECT id, printer, label_type, params, pdf_data, created_at, created_by
            FROM print_queue
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT 5
        `);

        return NextResponse.json({
            jobs: jobs.map(j => ({
                id: j.id,
                printer: j.printer,
                label_type: j.label_type,
                params: j.params,
                pdf_base64: j.pdf_data ? Buffer.from(j.pdf_data).toString('base64') : null,
                created_at: j.created_at,
                created_by: j.created_by,
            })),
        });
    } catch (error) {
        console.error('[Print Queue] GET Error:', error);
        return NextResponse.json({ error: 'Failed to fetch print jobs' }, { status: 500 });
    }
}

/**
 * PATCH — Mark job as printed or failed (Mac polling script)
 */
export async function PATCH(request: NextRequest) {
    const secret = request.headers.get('x-print-secret');
    if (secret !== process.env.PRINT_RELAY_SECRET) {
        try {
            await requireApiUser(request, 'write');
        } catch {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    try {
        const body = await request.json();
        const { id, status, error: errorMsg } = body;

        if (!id || !['printed', 'failed'].includes(status)) {
            return NextResponse.json({ error: 'id and status (printed|failed) required' }, { status: 400 });
        }

        await query(
            `UPDATE print_queue SET status = $1, printed_at = NOW(), error = $2 WHERE id = $3`,
            [status, errorMsg || null, id]
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[Print Queue] PATCH Error:', error);
        return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
    }
}
