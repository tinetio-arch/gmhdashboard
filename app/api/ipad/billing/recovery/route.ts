/**
 * GET /api/ipad/billing/recovery?idempotency_key=XXX
 *
 * Look up a payment_transactions row by idempotency_key. Used by the iPad to
 * recover state when a charge fetch times out / loses connection — staff can
 * see whether the charge actually went through before retrying (and thus avoid
 * a double-charge). Coby Cook April 15 case.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        await requireApiUser(request, 'read');
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        throw error;
    }

    const key = request.nextUrl.searchParams.get('idempotency_key');
    if (!key) {
        return NextResponse.json({ error: 'idempotency_key required' }, { status: 400 });
    }

    try {
        const [row] = await query<any>(
            `SELECT transaction_id, amount, description, status, error_message,
                    stripe_charge_id, receipt_number, healthie_document_id, created_at
             FROM payment_transactions WHERE idempotency_key = $1 LIMIT 1`,
            [key]
        );
        if (!row) {
            return NextResponse.json({ found: false });
        }
        return NextResponse.json({
            found: true,
            transaction: {
                transaction_id: row.transaction_id,
                amount: parseFloat(row.amount),
                description: row.description,
                status: row.status,
                error_message: row.error_message,
                charge_id: row.stripe_charge_id,
                receipt_number: row.receipt_number,
                healthie_document_id: row.healthie_document_id,
                created_at: row.created_at,
            },
        });
    } catch (e: any) {
        console.error('[ipad/billing/recovery]', e);
        return NextResponse.json({ error: e.message || 'Failed' }, { status: 500 });
    }
}
