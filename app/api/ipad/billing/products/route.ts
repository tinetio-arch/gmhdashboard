import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request, 'read');

    const q = request.nextUrl.searchParams.get('q') || '';
    const result = await query<{
      product_id: string;
      name: string;
      price: number;
      cost: number;
      supplier: string;
      category: string;
      current_stock: number;
    }>(
      `SELECT
        p.product_id,
        p.name,
        p.sell_price as price,
        p.unit_cost as cost,
        p.supplier,
        p.category,
        COALESCE((SELECT SUM(o.quantity) FROM peptide_orders o WHERE o.product_id = p.product_id), 0)
          - COALESCE((SELECT SUM(d.quantity) FROM peptide_dispenses d WHERE d.product_id = p.product_id AND d.status = 'Paid' AND d.education_complete = true), 0)
          AS current_stock
      FROM peptide_products p
      WHERE p.active = true
        AND REPLACE(REPLACE(REPLACE(LOWER(p.name), '-', ''), ' ', ''), '.', '')
            ILIKE '%' || REPLACE(REPLACE(REPLACE(LOWER($1), '-', ''), ' ', ''), '.', '') || '%'
      ORDER BY p.name
      LIMIT 50`,
      [q || '']
    );

    return NextResponse.json({ success: true, products: result });
  } catch (error: any) {
    if (error?.status === 401 || error?.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[billing/products] Error:', error.message);
    return NextResponse.json({ success: false, error: 'Failed to fetch products' }, { status: 500 });
  }
}
