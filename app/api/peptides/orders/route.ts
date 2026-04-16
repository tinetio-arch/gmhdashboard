/**
 * Peptide Orders API
 * GET - Fetch order history
 * POST - Record incoming shipment
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchPeptideOrders, createPeptideOrder } from '@/lib/peptideQueries';
import { requireApiUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
    try {
        await requireApiUser(request, 'read');
        const orders = await fetchPeptideOrders();
        return NextResponse.json(orders);
    } catch (error: any) {
        if (error?.name === 'UnauthorizedError') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('Error fetching peptide orders:', errMsg);
        return NextResponse.json(
            { error: `Failed to fetch peptide orders: ${errMsg}` },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await requireApiUser(request, 'write');
        const body = await request.json();

        // Validate required fields
        if (!body.product_id || !body.quantity || !body.order_date) {
            return NextResponse.json(
                { error: 'product_id, quantity, and order_date are required' },
                { status: 400 }
            );
        }

        const order = await createPeptideOrder({
            product_id: body.product_id,
            quantity: Number(body.quantity),
            order_date: body.order_date,
            po_number: body.po_number,
            notes: body.notes,
            created_by: user.name || user.email,
        });

        return NextResponse.json(order);
    } catch (error: any) {
        if (error?.name === 'UnauthorizedError') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('Error creating peptide order:', errMsg);
        return NextResponse.json(
            { error: `Failed to create peptide order: ${errMsg}` },
            { status: 500 }
        );
    }
}
