import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { getShipmentsForPatient } from '@/lib/upsShipmentQueries';

export async function GET(req: NextRequest) {
    try {
        await requireApiUser(req, 'read');

        const patientId = req.nextUrl.searchParams.get('patientId');
        if (!patientId) {
            return NextResponse.json({ error: 'patientId query parameter is required' }, { status: 400 });
        }

        const shipments = await getShipmentsForPatient(patientId);

        return NextResponse.json({ shipments });
    } catch (error: any) {
        console.error('UPS Shipments list error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch shipments' },
            { status: 500 }
        );
    }
}
