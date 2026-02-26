import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { getPool } from '@/lib/db';

/**
 * DELETE /api/labs/orders/[id]
 * 
 * Deletes a lab order from the local database.
 * Note: This does NOT cancel the order at Access Labs - contact them directly if needed.
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: { id: string } }
): Promise<Response> {
    try {
        await requireApiUser(request, 'write');
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        throw error;
    }

    const { id } = params;

    // Validate ID format
    const orderId = parseInt(id, 10);
    if (isNaN(orderId)) {
        return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    const client = await getPool().connect();
    try {
        // Check if order exists first
        const checkResult = await client.query(
            'SELECT id, status, external_order_id FROM lab_orders WHERE id = $1',
            [orderId]
        );

        if (checkResult.rows.length === 0) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        const order = checkResult.rows[0];

        // Delete the order
        await client.query('DELETE FROM lab_orders WHERE id = $1', [orderId]);

        console.log(`[lab-orders] Deleted order ${orderId} (external: ${order.external_order_id || 'N/A'})`);

        return NextResponse.json({
            success: true,
            message: 'Order deleted from dashboard',
            note: order.status === 'submitted'
                ? 'Note: The order has already been sent to Access Labs. Contact them directly to cancel if needed.'
                : undefined
        });

    } finally {
        client.release();
    }
}
