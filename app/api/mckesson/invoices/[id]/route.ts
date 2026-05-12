import { NextRequest, NextResponse } from 'next/server';
import {
  fetchInvoiceById,
  getInvoiceDetails,
  persistInvoiceDetails,
  getMcKessonAccountId,
} from '@/lib/mckesson';
import { query, getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mckesson/invoices/[id]
 * Returns one invoice + line items (joined to supply_items where matched).
 * Optional ?refresh=true tries to fetch live details from McKesson if order_id is set.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const url = new URL(request.url);
    const refresh = url.searchParams.get('refresh') === 'true';

    let { invoice, lines } = await fetchInvoiceById(id);
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (refresh && invoice.order_id) {
      try {
        const acct = invoice.account_id || getMcKessonAccountId();
        const live = await getInvoiceDetails(acct, invoice.order_id, invoice.invoice_id);
        await persistInvoiceDetails(id, live, live);
        const reloaded = await fetchInvoiceById(id);
        invoice = reloaded.invoice;
        lines = reloaded.lines;
      } catch (e: any) {
        // Don't fail the read; just attach a hint
        return NextResponse.json({
          invoice, lines,
          refresh_error: e.message || String(e),
        });
      }
    }

    return NextResponse.json({ invoice, lines });
  } catch (err: any) {
    console.error('[INVOICES] get failed:', err);
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}

/**
 * PATCH /api/mckesson/invoices/[id]
 * Body can include any of:
 *   - order_id: string                    (caller-provided when known)
 *   - status, purchase_order_number, etc. (manual edits)
 *   - manual_lines: InvoiceLineInput[]    (full set of line items the user typed in)
 *
 * If order_id is set AND no manual_lines, we attempt a live fetch via getInvoiceDetails.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const body = await request.json();
    const updates: Record<string, unknown> = {};
    const allowed = [
      'order_id', 'status', 'purchase_order_number',
      'invoice_date', 'invoice_due_date', 'order_date',
      'sub_total', 'tax_total', 'net_total', 'discount_total',
    ];
    for (const k of allowed) if (k in body) updates[k] = body[k] === '' ? null : body[k];

    if (Object.keys(updates).length > 0) {
      const fields = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
      await query(
        `UPDATE mckesson_invoices SET ${fields}, updated_at = NOW() WHERE id = $1`,
        [id, ...Object.values(updates)]
      );
    }

    // Manual line items: replace existing
    if (Array.isArray(body.manual_lines)) {
      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM mckesson_invoice_lines WHERE invoice_id = $1`, [id]);
        for (const ln of body.manual_lines) {
          // Match against supply_items
          const m = ln.product_id
            ? await client.query<{ id: number }>(
                `SELECT id FROM supply_items WHERE mckesson_item_id = $1 LIMIT 1`,
                [ln.product_id]
              )
            : { rows: [] as { id: number }[] };
          const matchedId = m.rows[0]?.id ?? null;

          await client.query(
            `INSERT INTO mckesson_invoice_lines
              (invoice_id, line_number, product_id, product_description, manufacturer,
               unit_of_measure, quantity_ordered, quantity_shipped, price, freight,
               tax_total, sub_total, net_total, discount_total, line_status,
               line_invoice_date, matched_supply_item_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NULLIF($16,'')::date, $17)`,
            [
              id,
              ln.line_number ?? null,
              ln.product_id ?? null,
              ln.product_description ?? null,
              ln.manufacturer ?? null,
              ln.unit_of_measure ?? null,
              ln.quantity_ordered ?? null,
              ln.quantity_shipped ?? null,
              ln.price ?? null,
              ln.freight ?? null,
              ln.tax_total ?? null,
              ln.sub_total ?? null,
              ln.net_total ?? null,
              ln.discount_total ?? null,
              ln.line_status ?? null,
              ln.line_invoice_date || '',
              matchedId,
            ]
          );

          // Auto-populate supply_items.unit_cost if matched & price given
          if (matchedId && ln.price != null && ln.unit_of_measure) {
            const inv = await client.query<{ invoice_id: string }>(
              `SELECT invoice_id FROM mckesson_invoices WHERE id = $1`, [id]
            );
            await client.query(
              `UPDATE supply_items
                 SET unit_cost            = $2,
                     unit_cost_uom        = $3,
                     unit_cost_source     = $4,
                     unit_cost_updated_at = NOW(),
                     updated_at           = NOW()
               WHERE id = $1
                 AND (unit_cost_source IS NULL OR unit_cost_source LIKE 'mckesson invoice%')`,
              [matchedId, ln.price, ln.unit_of_measure, `mckesson invoice ${inv.rows[0]?.invoice_id}`]
            );
          }
        }
        await client.query(`UPDATE mckesson_invoices SET details_fetched_at = NOW(), updated_at = NOW() WHERE id = $1`, [id]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }

    // If order_id is set and no manual lines, attempt API fetch
    if (updates.order_id && !Array.isArray(body.manual_lines)) {
      const inv = await query<{ account_id: string; order_id: string; invoice_id: string }>(
        `SELECT account_id, order_id, invoice_id FROM mckesson_invoices WHERE id = $1`, [id]
      );
      if (inv[0]) {
        try {
          const live = await getInvoiceDetails(inv[0].account_id, inv[0].order_id, inv[0].invoice_id);
          await persistInvoiceDetails(id, live, live);
          return NextResponse.json({ ok: true, fetched_from_api: true });
        } catch (e: any) {
          return NextResponse.json({
            ok: true,
            fetched_from_api: false,
            api_error: e.message || String(e),
            hint: 'order_id saved, but McKesson detail fetch failed. Use manual_lines path to enter line items.',
          });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[INVOICES] patch failed:', err);
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
