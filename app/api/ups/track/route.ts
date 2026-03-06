import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { trackShipment } from '@/lib/ups';

export async function GET(req: NextRequest) {
    try {
        await requireApiUser(req, 'read');

        const trackingNumber = req.nextUrl.searchParams.get('trackingNumber');
        if (!trackingNumber) {
            return NextResponse.json({ error: 'trackingNumber query parameter is required' }, { status: 400 });
        }

        const result = await trackShipment(trackingNumber);

        return NextResponse.json(result);
    } catch (error: any) {
        console.error('UPS Tracking error:', error);
        return NextResponse.json(
            { error: error.message || 'Tracking lookup failed', code: error.code },
            { status: 500 }
        );
    }
}
