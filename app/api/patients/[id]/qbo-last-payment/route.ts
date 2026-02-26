import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

type PaymentRow = {
    payment_date: string | null;
    amount: string | null;
};

export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    const patientId = params.id;

    if (!patientId) {
        return NextResponse.json({ error: 'Patient ID required' }, { status: 400 });
    }

    try {
        // Query quickbooks_sales_receipts for most recent completed sales receipt
        // This is where recurring payment data is stored (not quickbooks_payments which is for invoices)
        const rows = await query<PaymentRow>(
            `SELECT receipt_date::text as payment_date, amount::text as amount
       FROM quickbooks_sales_receipts
       WHERE patient_id = $1
       AND status = 'Completed'
       ORDER BY receipt_date DESC
       LIMIT 1`,
            [patientId]
        );

        if (rows.length === 0) {
            return NextResponse.json({ lastPayment: null });
        }

        return NextResponse.json({
            lastPayment: {
                date: rows[0].payment_date,
                amount: rows[0].amount ? parseFloat(rows[0].amount) : null
            }
        });
    } catch (error) {
        console.error('Error fetching QBO payment:', error);
        return NextResponse.json({ error: 'Failed to fetch payment data' }, { status: 500 });
    }
}
