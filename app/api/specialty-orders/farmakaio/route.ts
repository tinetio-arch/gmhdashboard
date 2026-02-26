/**
 * Farmakaio Orders API
 * GET - Fetch all orders
 * POST - Create new order
 * PATCH - Update order (status, notes, etc.)
 */

import { NextResponse } from 'next/server';
import { fetchFarmakaioOrders, createFarmakaioOrder, updateFarmakaioOrder } from '@/lib/specialtyOrderQueries';
import { requireUser } from '@/lib/auth';

export async function GET() {
    try {
        await requireUser('read');
        const orders = await fetchFarmakaioOrders();
        return NextResponse.json(orders);
    } catch (error) {
        console.error('Error fetching farmakaio orders:', error);
        return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        await requireUser('write');
        const body = await request.json();

        if (!body.patient_name) {
            return NextResponse.json({ error: 'patient_name is required' }, { status: 400 });
        }

        const order = await createFarmakaioOrder({
            patient_name: body.patient_name,
            medication_ordered: body.medication_ordered,
            date_ordered: body.date_ordered,
            status: body.status,
            order_in_chart: body.order_in_chart,
            ordered_to: body.ordered_to,
            patient_received: body.patient_received,
            notes: body.notes,
        });

        return NextResponse.json(order);
    } catch (error) {
        console.error('Error creating farmakaio order:', error);
        return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    try {
        await requireUser('write');
        const body = await request.json();

        if (!body.order_id) {
            return NextResponse.json({ error: 'order_id is required' }, { status: 400 });
        }

        await updateFarmakaioOrder(body.order_id, {
            patient_name: body.patient_name,
            medication_ordered: body.medication_ordered,
            date_ordered: body.date_ordered,
            status: body.status,
            order_in_chart: body.order_in_chart,
            ordered_to: body.ordered_to,
            patient_received: body.patient_received,
            notes: body.notes,
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error updating farmakaio order:', error);
        return NextResponse.json({ error: 'Failed to update order' }, { status: 500 });
    }
}
