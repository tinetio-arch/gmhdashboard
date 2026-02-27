import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try { await requireApiUser(request, 'read'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const { searchParams } = new URL(request.url);
        const doseMlParam = searchParams.get('dose_ml');
        const wasteMlParam = searchParams.get('waste_ml');
        const syringeCountParam = searchParams.get('syringe_count');

        const doseMl = doseMlParam ? parseFloat(doseMlParam) : null;
        const wasteMl = wasteMlParam ? parseFloat(wasteMlParam) : 0.1;
        const syringeCount = syringeCountParam ? parseInt(syringeCountParam, 10) : 1;

        // Calculate minimum volume needed
        const minVolume = doseMl !== null
            ? (doseMl + wasteMl) * syringeCount
            : 0;

        const vials = await query<{
            vial_id: string;
            external_id: string;
            dea_drug_name: string | null;
            dea_drug_code: string | null;
            size_ml: string | null;
            remaining_volume_ml: string | null;
            lot_number: string | null;
            expiration_date: string | null;
            location: string | null;
            controlled_substance: boolean;
        }>(`
      SELECT
        vial_id,
        external_id,
        dea_drug_name,
        dea_drug_code,
        size_ml::text,
        remaining_volume_ml::text,
        lot_number,
        expiration_date::text,
        location,
        controlled_substance
      FROM vials
      WHERE status = 'Active'
        AND remaining_volume_ml::numeric > 0
        AND remaining_volume_ml::numeric >= $1
      ORDER BY expiration_date ASC NULLS LAST, external_id ASC
    `, [minVolume]);

        return NextResponse.json({
            success: true,
            data: {
                vials: vials.map((v) => ({
                    vial_id: v.vial_id,
                    external_id: v.external_id,
                    dea_drug_name: v.dea_drug_name,
                    dea_drug_code: v.dea_drug_code,
                    size_ml: v.size_ml ? parseFloat(v.size_ml) : null,
                    remaining_volume_ml: v.remaining_volume_ml ? parseFloat(v.remaining_volume_ml) : 0,
                    lot_number: v.lot_number,
                    expiration_date: v.expiration_date,
                    location: v.location,
                    controlled_substance: v.controlled_substance,
                    doses_available: doseMl && doseMl > 0
                        ? Math.floor(parseFloat(v.remaining_volume_ml || '0') / (doseMl + wasteMl))
                        : null,
                })),
                filter: {
                    min_volume_ml: minVolume,
                    dose_ml: doseMl,
                    waste_ml: wasteMl,
                    syringe_count: syringeCount,
                },
                total_vials: vials.length,
            },
        });
    } catch (error) {
        console.error('[SmartDispense:VialOptions] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}
