/**
 * Peptide Sales API
 * GET - Fetch sales history
 * POST - Record sale (manual or from webhook)
 */

import { NextResponse } from 'next/server';
import { fetchPeptideSales, createPeptideSale } from '@/lib/peptideQueries';
import { requireUser } from '@/lib/auth';

export async function GET() {
    try {
        await requireUser('read');
        const sales = await fetchPeptideSales();
        return NextResponse.json(sales);
    } catch (error) {
        console.error('Error fetching peptide sales:', error);
        return NextResponse.json(
            { error: 'Failed to fetch peptide sales' },
            { status: 500 }
        );
    }
}

export async function POST(request: Request) {
    try {
        const user = await requireUser('write');
        const body = await request.json();

        // Validate required fields
        if (!body.product_id || !body.sale_date) {
            return NextResponse.json(
                { error: 'product_id and sale_date are required' },
                { status: 400 }
            );
        }

        const sale = await createPeptideSale({
            product_id: body.product_id,
            quantity: body.quantity ? Number(body.quantity) : 1,
            sale_date: body.sale_date,
            patient_name: body.patient_name,
            healthie_client_id: body.healthie_client_id,
            healthie_billing_item_id: body.healthie_billing_item_id,
            paid: body.paid !== false, // Default to true
            notes: body.notes || `Manual entry by ${user.name || user.email}`,
        });

        return NextResponse.json(sale);
    } catch (error) {
        console.error('Error creating peptide sale:', error);
        return NextResponse.json(
            { error: 'Failed to create peptide sale' },
            { status: 500 }
        );
    }
}
