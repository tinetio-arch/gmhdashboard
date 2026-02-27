import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface ReorderSuggestion {
    product_type: 'vial' | 'peptide' | 'supply';
    name: string;
    current_stock: number;
    reorder_point: number;
    avg_daily_usage: number;
    lead_time_days: number;
    suggested_quantity: number;
    days_of_stock_remaining: number | null;
    urgency: 'immediate' | 'soon' | 'planned';
}

export async function POST(request: NextRequest) {
    try { await requireApiUser(request, 'write'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const body = await request.json();
        const leadTimeDays = body.lead_time_days ?? 14;
        const safetyStockDays = body.safety_stock_days ?? 7;
        const targetStockDays = body.target_stock_days ?? 30;

        const suggestions: ReorderSuggestion[] = [];

        const [vialBurn, peptideData, supplyData] = await Promise.all([
            // Vial usage: avg daily by vendor (last 30 days)
            query<{
                dea_drug_name: string;
                total_remaining: string;
                avg_daily_ml: string;
                active_count: string;
            }>(`
        WITH daily_usage AS (
          SELECT
            v.dea_drug_name,
            COALESCE(SUM(d.total_amount::numeric) / NULLIF(COUNT(DISTINCT d.dispense_date::date), 0), 0) as avg_daily_ml
          FROM vials v
          LEFT JOIN dispenses d ON d.vial_id = v.vial_id
            AND d.dispense_date >= CURRENT_DATE - INTERVAL '30 days'
          WHERE v.dea_drug_name IS NOT NULL
          GROUP BY v.dea_drug_name
        )
        SELECT
          v.dea_drug_name,
          SUM(v.remaining_volume_ml::numeric)::text as total_remaining,
          COALESCE(du.avg_daily_ml, 0)::text as avg_daily_ml,
          COUNT(*)::text as active_count
        FROM vials v
        LEFT JOIN daily_usage du ON du.dea_drug_name = v.dea_drug_name
        WHERE v.status = 'Active'
          AND v.dea_drug_name IS NOT NULL
        GROUP BY v.dea_drug_name, du.avg_daily_ml
      `),

            // Peptide stock + burn rate
            query<{
                product_id: string;
                name: string;
                reorder_point: string;
                current_stock: string;
                avg_daily_units: string;
            }>(`
        WITH stock AS (
          SELECT
            pp.product_id,
            pp.name,
            pp.reorder_point,
            COALESCE(SUM(po.quantity), 0)
              - COALESCE((
                SELECT SUM(pd.quantity) FROM peptide_dispenses pd
                WHERE pd.product_id = pp.product_id
                  AND pd.status = 'Paid' AND pd.education_complete = true
              ), 0) as current_stock
          FROM peptide_products pp
          LEFT JOIN peptide_orders po ON po.product_id = pp.product_id
          WHERE pp.active = true
          GROUP BY pp.product_id, pp.name, pp.reorder_point
        ),
        burn AS (
          SELECT
            pd.product_id,
            COUNT(*)::numeric / 30 as avg_daily_units
          FROM peptide_dispenses pd
          WHERE pd.sale_date >= CURRENT_DATE - INTERVAL '30 days'
            AND pd.status = 'Paid'
          GROUP BY pd.product_id
        )
        SELECT
          s.product_id, s.name,
          s.reorder_point::text,
          s.current_stock::text,
          COALESCE(b.avg_daily_units, 0)::text as avg_daily_units
        FROM stock s
        LEFT JOIN burn b ON b.product_id = s.product_id
        ORDER BY s.name
      `),

            // Supply items with PAR
            query<{
                id: string;
                name: string;
                par_level: string;
                reorder_qty: string | null;
                qty_on_hand: string;
            }>(`
        SELECT
          si.id,
          si.name,
          si.par_level::text,
          si.reorder_qty::text,
          COALESCE(sc.qty_on_hand, 0)::text as qty_on_hand
        FROM supply_items si
        LEFT JOIN supply_counts sc ON sc.item_id = si.id
        WHERE si.active = true AND si.par_level IS NOT NULL
        ORDER BY si.name
      `),
        ]);

        // Generate vial reorder suggestions
        vialBurn.forEach((v) => {
            const remaining = parseFloat(v.total_remaining || '0');
            const dailyUsage = parseFloat(v.avg_daily_ml || '0');
            const daysRemaining = dailyUsage > 0 ? remaining / dailyUsage : null;

            // Suggest if stock covers less than lead_time + safety_stock
            const needsReorder = daysRemaining !== null && daysRemaining < (leadTimeDays + safetyStockDays);

            if (needsReorder || remaining <= 0) {
                const targetVolume = dailyUsage * targetStockDays;
                const suggestedMl = Math.max(0, targetVolume - remaining);

                suggestions.push({
                    product_type: 'vial',
                    name: v.dea_drug_name,
                    current_stock: remaining,
                    reorder_point: dailyUsage * (leadTimeDays + safetyStockDays),
                    avg_daily_usage: dailyUsage,
                    lead_time_days: leadTimeDays,
                    suggested_quantity: Math.ceil(suggestedMl),
                    days_of_stock_remaining: daysRemaining ? Math.floor(daysRemaining) : 0,
                    urgency: !daysRemaining || daysRemaining <= 7 ? 'immediate' : daysRemaining <= 14 ? 'soon' : 'planned',
                });
            }
        });

        // Generate peptide reorder suggestions
        peptideData.forEach((p) => {
            const stock = parseInt(p.current_stock || '0');
            const reorder = parseInt(p.reorder_point || '0');
            const dailyUsage = parseFloat(p.avg_daily_units || '0');
            const daysRemaining = dailyUsage > 0 ? stock / dailyUsage : null;

            if (stock <= reorder) {
                const targetUnits = dailyUsage * targetStockDays;
                const suggestedQty = Math.max(0, Math.ceil(targetUnits - stock));

                suggestions.push({
                    product_type: 'peptide',
                    name: p.name,
                    current_stock: stock,
                    reorder_point: reorder,
                    avg_daily_usage: dailyUsage,
                    lead_time_days: leadTimeDays,
                    suggested_quantity: suggestedQty,
                    days_of_stock_remaining: daysRemaining ? Math.floor(daysRemaining) : 0,
                    urgency: stock <= 0 ? 'immediate' : stock <= reorder * 0.5 ? 'soon' : 'planned',
                });
            }
        });

        // Generate supply reorder suggestions
        supplyData.forEach((s) => {
            const qty = parseInt(s.qty_on_hand || '0');
            const par = parseInt(s.par_level || '0');

            if (qty <= par) {
                const reorderQty = s.reorder_qty ? parseInt(s.reorder_qty) : par * 2;
                const suggestedQty = Math.max(reorderQty, par - qty);

                suggestions.push({
                    product_type: 'supply',
                    name: s.name,
                    current_stock: qty,
                    reorder_point: par,
                    avg_daily_usage: 0, // Not tracked for supplies
                    lead_time_days: leadTimeDays,
                    suggested_quantity: suggestedQty,
                    days_of_stock_remaining: null,
                    urgency: qty <= par * 0.25 ? 'immediate' : qty <= par * 0.5 ? 'soon' : 'planned',
                });
            }
        });

        // Sort: immediate first
        const urgencyOrder = { immediate: 0, soon: 1, planned: 2 };
        suggestions.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

        return NextResponse.json({
            success: true,
            data: {
                suggestions,
                parameters: {
                    lead_time_days: leadTimeDays,
                    safety_stock_days: safetyStockDays,
                    target_stock_days: targetStockDays,
                },
                summary: {
                    total_suggestions: suggestions.length,
                    immediate: suggestions.filter((s) => s.urgency === 'immediate').length,
                    soon: suggestions.filter((s) => s.urgency === 'soon').length,
                    planned: suggestions.filter((s) => s.urgency === 'planned').length,
                },
            },
        });
    } catch (error) {
        console.error('[InventoryIntelligence:ReorderSuggestion] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}
