import { NextRequest, NextResponse } from 'next/server';
import {
  fetchInvoiceById,
  placeAndRecordOrder,
  getMcKessonAccountId,
  getMcKessonShipToAccountId,
  isMcKessonConfigured,
} from '@/lib/mckesson';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mckesson/invoices/[id]/reorder
 *
 * Builds and (optionally) submits a new McKesson order with the same lines as
 * the source invoice.
 *
 * Body:
 *   {
 *     dryRun?: boolean        (default true — returns the draft, doesn't submit)
 *     poNumber?: string       (defaults to "REORDER-<original PO>-<date>")
 *     overrideQuantities?: { [product_id]: number }  // tweak qty per line
 *     dropProductIds?: string[]                       // omit lines
 *   }
 *
 * Submitting requires MCKESSON_ALLOW_PRODUCTION_ORDERS=true (gated in placeAndRecordOrder).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!isMcKessonConfigured()) {
      return NextResponse.json({ error: 'McKesson not configured' }, { status: 503 });
    }
    const id = parseInt(params.id, 10);
    if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const dryRun = body.dryRun !== false;  // default true
    const overrideQuantities: Record<string, number> = body.overrideQuantities || {};
    const dropProductIds: string[] = body.dropProductIds || [];

    const { invoice, lines } = await fetchInvoiceById(id);
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    if (lines.length === 0) {
      return NextResponse.json({
        error: 'Invoice has no line items. Enter them manually before reordering.',
      }, { status: 400 });
    }

    // Build the reorder payload
    const sourcePo = invoice.purchase_order_number || invoice.invoice_id;
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const poNumber = (body.poNumber || `REORDER-${sourcePo}-${today}`).slice(0, 30);

    const items = lines
      .filter((l: any) => l.product_id && !dropProductIds.includes(l.product_id))
      .map((l: any) => {
        const qty = overrideQuantities[l.product_id]
          ?? Number(l.quantity_ordered)
          ?? Number(l.quantity_shipped)
          ?? 1;
        return {
          mckItemId: String(l.product_id),
          quantity: Math.max(1, Math.floor(Number(qty) || 1)),
          unitOfMeasure: l.unit_of_measure || 'EA',
          supplyItemId: l.matched_supply_item_id ?? undefined,
          // For preview only — not sent to McKesson
          _description: l.product_description,
          _unit_price: l.price,
        };
      });

    if (items.length === 0) {
      return NextResponse.json({ error: 'No orderable lines after filters' }, { status: 400 });
    }

    const accountId = getMcKessonAccountId();
    const shipToAccountId = getMcKessonShipToAccountId();
    const draft = {
      accountId, shipToAccountId, poNumber,
      items: items.map(({ _description, _unit_price, ...rest }) => rest),
      preview: {
        sourceInvoiceId: invoice.invoice_id,
        sourceOrderId: invoice.order_id,
        sourcePoName: invoice.purchase_order_number,
        lineCount: items.length,
        totalEstimate: items.reduce(
          (sum, l: any) => sum + (Number(l._unit_price) || 0) * l.quantity, 0
        ),
        items: items.map((l: any) => ({
          product_id: l.mckItemId,
          description: l._description,
          quantity: l.quantity,
          uom: l.unitOfMeasure,
          unit_price: l._unit_price,
          line_total: (Number(l._unit_price) || 0) * l.quantity,
        })),
      },
    };

    if (dryRun) {
      return NextResponse.json({ dryRun: true, draft });
    }

    // Live submit
    const result = await placeAndRecordOrder(
      accountId,
      items.map(({ _description, _unit_price, ...rest }) => rest),
      shipToAccountId,
      poNumber,
      'reorder-from-invoice',
    );
    return NextResponse.json({
      dryRun: false,
      submitted: true,
      orderId: result.mckResponse.orderId,
      dbOrderId: result.dbOrder.id,
      poNumber,
      validation: result.mckResponse.validation,
    });
  } catch (err: any) {
    console.error('[INVOICES] reorder failed:', err);
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
