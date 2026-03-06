import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { voidShipment } from '@/lib/ups';
import { getShipmentById, voidShipmentRecord } from '@/lib/upsShipmentQueries';
import { notifyShipmentVoided } from '@/lib/upsNotifications';

export async function POST(req: NextRequest) {
    try {
        await requireApiUser(req, 'read');

        const body = await req.json();
        const { shipmentDbId } = body as { shipmentDbId: number };

        if (!shipmentDbId) {
            return NextResponse.json({ error: 'shipmentDbId is required' }, { status: 400 });
        }

        // Look up the record
        const record = await getShipmentById(shipmentDbId);
        if (!record) {
            return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });
        }

        if (record.status === 'voided') {
            return NextResponse.json({ error: 'Shipment is already voided' }, { status: 400 });
        }

        if (!record.shipment_id) {
            return NextResponse.json(
                { error: 'No UPS shipment ID on record — cannot void' },
                { status: 400 }
            );
        }

        // Void with UPS
        const voided = await voidShipment(record.shipment_id);

        if (voided) {
            // Update local record
            await voidShipmentRecord(shipmentDbId);

            // Send SMS notification to patient (async, non-blocking)
            if (record.patient_id && record.tracking_number) {
                notifyShipmentVoided(record.patient_id, record.tracking_number).catch((err) =>
                    console.error('[UPS-Void] SMS notification error:', err)
                );
            }

            return NextResponse.json({ success: true, message: 'Shipment voided successfully' });
        } else {
            return NextResponse.json(
                { error: 'UPS returned a non-success status for voiding' },
                { status: 500 }
            );
        }
    } catch (error: any) {
        console.error('UPS Void error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to void shipment', code: error.code },
            { status: 500 }
        );
    }
}
