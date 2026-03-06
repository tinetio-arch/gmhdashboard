import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { getRates, type UPSAddress, type UPSPackage } from '@/lib/ups';

export async function POST(req: NextRequest) {
    try {
        await requireApiUser(req, 'read');

        const body = await req.json();
        const { shipTo, packages, serviceCode } = body as {
            shipTo: UPSAddress;
            packages: UPSPackage[];
            serviceCode?: string;
        };

        if (!shipTo?.name || !shipTo?.addressLine1 || !shipTo?.city || !shipTo?.state || !shipTo?.postalCode) {
            return NextResponse.json(
                { error: 'shipTo must include name, addressLine1, city, state, and postalCode' },
                { status: 400 }
            );
        }

        if (!packages?.length || !packages[0]?.weight) {
            return NextResponse.json(
                { error: 'At least one package with a weight is required' },
                { status: 400 }
            );
        }

        const rates = await getRates(shipTo, packages, serviceCode);

        return NextResponse.json({ rates });
    } catch (error: any) {
        console.error('UPS Rating error:', error);
        return NextResponse.json(
            { error: error.message || 'Rating lookup failed', code: error.code },
            { status: 500 }
        );
    }
}
