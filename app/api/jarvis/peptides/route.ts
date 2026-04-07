import { NextRequest, NextResponse } from 'next/server';
import { fetchPeptideProductOptions, checkPeptideStock } from '@/lib/peptideQueries';

/**
 * GET /api/jarvis/peptides
 * Returns peptide catalog with stock info for the JARVIS peptide bot.
 * Query params: ?name=BPC-157 (optional — returns stock for specific peptide)
 * Auth: x-jarvis-secret header
 */
export async function GET(request: NextRequest) {
    const secret = request.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const name = request.nextUrl.searchParams.get('name');

        if (name) {
            // Look up specific peptide stock
            const products = await fetchPeptideProductOptions();
            const match = products.find(p =>
                p.label.toLowerCase().includes(name.toLowerCase())
            );

            if (!match) {
                return NextResponse.json({ in_stock: false, quantity: 0, found: false });
            }

            const stock = await checkPeptideStock(match.value);
            return NextResponse.json({
                in_stock: stock.in_stock,
                quantity: stock.quantity,
                name: match.label,
                product_id: match.value,
                found: true,
            });
        }

        // Return full catalog
        const products = await fetchPeptideProductOptions();
        return NextResponse.json({ products });
    } catch (error) {
        console.error('[Jarvis Peptides] Error:', error);
        return NextResponse.json({ error: 'Failed to fetch peptide data' }, { status: 500 });
    }
}
