/**
 * Generic Pharmacy Orders API
 * Handles all pharmacy types: tirzepatide, farmakaio, olympia, toprx, carrieboyd
 */

import { NextResponse } from 'next/server';
import { fetchPharmacyOrders, createPharmacyOrder, updatePharmacyOrder, deletePharmacyOrder, PharmacyType } from '@/lib/specialtyOrderQueries';
import { requireUser } from '@/lib/auth';

const VALID_PHARMACIES: PharmacyType[] = ['tirzepatide', 'farmakaio', 'olympia', 'toprx', 'carrieboyd'];

export async function GET(request: Request) {
    try {
        await requireUser('read');
        const { searchParams } = new URL(request.url);
        const pharmacy = searchParams.get('pharmacy') as PharmacyType;

        if (!pharmacy || !VALID_PHARMACIES.includes(pharmacy)) {
            return NextResponse.json({ error: 'Invalid pharmacy type' }, { status: 400 });
        }

        const orders = await fetchPharmacyOrders(pharmacy);
        return NextResponse.json(orders);
    } catch (error) {
        console.error('Error fetching pharmacy orders:', error);
        return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        await requireUser('write');
        const body = await request.json();
        const pharmacy = body.pharmacy as PharmacyType;

        if (!pharmacy || !VALID_PHARMACIES.includes(pharmacy)) {
            return NextResponse.json({ error: 'Invalid pharmacy type' }, { status: 400 });
        }

        if (!body.patient_name) {
            return NextResponse.json({ error: 'patient_name is required' }, { status: 400 });
        }

        const order = await createPharmacyOrder(pharmacy, {
            patient_name: body.patient_name,
            medication_ordered: body.medication_ordered,
            dose: body.dose,
            order_number: body.order_number,
            date_ordered: body.date_ordered,
            status: body.status,
            order_in_chart: body.order_in_chart,
            ordered_to: body.ordered_to,
            patient_received: body.patient_received,
            notes: body.notes,
            is_office_use: body.is_office_use,
            healthie_patient_id: body.healthie_patient_id,
            healthie_patient_name: body.healthie_patient_name,
        });

        return NextResponse.json(order);
    } catch (error) {
        console.error('Error creating pharmacy order:', error);
        return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    try {
        await requireUser('write');
        const body = await request.json();
        const pharmacy = body.pharmacy as PharmacyType;

        if (!pharmacy || !VALID_PHARMACIES.includes(pharmacy)) {
            return NextResponse.json({ error: 'Invalid pharmacy type' }, { status: 400 });
        }

        if (!body.order_id) {
            return NextResponse.json({ error: 'order_id is required' }, { status: 400 });
        }

        await updatePharmacyOrder(pharmacy, body.order_id, {
            patient_name: body.patient_name,
            medication_ordered: body.medication_ordered,
            dose: body.dose,
            order_number: body.order_number,
            date_ordered: body.date_ordered,
            status: body.status,
            order_in_chart: body.order_in_chart,
            ordered_to: body.ordered_to,
            patient_received: body.patient_received,
            notes: body.notes,
            is_office_use: body.is_office_use,
            healthie_patient_id: body.healthie_patient_id,
            healthie_patient_name: body.healthie_patient_name,
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error updating pharmacy order:', error);
        return NextResponse.json({ error: 'Failed to update order' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        await requireUser('write');
        const { searchParams } = new URL(request.url);
        const pharmacy = searchParams.get('pharmacy') as PharmacyType;
        const orderId = searchParams.get('order_id');

        if (!pharmacy || !VALID_PHARMACIES.includes(pharmacy)) {
            return NextResponse.json({ error: 'Invalid pharmacy type' }, { status: 400 });
        }

        if (!orderId) {
            return NextResponse.json({ error: 'order_id is required' }, { status: 400 });
        }

        await deletePharmacyOrder(pharmacy, orderId);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting pharmacy order:', error);
        return NextResponse.json({ error: 'Failed to delete order' }, { status: 500 });
    }
}
