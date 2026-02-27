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
        const [
            weeklyDispenses,
            weeklyPeptides,
            dailyBurnRate,
            peptideBurnRate,
        ] = await Promise.all([
            // Weekly TRT dispense trend (last 12 weeks)
            query<{
                week: string;
                dispense_count: string;
                total_volume: string;
            }>(`
        SELECT
          DATE_TRUNC('week', dispense_date)::text as week,
          COUNT(*)::text as dispense_count,
          COALESCE(SUM(total_amount::numeric), 0)::text as total_volume
        FROM dispenses
        WHERE dispense_date >= CURRENT_DATE - INTERVAL '12 weeks'
        GROUP BY DATE_TRUNC('week', dispense_date)
        ORDER BY week
      `),

            // Weekly peptide dispense trend (last 12 weeks)
            query<{
                week: string;
                dispense_count: string;
                total_revenue: string;
            }>(`
        SELECT
          DATE_TRUNC('week', sale_date)::text as week,
          COUNT(*)::text as dispense_count,
          COALESCE(SUM(total_price::numeric), 0)::text as total_revenue
        FROM peptide_dispenses
        WHERE sale_date >= CURRENT_DATE - INTERVAL '12 weeks'
          AND status = 'Paid'
        GROUP BY DATE_TRUNC('week', sale_date)
        ORDER BY week
      `),

            // Daily TRT burn rate (last 30 days average)
            query<{
                avg_daily_volume: string;
                avg_daily_count: string;
                total_30d_volume: string;
            }>(`
        SELECT
          COALESCE(SUM(total_amount::numeric) / NULLIF(COUNT(DISTINCT dispense_date::date), 0), 0)::text as avg_daily_volume,
          COALESCE(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT dispense_date::date), 0), 0)::text as avg_daily_count,
          COALESCE(SUM(total_amount::numeric), 0)::text as total_30d_volume
        FROM dispenses
        WHERE dispense_date >= CURRENT_DATE - INTERVAL '30 days'
      `),

            // Peptide burn rate per product (last 30 days)
            query<{
                product_id: string;
                name: string;
                units_dispensed_30d: string;
                avg_daily_units: string;
            }>(`
        SELECT
          pp.product_id,
          pp.name,
          COUNT(*)::text as units_dispensed_30d,
          (COUNT(*)::numeric / 30)::text as avg_daily_units
        FROM peptide_dispenses pd
        JOIN peptide_products pp ON pd.product_id = pp.product_id
        WHERE pd.sale_date >= CURRENT_DATE - INTERVAL '30 days'
          AND pd.status = 'Paid'
        GROUP BY pp.product_id, pp.name
        ORDER BY COUNT(*) DESC
      `),
        ]);

        // Calculate projected stockout dates for vials
        const avgDailyVolume = parseFloat(dailyBurnRate[0]?.avg_daily_volume || '0');

        const vialStockout = await query<{
            dea_drug_name: string;
            total_remaining: string;
        }>(`
      SELECT
        dea_drug_name,
        SUM(remaining_volume_ml::numeric)::text as total_remaining
      FROM vials
      WHERE status = 'Active' AND dea_drug_name IS NOT NULL
      GROUP BY dea_drug_name
    `);

        const projectedStockouts = vialStockout.map((v) => {
            const remaining = parseFloat(v.total_remaining || '0');
            const daysRemaining = avgDailyVolume > 0 ? Math.floor(remaining / avgDailyVolume) : null;
            const stockoutDate = daysRemaining !== null
                ? new Date(Date.now() + daysRemaining * 86400000).toISOString().split('T')[0]
                : null;

            return {
                vendor: v.dea_drug_name,
                total_remaining_ml: remaining,
                avg_daily_burn_ml: avgDailyVolume,
                days_remaining: daysRemaining,
                projected_stockout: stockoutDate,
            };
        });

        return NextResponse.json({
            success: true,
            data: {
                trt_weekly: weeklyDispenses.map((w) => ({
                    week: w.week,
                    dispense_count: parseInt(w.dispense_count || '0'),
                    total_volume_ml: parseFloat(w.total_volume || '0'),
                })),
                peptide_weekly: weeklyPeptides.map((w) => ({
                    week: w.week,
                    dispense_count: parseInt(w.dispense_count || '0'),
                    total_revenue: parseFloat(w.total_revenue || '0'),
                })),
                burn_rates: {
                    trt: {
                        avg_daily_volume_ml: parseFloat(dailyBurnRate[0]?.avg_daily_volume || '0'),
                        avg_daily_count: parseFloat(dailyBurnRate[0]?.avg_daily_count || '0'),
                        total_30d_volume_ml: parseFloat(dailyBurnRate[0]?.total_30d_volume || '0'),
                    },
                    peptides: peptideBurnRate.map((p) => ({
                        product_id: p.product_id,
                        name: p.name,
                        units_dispensed_30d: parseInt(p.units_dispensed_30d || '0'),
                        avg_daily_units: parseFloat(p.avg_daily_units || '0'),
                    })),
                },
                projected_stockouts: projectedStockouts,
            },
        });
    } catch (error) {
        console.error('[InventoryIntelligence:Trends] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}
