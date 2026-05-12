import { NextRequest, NextResponse } from 'next/server';
import { fetchInvoiceRows } from '@/lib/mckesson';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mckesson/invoices
 *   ?pending=true → only invoices missing details
 *   ?search=...   → match invoice_id / order_id / PO name
 *   ?limit=N
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '200', 10);
    const pendingDetailsOnly = url.searchParams.get('pending') === 'true';
    const search = url.searchParams.get('search') || undefined;

    const items = await fetchInvoiceRows({ limit, pendingDetailsOnly, search });

    // Light shape — strip the heavy raw_response blob from list view
    const list = items.map((i) => ({
      id: i.id,
      invoice_id: i.invoice_id,
      order_id: i.order_id,
      account_id: i.account_id,
      ship_to_id: i.ship_to_id,
      invoice_date: i.invoice_date,
      invoice_due_date: i.invoice_due_date,
      order_date: i.order_date,
      status: i.status,
      purchase_order_number: i.purchase_order_number,
      sub_total: i.sub_total,
      tax_total: i.tax_total,
      net_total: i.net_total,
      discount_total: i.discount_total,
      details_fetched_at: i.details_fetched_at,
      first_seen_at: i.first_seen_at,
    }));

    return NextResponse.json({
      items: list,
      totals: {
        all: list.length,
        pending: list.filter((i) => !i.details_fetched_at).length,
        with_details: list.filter((i) => i.details_fetched_at).length,
      },
    });
  } catch (err: any) {
    console.error('[INVOICES] list failed:', err);
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
