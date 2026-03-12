import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';

/**
 * GET /api/ipad/patient/[id]/payments
 * Returns billing items and requested payments from Healthie for a patient
 */
export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        await requireApiUser(request, 'read');
        const patientId = params.id;

        // Look up Healthie client ID
        const rows = await query(
            `SELECT hc.healthie_client_id, p.full_name
             FROM patients p
             LEFT JOIN healthie_clients hc ON p.patient_id = hc.patient_id AND hc.is_active = true
             WHERE p.patient_id = $1
             LIMIT 1`,
            [patientId]
        );
        const healthieClientId = (rows as any[])[0]?.healthie_client_id;
        const patientName = (rows as any[])[0]?.full_name || '';

        if (!healthieClientId) {
            return NextResponse.json({
                billing_items: [],
                requested_payments: [],
                total_paid: 0,
                error: 'Patient not linked to Healthie',
            });
        }

        // Fetch billing items
        let billingItems: any[] = [];
        try {
            const billingData = await healthieGraphQL<{
                billingItems: any[];
            }>(`
                query BillingItemsForClient($client_id: ID!) {
                    billingItems(client_id: $client_id, page_size: 20) {
                        id
                        amount_paid
                        state
                        created_at
                        sender { full_name }
                        recipient { full_name }
                        offering { name }
                    }
                }
            `, { client_id: healthieClientId });

            billingItems = billingData?.billingItems || [];
        } catch (e) {
            console.warn('[payments] Billing items fetch failed:', e);
        }

        // Fetch requested payments
        let requestedPayments: any[] = [];
        try {
            const rpData = await healthieGraphQL<{
                requestedPayments: any[];
            }>(`
                query RequestedPayments($keywords: String!) {
                    requestedPayments(keywords: $keywords, page_size: 20) {
                        id
                        price
                        status
                        created_at
                        paid_at
                        sender { id full_name }
                        recipient { id full_name }
                        offering { name }
                    }
                }
            `, { keywords: patientName });

            // Filter to only this patient's payments
            requestedPayments = (rpData?.requestedPayments || []).filter(
                (rp: any) => rp.recipient?.id === healthieClientId
            );
        } catch (e) {
            console.warn('[payments] Requested payments fetch failed:', e);
        }

        // Calculate total paid
        const totalPaid = billingItems
            .filter(b => b.state === 'paid' || b.state === 'succeeded')
            .reduce((sum, b) => sum + parseFloat(b.amount_paid || '0'), 0);

        return NextResponse.json({
            billing_items: billingItems,
            requested_payments: requestedPayments,
            total_paid: totalPaid,
            healthie_client_id: healthieClientId,
        });
    } catch (error: any) {
        if (error?.name === 'UnauthorizedError' || error?.status === 401) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }
        console.error('[/api/ipad/patient/payments GET]', error);
        return NextResponse.json({ error: 'Failed to load payment data' }, { status: 500 });
    }
}
