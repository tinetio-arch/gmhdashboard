import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';

// Direct Healthie API fetch — the healthie-lib getPackages() uses the wrong query name
const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';

async function healthieQuery(gql: string, variables: Record<string, unknown> = {}) {
    const response = await fetch(HEALTHIE_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${HEALTHIE_API_KEY}`,
            'AuthorizationSource': 'API',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: gql, variables }),
    });

    if (!response.ok) {
        throw new Error(`Healthie API HTTP ${response.status}`);
    }

    const result = await response.json();
    if (result.errors) {
        throw new Error(result.errors.map((e: any) => e.message).join(', '));
    }
    return result.data;
}

/**
 * GET /api/ipad/billing/assign-package
 * List available Healthie packages (offerings)
 */
export async function GET(request: NextRequest) {
    try {
        await requireApiUser(request, 'read');

        if (!HEALTHIE_API_KEY) {
            return NextResponse.json({
                success: false,
                error: 'Healthie client not configured'
            }, { status: 500 });
        }

        // Query 'offerings' — the correct Healthie API name for packages
        // NOTE: The healthie-lib getPackages() uses 'packages' which does NOT exist in this API version
        const data = await healthieQuery(`
            query GetOfferings {
                offerings(offset: 0, page_size: 50, show_only_visible: true) {
                    id
                    name
                    description
                    price
                    billing_frequency
                }
            }
        `);

        const offerings = data?.offerings || [];

        return NextResponse.json({
            success: true,
            packages: offerings.map((pkg: any) => ({
                id: pkg.id,
                name: pkg.name,
                description: pkg.description || '',
                price: pkg.price,
                billing_frequency: pkg.billing_frequency,
            })),
        });
    } catch (error: any) {
        if (error?.name === 'UnauthorizedError' || error?.status === 401) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }
        console.error('[/api/ipad/billing/assign-package GET]', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch packages' }, { status: 500 });
    }
}

/**
 * POST /api/ipad/billing/assign-package
 * Assign a package to a patient by creating a billing item for the offering
 *
 * Body: { healthie_id: string, package_id: string }
 */
export async function POST(request: NextRequest) {
    try {
        await requireApiUser(request, 'write');

        const body = await request.json();
        const { healthie_id, package_id } = body;

        if (!healthie_id || !package_id) {
            return NextResponse.json({
                success: false,
                error: 'Missing required fields: healthie_id, package_id'
            }, { status: 400 });
        }

        if (!HEALTHIE_API_KEY) {
            return NextResponse.json({
                success: false,
                error: 'Healthie client not configured'
            }, { status: 500 });
        }

        // Create a billing item linked to the offering for this patient
        const data = await healthieQuery(`
            mutation CreateBillingItem($input: createBillingItemInput!) {
                createBillingItem(input: $input) {
                    billingItem {
                        id
                        amount_paid_string
                        state
                        offering {
                            id
                            name
                        }
                        recurring_payment {
                            id
                            next_payment_date
                            amount_to_pay
                        }
                    }
                    messages {
                        field
                        message
                    }
                }
            }
        `, {
            input: {
                recipient_id: healthie_id,
                offering_id: package_id,
                should_charge: true,
            }
        });

        const result = data?.createBillingItem;
        const messages = result?.messages || [];

        if (messages.length > 0) {
            console.error('[assign-package POST] Healthie errors:', messages);
            return NextResponse.json({
                success: false,
                error: messages.map((m: any) => m.message).join(', ')
            }, { status: 400 });
        }

        const billingItem = result?.billingItem;
        console.log(`[assign-package] Created billing item ${billingItem?.id} for offering ${package_id} -> patient ${healthie_id}`);

        return NextResponse.json({
            success: true,
            billing_item: {
                id: billingItem?.id,
                amount: billingItem?.amount_paid_string,
                state: billingItem?.state,
                offering_name: billingItem?.offering?.name,
                recurring_payment_id: billingItem?.recurring_payment?.id,
            },
        });
    } catch (error: any) {
        if (error?.name === 'UnauthorizedError' || error?.status === 401) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }
        console.error('[/api/ipad/billing/assign-package POST]', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to assign package'
        }, { status: 500 });
    }
}
