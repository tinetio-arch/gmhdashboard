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
            vialSummary,
            peptideStock,
            supplySummary,
            expiring30,
            expiring60,
            expiring90,
        ] = await Promise.all([
            // Vial stock summary
            query<{
                active_count: string;
                total_volume_ml: string;
                empty_count: string;
                vendors: string;
            }>(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'Active')::text as active_count,
          COALESCE(SUM(remaining_volume_ml::numeric) FILTER (WHERE status = 'Active'), 0)::text as total_volume_ml,
          COUNT(*) FILTER (WHERE status = 'Empty')::text as empty_count,
          COUNT(DISTINCT dea_drug_name) FILTER (WHERE status = 'Active')::text as vendors
        FROM vials
      `),

            // Peptide stock per product
            query<{
                product_id: string;
                name: string;
                reorder_point: string;
                total_ordered: string;
                total_dispensed: string;
                current_stock: string;
            }>(`
        SELECT
          pp.product_id,
          pp.name,
          pp.reorder_point::text,
          COALESCE(SUM(po.quantity), 0)::text as total_ordered,
          COALESCE((
            SELECT SUM(pd.quantity) FROM peptide_dispenses pd
            WHERE pd.product_id = pp.product_id
              AND pd.status = 'Paid' AND pd.education_complete = true
          ), 0)::text as total_dispensed,
          (COALESCE(SUM(po.quantity), 0) - COALESCE((
            SELECT SUM(pd.quantity) FROM peptide_dispenses pd
            WHERE pd.product_id = pp.product_id
              AND pd.status = 'Paid' AND pd.education_complete = true
          ), 0))::text as current_stock
        FROM peptide_products pp
        LEFT JOIN peptide_orders po ON po.product_id = pp.product_id
        WHERE pp.active = true
        GROUP BY pp.product_id, pp.name, pp.reorder_point
        ORDER BY pp.name
      `),

            // Supply counts vs PAR levels
            query<{
                id: string;
                name: string;
                category: string;
                par_level: string | null;
                qty_on_hand: string;
                status: string;
            }>(`
        SELECT
          si.id,
          si.name,
          si.category,
          si.par_level::text,
          COALESCE(sc.qty_on_hand, 0)::text as qty_on_hand,
          CASE
            WHEN si.par_level IS NOT NULL AND COALESCE(sc.qty_on_hand, 0) <= si.par_level * 0.25 THEN 'critical'
            WHEN si.par_level IS NOT NULL AND COALESCE(sc.qty_on_hand, 0) <= si.par_level THEN 'low'
            ELSE 'ok'
          END as status
        FROM supply_items si
        LEFT JOIN supply_counts sc ON sc.item_id = si.id
        WHERE si.active = true
        ORDER BY si.category, si.name
      `),

            // Vials expiring within 30 days
            query<{ count: string }>(`
        SELECT COUNT(*)::text as count FROM vials
        WHERE status = 'Active'
          AND expiration_date IS NOT NULL
          AND expiration_date <= CURRENT_DATE + INTERVAL '30 days'
      `),

            // Vials expiring within 60 days
            query<{ count: string }>(`
        SELECT COUNT(*)::text as count FROM vials
        WHERE status = 'Active'
          AND expiration_date IS NOT NULL
          AND expiration_date <= CURRENT_DATE + INTERVAL '60 days'
      `),

            // Vials expiring within 90 days
            query<{ count: string }>(`
        SELECT COUNT(*)::text as count FROM vials
        WHERE status = 'Active'
          AND expiration_date IS NOT NULL
          AND expiration_date <= CURRENT_DATE + INTERVAL '90 days'
      `),
        ]);

        const vs = vialSummary[0];

        return NextResponse.json({
            success: true,
            data: {
                vials: {
                    active_count: parseInt(vs?.active_count || '0'),
                    total_volume_ml: parseFloat(vs?.total_volume_ml || '0'),
                    empty_count: parseInt(vs?.empty_count || '0'),
                    distinct_vendors: parseInt(vs?.vendors || '0'),
                },
                peptides: peptideStock.map((p) => ({
                    product_id: p.product_id,
                    name: p.name,
                    reorder_point: parseInt(p.reorder_point || '0'),
                    total_ordered: parseInt(p.total_ordered || '0'),
                    total_dispensed: parseInt(p.total_dispensed || '0'),
                    current_stock: parseInt(p.current_stock || '0'),
                    status: parseInt(p.current_stock || '0') <= parseInt(p.reorder_point || '0') ? 'low' : 'ok',
                })),
                supplies: supplySummary.map((s) => ({
                    id: s.id,
                    name: s.name,
                    category: s.category,
                    par_level: s.par_level ? parseInt(s.par_level) : null,
                    qty_on_hand: parseInt(s.qty_on_hand || '0'),
                    status: s.status,
                })),
                expiring_vials: {
                    within_30_days: parseInt(expiring30[0]?.count || '0'),
                    within_60_days: parseInt(expiring60[0]?.count || '0'),
                    within_90_days: parseInt(expiring90[0]?.count || '0'),
                },
            },
        });
    } catch (error) {
        console.error('[InventoryIntelligence:Summary] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}
