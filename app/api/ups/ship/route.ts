import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { createShipment, type UPSAddress, type UPSPackage } from '@/lib/ups';
import { createShipmentRecord } from '@/lib/upsShipmentQueries';
import { notifyShipmentCreated } from '@/lib/upsNotifications';

export async function POST(req: NextRequest) {
    try {
        const user = await requireApiUser(req, 'read');

        const body = await req.json();
        const { patientId, shipTo, packages, serviceCode, description, notes } = body as {
            patientId: string;
            shipTo: UPSAddress;
            packages: UPSPackage[];
            serviceCode: string;
            description?: string;
            notes?: string;
        };

        if (!patientId) {
            return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
        }
        if (!shipTo?.name || !shipTo?.addressLine1 || !shipTo?.city || !shipTo?.state || !shipTo?.postalCode) {
            return NextResponse.json(
                { error: 'shipTo must include name, addressLine1, city, state, and postalCode' },
                { status: 400 }
            );
        }
        if (!packages?.length || !packages[0]?.weight) {
            return NextResponse.json({ error: 'At least one package with a weight is required' }, { status: 400 });
        }
        if (!serviceCode) {
            return NextResponse.json({ error: 'serviceCode is required' }, { status: 400 });
        }

        // Create shipment with UPS
        const result = await createShipment(shipTo, packages, serviceCode, description);

        const serviceName = getServiceName(serviceCode);

        // Save to database
        const record = await createShipmentRecord({
            patientId,
            trackingNumber: result.trackingNumber,
            shipmentId: result.shipmentIdentificationNumber,
            serviceCode,
            serviceName,
            shipToName: shipTo.name,
            shipToAddress: shipTo.addressLine1,
            shipToCity: shipTo.city,
            shipToState: shipTo.state,
            shipToZip: shipTo.postalCode,
            packageWeight: packages[0].weight,
            packageDescription: description || packages[0].description || 'Medical Supplies',
            shippingCost: parseFloat(result.totalCharges),
            labelFormat: result.labelImageFormat,
            labelData: result.labelImageBase64,
            createdBy: user?.name || user?.email || 'system',
            notes,
        });

        // Send SMS notification to patient (async, non-blocking)
        notifyShipmentCreated(patientId, result.trackingNumber, serviceName).catch((err) =>
            console.error('[UPS-Ship] SMS notification error:', err)
        );

        return NextResponse.json({
            success: true,
            shipment: {
                id: record.id,
                trackingNumber: result.trackingNumber,
                shipmentId: result.shipmentIdentificationNumber,
                totalCharges: result.totalCharges,
                currency: result.currency,
                labelFormat: result.labelImageFormat,
                labelData: result.labelImageBase64,
            },
        });
    } catch (error: any) {
        console.error('UPS Shipping error:', error);
        return NextResponse.json(
            { error: error.message || 'Shipment creation failed', code: error.code, details: error.details },
            { status: 500 }
        );
    }
}

function getServiceName(code: string): string {
    const names: Record<string, string> = {
        '01': 'UPS Next Day Air',
        '02': 'UPS 2nd Day Air',
        '03': 'UPS Ground',
        '12': 'UPS 3 Day Select',
        '13': 'UPS Next Day Air Saver',
        '14': 'UPS Next Day Air Early',
        '59': 'UPS 2nd Day Air A.M.',
    };
    return names[code] || `UPS Service ${code}`;
}
