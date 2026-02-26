import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { getPool } from '@/lib/db';

/**
 * GET /api/labs/orders/[id]/requisition
 * 
 * Returns the lab order requisition PDF for printing/download.
 * The PDF is stored as base64 in the database from Access Labs API response.
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

    const { id } = params;

    // Validate ID format (should be a number)
    const orderId = parseInt(id, 10);
    if (isNaN(orderId)) {
        return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    const client = await getPool().connect();
    try {
        const result = await client.query(
            `SELECT requisition_pdf, patient_first_name, patient_last_name, external_order_id 
             FROM lab_orders WHERE id = $1`,
            [orderId]
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        const order = result.rows[0];

        if (!order.requisition_pdf) {
            return NextResponse.json(
                { error: 'Requisition PDF not available for this order' },
                { status: 404 }
            );
        }

        // Decode base64 to binary
        const pdfBuffer = Buffer.from(order.requisition_pdf, 'base64');

        // Generate filename
        const patientName = `${order.patient_first_name || ''}_${order.patient_last_name || ''}`.trim().replace(/\s+/g, '_') || 'patient';
        const orderNumber = order.external_order_id || orderId;
        const filename = `Lab_Requisition_${patientName}_${orderNumber}.pdf`;

        return new NextResponse(pdfBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="${filename}"`,
                'Content-Length': pdfBuffer.length.toString(),
                'Cache-Control': 'private, max-age=3600', // Cache for 1 hour
            },
        });

    } finally {
        client.release();
    }
}
