import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { validateAddress } from '@/lib/ups';

export async function POST(req: NextRequest) {
    try {
        await requireApiUser(req, 'read');

        const body = await req.json();
        const { addressLine1, city, state, postalCode, countryCode } = body;

        if (!addressLine1 || !city || !state || !postalCode) {
            return NextResponse.json(
                { error: 'addressLine1, city, state, and postalCode are required' },
                { status: 400 }
            );
        }

        const result = await validateAddress({
            addressLine1,
            city,
            state,
            postalCode,
            countryCode: countryCode || 'US',
        });

        return NextResponse.json(result);
    } catch (error: any) {
        console.error('UPS Address Validation error:', error);
        return NextResponse.json(
            { error: error.message || 'Address validation failed', code: error.code },
            { status: 500 }
        );
    }
}
