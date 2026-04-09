import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { generateLabLabels } from '@/lib/pdf/labLabelGenerator';

/**
 * GET /api/labs/orders/[id]/labels
 *
 * Generates 3 specimen labels for Dymo printing:
 *   - Patient Name (large, bold)
 *   - Date of Birth
 *   - Date and Time of Draw (when order was created)
 *   - Order ID
 *
 * Returns a PDF sized for Dymo 30252 labels (3.5" x 1.125")
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

    const orderId = parseInt(params.id, 10);
    if (isNaN(orderId)) {
        return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    const client = await getPool().connect();
    try {
        const result = await client.query(
            `SELECT patient_first_name, patient_last_name, patient_dob,
                    external_order_id, created_at
             FROM lab_orders WHERE id = $1`,
            [orderId]
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        const order = result.rows[0];
        const patientName = `${order.patient_first_name || ''} ${order.patient_last_name || ''}`.trim();

        const pdfBuffer = await generateLabLabels({
            patientName,
            patientDob: order.patient_dob || '',
            drawDateTime: order.created_at || new Date().toISOString(),
            orderId: order.external_order_id || `GMH-${orderId}`,
        });

        const filename = `Lab_Labels_${patientName.replace(/\s+/g, '_')}_${orderId}.pdf`;

        return new NextResponse(pdfBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="${filename}"`,
                'Content-Length': pdfBuffer.length.toString(),
            },
        });
    } finally {
        client.release();
    }
}
