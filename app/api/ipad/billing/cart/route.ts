import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET — load a patient's saved cart
export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request, 'read');

    const patientId = request.nextUrl.searchParams.get('patient_id');
    if (!patientId) {
      return NextResponse.json({ error: 'patient_id required' }, { status: 400 });
    }
    const items = await query<{
      id: number;
      product_id: string;
      product_name: string;
      price: number;
      quantity: number;
      added_by: string;
      current_stock: number;
    }>(`
      SELECT
        c.id, c.product_id, c.product_name, c.price, c.quantity, c.added_by,
        COALESCE((SELECT SUM(o.quantity) FROM peptide_orders o WHERE o.product_id::text = c.product_id), 0)
          - COALESCE((SELECT SUM(d.quantity) FROM peptide_dispenses d WHERE d.product_id::text = c.product_id AND d.status = 'Paid' AND d.education_complete = true), 0)
          AS current_stock
      FROM patient_billing_cart c
      WHERE c.patient_id = $1
      ORDER BY c.created_at
    `, [patientId]);

    return NextResponse.json({ success: true, items });
  } catch (error: any) {
    if (error?.status === 401 || error?.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[billing/cart GET] Error:', error.message);
    return NextResponse.json({ success: false, error: 'Failed to load cart' }, { status: 500 });
  }
}

// POST — add item to cart or update quantity
export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request, 'write');
    const body = await request.json();
    const { patient_id, patient_name, product_id, product_name, price, quantity } = body;

    if (!patient_id || !product_id || !product_name || !price) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Check if this product is already in the cart
    const existing = await query<{ id: number; quantity: number }>(
      'SELECT id, quantity FROM patient_billing_cart WHERE patient_id = $1 AND product_id = $2',
      [patient_id, product_id]
    );

    if (existing.length > 0) {
      // Update quantity
      const newQty = existing[0].quantity + (quantity || 1);
      await query(
        'UPDATE patient_billing_cart SET quantity = $1, updated_at = NOW() WHERE id = $2',
        [newQty, existing[0].id]
      );
    } else {
      // Insert new
      await query(
        `INSERT INTO patient_billing_cart (patient_id, patient_name, product_id, product_name, price, quantity, added_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [patient_id, patient_name || 'Patient', product_id, product_name, price, quantity || 1, (user as any).email || 'unknown']
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.status === 401 || error?.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[billing/cart POST] Error:', error.message);
    return NextResponse.json({ success: false, error: 'Failed to add to cart' }, { status: 500 });
  }
}

// PATCH — update quantity for a cart item
export async function PATCH(request: NextRequest) {
  try {
    await requireApiUser(request, 'write');
    const body = await request.json();
    const { id, quantity } = body;

    if (!id || quantity == null) {
      return NextResponse.json({ error: 'id and quantity required' }, { status: 400 });
    }

    if (quantity <= 0) {
      await query('DELETE FROM patient_billing_cart WHERE id = $1', [id]);
    } else {
      await query('UPDATE patient_billing_cart SET quantity = $1, updated_at = NOW() WHERE id = $2', [quantity, id]);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.status === 401 || error?.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[billing/cart PATCH] Error:', error.message);
    return NextResponse.json({ success: false, error: 'Failed to update cart' }, { status: 500 });
  }
}

// DELETE — clear cart for a patient or remove one item
export async function DELETE(request: NextRequest) {
  try {
    await requireApiUser(request, 'write');

    const patientId = request.nextUrl.searchParams.get('patient_id');
    const itemId = request.nextUrl.searchParams.get('id');
    if (itemId) {
      await query('DELETE FROM patient_billing_cart WHERE id = $1', [itemId]);
    } else if (patientId) {
      await query('DELETE FROM patient_billing_cart WHERE patient_id = $1', [patientId]);
    } else {
      return NextResponse.json({ error: 'patient_id or id required' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.status === 401 || error?.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[billing/cart DELETE] Error:', error.message);
    return NextResponse.json({ success: false, error: 'Failed to delete' }, { status: 500 });
  }
}
