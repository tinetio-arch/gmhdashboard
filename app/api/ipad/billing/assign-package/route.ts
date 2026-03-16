import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { createHealthieClient } from '@/lib/healthie';

/**
 * GET /api/ipad/billing/assign-package
 * List available Healthie packages
 */
export async function GET(request: NextRequest) {
    try {
        await requireApiUser(request, 'write');

        const healthieClient = createHealthieClient();
        if (!healthieClient) {
            return NextResponse.json({
                success: false,
                error: 'Healthie client not configured'
            }, { status: 500 });
        }

        const packages = await healthieClient.getPackages();

        return NextResponse.json({
            success: true,
            packages: packages.map(pkg => ({
                id: pkg.id,
                name: pkg.name,
                description: pkg.description || '',
                price: pkg.price,
                billing_frequency: pkg.billing_frequency,
                number_of_sessions: pkg.number_of_sessions,
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
 * Assign a package to a patient
 *
 * Body: { healthie_id: string, package_id: string, start_date?: string }
 */
export async function POST(request: NextRequest) {
    try {
        await requireApiUser(request, 'write');

        const body = await request.json();
        const { healthie_id, package_id, start_date } = body;

        if (!healthie_id || !package_id) {
            return NextResponse.json({
                success: false,
                error: 'Missing required fields: healthie_id, package_id'
            }, { status: 400 });
        }

        const healthieClient = createHealthieClient();
        if (!healthieClient) {
            return NextResponse.json({
                success: false,
                error: 'Healthie client not configured'
            }, { status: 500 });
        }

        const subscription = await healthieClient.assignPackageToClient({
            client_id: healthie_id,
            package_id,
            start_date: start_date || undefined,
        });

        console.log(`[assign-package] Assigned package ${package_id} to Healthie client ${healthie_id}, subscription: ${subscription.id}`);

        return NextResponse.json({
            success: true,
            subscription: {
                id: subscription.id,
                status: subscription.status,
                start_date: subscription.start_date,
                next_charge_date: subscription.next_charge_date,
                amount: subscription.amount,
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
