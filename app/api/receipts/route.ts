import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireApiKey } from '@/lib/apiAuth';

export async function GET(request: NextRequest) {
    try {
        // Check API authentication if needed
        const authResult = await requireApiKey(request);
        if (!authResult.authenticated && request.headers.get('x-api-key')) {
            return NextResponse.json({ error: authResult.error }, { status: 401 });
        }

        // Get query parameters
        const searchParams = request.nextUrl.searchParams;
        const patientId = searchParams.get('patient_id');
        const limit = parseInt(searchParams.get('limit') || '50');
        const offset = parseInt(searchParams.get('offset') || '0');
        const hasReceipt = searchParams.get('has_receipt');

        // Build query
        let queryStr = `
            SELECT
                pt.transaction_id,
                pt.patient_id,
                pt.amount,
                pt.description,
                pt.stripe_account,
                pt.healthie_billing_item_id,
                pt.stripe_charge_id,
                pt.status,
                pt.receipt_number,
                pt.healthie_document_id,
                pt.created_at,
                p.full_name as patient_name,
                p.email as patient_email,
                hc.healthie_client_id
            FROM payment_transactions pt
            LEFT JOIN patients p ON pt.patient_id = p.patient_id
            LEFT JOIN healthie_clients hc ON p.patient_id::text = hc.patient_id
            WHERE pt.status NOT IN ('consent_signed', 'consent_sent')
              AND pt.amount != 0
        `;

        const params: any[] = [];
        let paramIndex = 1;

        // Add filters
        if (patientId) {
            queryStr += ` AND pt.patient_id = $${paramIndex}::uuid`;
            params.push(patientId);
            paramIndex++;
        }

        if (hasReceipt === 'true') {
            queryStr += ` AND pt.receipt_number IS NOT NULL AND pt.healthie_document_id IS NOT NULL`;
        } else if (hasReceipt === 'false') {
            queryStr += ` AND (pt.receipt_number IS NULL OR pt.healthie_document_id IS NULL)`;
        }

        // Add ordering and pagination
        queryStr += ` ORDER BY pt.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        // Execute query
        const result = await query(queryStr, params);

        // Get total count for pagination
        let countQuery = `
            SELECT COUNT(*) as total
            FROM payment_transactions pt
            WHERE pt.status NOT IN ('consent_signed', 'consent_sent')
              AND pt.amount != 0
        `;
        const countParams: any[] = [];
        let countParamIndex = 1;

        if (patientId) {
            countQuery += ` AND pt.patient_id = $${countParamIndex}::uuid`;
            countParams.push(patientId);
            countParamIndex++;
        }

        if (hasReceipt === 'true') {
            countQuery += ` AND pt.receipt_number IS NOT NULL AND pt.healthie_document_id IS NOT NULL`;
        } else if (hasReceipt === 'false') {
            countQuery += ` AND (pt.receipt_number IS NULL OR pt.healthie_document_id IS NULL)`;
        }

        const countResult = await query(countQuery, countParams);
        const total = parseInt(countResult[0]?.total || '0');

        // Format response
        const transactions = result.map((row: any) => ({
            transactionId: row.transaction_id,
            patientId: row.patient_id,
            patientName: row.patient_name,
            patientEmail: row.patient_email,
            healthieClientId: row.healthie_client_id,
            amount: parseFloat(row.amount),
            description: row.description,
            stripeAccount: row.stripe_account,
            healthieBillingItemId: row.healthie_billing_item_id,
            stripeChargeId: row.stripe_charge_id,
            status: row.status,
            receiptNumber: row.receipt_number,
            healthieDocumentId: row.healthie_document_id,
            createdAt: row.created_at,
            hasReceipt: !!(row.receipt_number && row.healthie_document_id)
        }));

        return NextResponse.json({
            transactions,
            pagination: {
                total,
                limit,
                offset,
                hasMore: offset + limit < total
            }
        });
    } catch (error) {
        console.error('[Receipts API] Error fetching transactions:', error);
        return NextResponse.json(
            { error: 'Failed to fetch payment transactions' },
            { status: 500 }
        );
    }
}