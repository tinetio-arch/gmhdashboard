import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  await requireApiUser(request, 'read');

  const q = request.nextUrl.searchParams.get('q') || '';

  try {
    const result = await query<{
      product_id: number;
      name: string;
      price: number;
      cost: number;
      supplier: string;
      category: string;
    }>(
      `SELECT
        product_id,
        name,
        sell_price as price,
        unit_cost as cost,
        supplier,
        category
      FROM peptide_products
      WHERE active = true
        AND REPLACE(REPLACE(REPLACE(LOWER(name), '-', ''), ' ', ''), '.', '')
            ILIKE '%' || REPLACE(REPLACE(REPLACE(LOWER($1), '-', ''), ' ', ''), '.', '') || '%'
      ORDER BY name
      LIMIT 50`,
      [q || '']
    );

    return NextResponse.json({ success: true, products: result });
  } catch (error: any) {
    console.error('[billing/products] Error:', error.message);
    return NextResponse.json({ success: false, error: 'Failed to fetch products' }, { status: 500 });
  }
}
