/**
 * Peptide Order — Single Order API
 * PATCH - Edit quantity / po_number / notes on an existing order
 */

import { NextRequest, NextResponse } from 'next/server';
import { updatePeptideOrder } from '@/lib/peptideQueries';
import { requireApiUser } from '@/lib/auth';

export async function PATCH(
    request: NextRequest,
    { params }: { params: { orderId: string } }
) {
    try {
        const user = await requireApiUser(request, 'write');
        const body = await request.json();

        const patch: { quantity?: number; po_number?: string | null; notes?: string | null } = {};

        if (body.quantity !== undefined) {
            const q = Number(body.quantity);
            if (!Number.isFinite(q) || q < 0) {
                return NextResponse.json({ error: 'quantity must be a non-negative number' }, { status: 400 });
            }
            patch.quantity = q;
        }
        if (body.po_number !== undefined) patch.po_number = body.po_number || null;
        if (body.notes !== undefined) patch.notes = body.notes || null;

        if (Object.keys(patch).length === 0) {
            return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
        }

        const updated = await updatePeptideOrder(params.orderId, patch);
        if (!updated) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        console.log(`[peptides] Order ${params.orderId} edited by ${user.name || user.email}:`, patch);
        return NextResponse.json(updated);
    } catch (error: any) {
        if (error?.name === 'UnauthorizedError') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('Error updating peptide order:', errMsg);
        return NextResponse.json({ error: `Failed to update order: ${errMsg}` }, { status: 500 });
    }
}
