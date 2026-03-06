import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export type ShipmentWithPatient = {
    id: number;
    patient_id: string;
    patient_name: string;
    tracking_number: string;
    shipment_id: string | null;
    service_code: string;
    service_name: string | null;
    status: string;
    ship_to_name: string;
    ship_to_address: string;
    ship_to_city: string | null;
    ship_to_state: string | null;
    ship_to_zip: string | null;
    package_weight: number | null;
    package_description: string | null;
    shipping_cost: number | null;
    estimated_delivery: string | null;
    actual_delivery: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    voided_at: string | null;
    notes: string | null;
};

export async function GET(req: NextRequest) {
    try {
        await requireApiUser(req, 'admin');

        const { searchParams } = new URL(req.url);
        const status = searchParams.get('status');
        const limit = parseInt(searchParams.get('limit') || '200', 10);
        const offset = parseInt(searchParams.get('offset') || '0', 10);

        let whereClause = '';
        const params: any[] = [];
        let idx = 1;

        if (status && status !== 'all') {
            whereClause = `WHERE s.status = $${idx}`;
            params.push(status);
            idx++;
        }

        params.push(limit, offset);

        const rows = await query<ShipmentWithPatient>(
            `SELECT
                s.id,
                s.patient_id,
                COALESCE(p.full_name, s.ship_to_name) AS patient_name,
                s.tracking_number,
                s.shipment_id,
                s.service_code,
                s.service_name,
                s.status,
                s.ship_to_name,
                s.ship_to_address,
                s.ship_to_city,
                s.ship_to_state,
                s.ship_to_zip,
                s.package_weight,
                s.package_description,
                s.shipping_cost,
                s.estimated_delivery,
                s.actual_delivery,
                s.created_by,
                s.created_at,
                s.updated_at,
                s.voided_at,
                s.notes
            FROM ups_shipments s
            LEFT JOIN patients p ON p.patient_id = s.patient_id
            ${whereClause}
            ORDER BY s.created_at DESC
            LIMIT $${idx} OFFSET $${idx + 1}`,
            params
        );

        // Get summary stats
        const [stats] = await query<{
            total: string;
            active: string;
            voided: string;
            delivered: string;
            total_cost: string;
        }>(
            `SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status = 'label created' OR status = 'in transit') AS active,
                COUNT(*) FILTER (WHERE status = 'voided') AS voided,
                COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
                COALESCE(SUM(shipping_cost) FILTER (WHERE status != 'voided'), 0) AS total_cost
            FROM ups_shipments`
        );

        return NextResponse.json({
            shipments: rows,
            stats: {
                total: parseInt(stats.total),
                active: parseInt(stats.active),
                voided: parseInt(stats.voided),
                delivered: parseInt(stats.delivered),
                totalCost: parseFloat(stats.total_cost),
            },
        });
    } catch (error: any) {
        console.error('Failed to fetch all shipments:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch shipments' },
            { status: 500 }
        );
    }
}
