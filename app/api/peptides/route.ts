/**
 * Peptide Inventory API
 * GET - Fetch all peptides with calculated inventory
 */

import { NextResponse } from 'next/server';
import { fetchPeptideInventory, fetchPeptideInventorySummary, fetchPeptideProductOptions, createPeptideProduct, deactivatePeptideProduct, reactivatePeptideProduct, updatePeptideProduct } from '@/lib/peptideQueries';
import { requireUser } from '@/lib/auth';

export async function GET(request: Request) {
    try {
        await requireUser('read');

        const url = new URL(request.url);
        const action = url.searchParams.get('action');

        if (action === 'summary') {
            const summary = await fetchPeptideInventorySummary();
            return NextResponse.json(summary);
        }

        if (action === 'options') {
            const options = await fetchPeptideProductOptions();
            return NextResponse.json(options);
        }

        // Default: return full inventory
        const includeInactive = url.searchParams.get('includeInactive') === 'true';
        const inventory = await fetchPeptideInventory(includeInactive);
        return NextResponse.json(inventory);

    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('Error fetching peptide inventory:', errMsg);
        return NextResponse.json(
            { error: `Failed to fetch peptide inventory: ${errMsg}` },
            { status: 500 }
        );
    }
}

export async function POST(request: Request) {
    try {
        await requireUser('write');
        const body = await request.json();

        if (!body.name || !body.category) {
            return NextResponse.json(
                { error: 'name and category are required' },
                { status: 400 }
            );
        }

        const product = await createPeptideProduct({
            name: body.name,
            category: body.category,
            sku: body.sku || undefined,
            reorder_point: body.reorder_point ? Number(body.reorder_point) : undefined,
            supplier: body.supplier || undefined,
            unit_cost: body.unit_cost ? Number(body.unit_cost) : undefined,
            sell_price: body.sell_price ? Number(body.sell_price) : undefined,
            label_directions: body.label_directions || undefined,
            healthie_product_id: body.healthie_product_id || undefined,
        });

        return NextResponse.json(product);
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('Error creating peptide product:', {
            error: errMsg,
            body,
            stack: error instanceof Error ? error.stack : undefined,
        });
        return NextResponse.json(
            { error: `Failed to create peptide product: ${errMsg}` },
            { status: 500 }
        );
    }
}

export async function DELETE(request: Request) {
    try {
        await requireUser('write');
        const url = new URL(request.url);
        const productId = url.searchParams.get('id');

        if (!productId) {
            return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
        }

        const result = await deactivatePeptideProduct(productId);
        return NextResponse.json({ deactivated: true, name: result.name });
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('Error deleting peptide product:', errMsg);
        return NextResponse.json(
            { error: errMsg },
            { status: 400 }
        );
    }
}

export async function PATCH(request: Request) {
    try {
        await requireUser('write');
        const body = await request.json();
        const { product_id, ...updates } = body;

        if (!product_id) {
            return NextResponse.json({ error: 'product_id is required' }, { status: 400 });
        }

        if (body.reactivate && body.product_id) {
            await reactivatePeptideProduct(body.product_id);
            return NextResponse.json({ success: true, reactivated: true });
        }

        await updatePeptideProduct(product_id, updates);
        return NextResponse.json({ success: true });
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('Error updating peptide product:', errMsg);
        return NextResponse.json({ error: errMsg }, { status: 400 });
    }
}
