import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface Alert {
    id: string;
    type: string;
    category: 'vial' | 'peptide' | 'supply' | 'expiration';
    severity: 'info' | 'warning' | 'critical';
    message: string;
    details: Record<string, any>;
}

export async function GET(request: NextRequest) {
    try { await requireApiUser(request, 'read'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const [lowVials, lowPeptides, lowSupplies, expiringVials] = await Promise.all([
            // Vials below minimum usable volume (< 1ml remaining)
            query<{
                vial_id: string;
                external_id: string;
                dea_drug_name: string;
                remaining_volume_ml: string;
            }>(`
        SELECT vial_id, external_id, dea_drug_name, remaining_volume_ml::text
        FROM vials
        WHERE status = 'Active'
          AND remaining_volume_ml::numeric > 0
          AND remaining_volume_ml::numeric < 1
        ORDER BY remaining_volume_ml ASC
      `),

            // Peptides at or below reorder point
            query<{
                product_id: string;
                name: string;
                reorder_point: string;
                current_stock: string;
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
        )
        SELECT product_id, name, reorder_point::text, current_stock::text
        FROM stock
        WHERE current_stock <= reorder_point
        ORDER BY current_stock ASC
      `),

            // Supplies below PAR level
            query<{
                id: string;
                name: string;
                category: string;
                par_level: string;
                qty_on_hand: string;
            }>(`
        SELECT
          si.id,
          si.name,
          si.category,
          si.par_level::text,
          COALESCE(sc.qty_on_hand, 0)::text as qty_on_hand
        FROM supply_items si
        LEFT JOIN supply_counts sc ON sc.item_id = si.id
        WHERE si.active = true
          AND si.par_level IS NOT NULL
          AND COALESCE(sc.qty_on_hand, 0) <= si.par_level
        ORDER BY COALESCE(sc.qty_on_hand, 0) ASC
      `),

            // Vials expiring within 30 days
            query<{
                vial_id: string;
                external_id: string;
                dea_drug_name: string;
                expiration_date: string;
                remaining_volume_ml: string;
                days_until_expiry: string;
            }>(`
        SELECT
          vial_id, external_id, dea_drug_name,
          expiration_date::text,
          remaining_volume_ml::text,
          (expiration_date - CURRENT_DATE)::text as days_until_expiry
        FROM vials
        WHERE status = 'Active'
          AND expiration_date IS NOT NULL
          AND expiration_date <= CURRENT_DATE + INTERVAL '30 days'
        ORDER BY expiration_date ASC
      `),
        ]);

        const alerts: Alert[] = [];

        // Low volume vials
        lowVials.forEach((v) => {
            const remaining = parseFloat(v.remaining_volume_ml || '0');
            alerts.push({
                id: `vial-low-${v.vial_id}`,
                type: 'low_volume',
                category: 'vial',
                severity: remaining < 0.3 ? 'critical' : 'warning',
                message: `Vial ${v.external_id} (${v.dea_drug_name}) has ${remaining.toFixed(2)} mL remaining`,
                details: {
                    vial_id: v.vial_id,
                    external_id: v.external_id,
                    dea_drug_name: v.dea_drug_name,
                    remaining_ml: remaining,
                },
            });
        });

        // Low peptide stock
        lowPeptides.forEach((p) => {
            const stock = parseInt(p.current_stock || '0');
            const reorder = parseInt(p.reorder_point || '0');
            alerts.push({
                id: `peptide-low-${p.product_id}`,
                type: 'below_reorder_point',
                category: 'peptide',
                severity: stock <= 0 ? 'critical' : 'warning',
                message: `${p.name}: ${stock} units in stock (reorder at ${reorder})`,
                details: {
                    product_id: p.product_id,
                    name: p.name,
                    current_stock: stock,
                    reorder_point: reorder,
                },
            });
        });

        // Low supplies
        lowSupplies.forEach((s) => {
            const qty = parseInt(s.qty_on_hand || '0');
            const par = parseInt(s.par_level || '0');
            alerts.push({
                id: `supply-low-${s.id}`,
                type: 'below_par',
                category: 'supply',
                severity: qty <= par * 0.25 ? 'critical' : qty <= par * 0.5 ? 'warning' : 'info',
                message: `${s.name} (${s.category}): ${qty} on hand (PAR: ${par})`,
                details: {
                    id: s.id,
                    name: s.name,
                    category: s.category,
                    qty_on_hand: qty,
                    par_level: par,
                },
            });
        });

        // Expiring vials
        expiringVials.forEach((v) => {
            const days = parseInt(v.days_until_expiry || '0');
            alerts.push({
                id: `vial-expiring-${v.vial_id}`,
                type: 'expiring_soon',
                category: 'expiration',
                severity: days <= 7 ? 'critical' : days <= 14 ? 'warning' : 'info',
                message: `Vial ${v.external_id} (${v.dea_drug_name}) expires in ${days} days — ${parseFloat(v.remaining_volume_ml || '0').toFixed(1)} mL remaining`,
                details: {
                    vial_id: v.vial_id,
                    external_id: v.external_id,
                    dea_drug_name: v.dea_drug_name,
                    expiration_date: v.expiration_date,
                    days_until_expiry: days,
                    remaining_ml: parseFloat(v.remaining_volume_ml || '0'),
                },
            });
        });

        // Sort: critical first, then warning, then info
        const severityOrder = { critical: 0, warning: 1, info: 2 };
        alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

        return NextResponse.json({
            success: true,
            data: {
                alerts,
                summary: {
                    total: alerts.length,
                    critical: alerts.filter((a) => a.severity === 'critical').length,
                    warning: alerts.filter((a) => a.severity === 'warning').length,
                    info: alerts.filter((a) => a.severity === 'info').length,
                },
            },
        });
    } catch (error) {
        console.error('[InventoryIntelligence:Alerts] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}
