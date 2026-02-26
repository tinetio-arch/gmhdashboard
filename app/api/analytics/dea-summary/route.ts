/**
 * DEA Summary API - Aggregated DEA tracking data for CEO Dashboard
 */

import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        // 1. Inventory Summary - Total remaining volume by drug type
        const inventoryResult = await query<{
            dea_drug_name: string;
            active_vials: string;
            total_remaining_ml: string;
        }>(`
            SELECT 
                COALESCE(dea_drug_name, 'Unknown') as dea_drug_name,
                COUNT(*) FILTER (WHERE remaining_volume_ml::numeric > 0) as active_vials,
                COALESCE(SUM(CASE WHEN remaining_volume_ml::numeric > 0 THEN remaining_volume_ml::numeric ELSE 0 END), 0) as total_remaining_ml
            FROM vials
            WHERE controlled_substance = true
            GROUP BY dea_drug_name
            ORDER BY total_remaining_ml DESC
        `);

        // 2. Total Inventory (all controlled substances)
        const totalResult = await query<{
            total_vials: string;
            total_remaining_ml: string;
        }>(`
            SELECT 
                COUNT(*) FILTER (WHERE remaining_volume_ml::numeric > 0) as total_vials,
                COALESCE(SUM(CASE WHEN remaining_volume_ml::numeric > 0 THEN remaining_volume_ml::numeric ELSE 0 END), 0) as total_remaining_ml
            FROM vials
            WHERE controlled_substance = true
        `);

        // 3. Dispensing Metrics (7d and 30d)
        const dispensingResult = await query<{
            dispensed_7d: string;
            dispensed_30d: string;
            dispense_count_7d: string;
            dispense_count_30d: string;
        }>(`
            SELECT 
                COALESCE(SUM(CASE WHEN dispense_date >= CURRENT_DATE - 7 THEN total_dispensed_ml ELSE 0 END), 0) as dispensed_7d,
                COALESCE(SUM(CASE WHEN dispense_date >= CURRENT_DATE - 30 THEN total_dispensed_ml ELSE 0 END), 0) as dispensed_30d,
                COUNT(*) FILTER (WHERE dispense_date >= CURRENT_DATE - 7) as dispense_count_7d,
                COUNT(*) FILTER (WHERE dispense_date >= CURRENT_DATE - 30) as dispense_count_30d
            FROM dispenses d
            JOIN vials v ON v.vial_id = d.vial_id
            WHERE v.controlled_substance = true
        `);

        // 4. Unsigned Dispenses (Pending Provider Signatures)
        const unsignedResult = await query<{ unsigned_count: string }>(`
            SELECT COUNT(*) as unsigned_count
            FROM dispenses d
            JOIN vials v ON v.vial_id = d.vial_id
            WHERE v.controlled_substance = true
              AND COALESCE(d.signature_status, 'awaiting_signature') <> 'signed'
        `);

        // 5. Last Morning and EOD Checks
        const checksResult = await query<{
            check_type: string;
            check_date: string;
            performed_at: string;
            performed_by_name: string;
        }>(`
            SELECT 
                c.check_type,
                c.check_date::text,
                c.performed_at::text,
                c.performed_by_name
            FROM controlled_substance_checks c
            WHERE c.check_date >= CURRENT_DATE - 1
            ORDER BY c.check_date DESC, c.check_type
        `);

        const morningCheck = checksResult.find(c => c.check_type === 'morning' && c.check_date === new Date().toISOString().split('T')[0]);
        const eodCheck = checksResult.find(c => c.check_type === 'evening' && c.check_date === new Date().toISOString().split('T')[0]);

        // 6. Daily dispensing trend (past 7 days)
        const trendResult = await query<{
            day: string;
            total_ml: string;
            dispense_count: string;
            waste_ml: string;
        }>(`
            SELECT
                d.dispense_date::text as day,
                COALESCE(SUM(d.total_dispensed_ml), 0) as total_ml,
                COUNT(*) as dispense_count,
                COALESCE(SUM(d.waste_ml), 0) as waste_ml
            FROM dispenses d
            JOIN vials v ON v.vial_id = d.vial_id
            WHERE v.controlled_substance = true
              AND d.dispense_date >= CURRENT_DATE - 7
            GROUP BY d.dispense_date
            ORDER BY d.dispense_date ASC
        `);

        // 7. Recent discrepancy history (past 14 days)
        const discrepancyResult = await query<{
            check_date: string;
            check_type: string;
            performed_by_name: string;
            discrepancy_ml_cb: string;
            discrepancy_ml_toprx: string;
            discrepancy_notes: string | null;
            notes: string | null;
        }>(`
            SELECT
                check_date::text,
                check_type,
                performed_by_name,
                discrepancy_ml_cb,
                discrepancy_ml_toprx,
                discrepancy_notes,
                notes
            FROM controlled_substance_checks
            WHERE discrepancy_found = true
              AND check_date >= CURRENT_DATE - 14
            ORDER BY check_date DESC, performed_at DESC
            LIMIT 20
        `);

        // 8. Waste tracking (30 days)
        const wasteResult = await query<{
            total_waste_ml: string;
            waste_count: string;
        }>(`
            SELECT
                COALESCE(SUM(d.waste_ml), 0) as total_waste_ml,
                COUNT(*) FILTER (WHERE d.waste_ml > 0) as waste_count
            FROM dispenses d
            JOIN vials v ON v.vial_id = d.vial_id
            WHERE v.controlled_substance = true
              AND d.dispense_date >= CURRENT_DATE - 30
        `);

        // Calculate reorder metrics
        const totalRemaining = parseFloat(totalResult[0]?.total_remaining_ml || '0');
        const dispensed30d = parseFloat(dispensingResult[0]?.dispensed_30d || '0');
        const dailyRate = dispensed30d / 30;
        const daysRemaining = dailyRate > 0 ? Math.round(totalRemaining / dailyRate) : 999;

        // Determine reorder status
        let reorderStatus: 'ok' | 'warning' | 'critical' = 'ok';
        if (daysRemaining <= 7) {
            reorderStatus = 'critical';
        } else if (daysRemaining <= 14) {
            reorderStatus = 'warning';
        }

        return NextResponse.json({
            timestamp: new Date().toISOString(),
            inventory: {
                byDrug: inventoryResult.map(row => ({
                    drugName: row.dea_drug_name,
                    activeVials: parseInt(row.active_vials),
                    remainingMl: parseFloat(row.total_remaining_ml)
                })),
                totalVials: parseInt(totalResult[0]?.total_vials || '0'),
                totalRemainingMl: totalRemaining
            },
            dispensing: {
                volume7d: parseFloat(dispensingResult[0]?.dispensed_7d || '0'),
                volume30d: dispensed30d,
                count7d: parseInt(dispensingResult[0]?.dispense_count_7d || '0'),
                count30d: parseInt(dispensingResult[0]?.dispense_count_30d || '0'),
                dailyAverage: Math.round(dailyRate * 10) / 10,
                trend: trendResult.map(row => ({
                    date: row.day,
                    dispensedMl: parseFloat(row.total_ml),
                    count: parseInt(row.dispense_count),
                    wasteMl: parseFloat(row.waste_ml)
                }))
            },
            waste: {
                totalMl30d: parseFloat(wasteResult[0]?.total_waste_ml || '0'),
                wasteCount30d: parseInt(wasteResult[0]?.waste_count || '0')
            },
            reorder: {
                daysRemaining,
                status: reorderStatus,
                threshold: 14 // Days warning threshold
            },
            compliance: {
                unsignedDispenses: parseInt(unsignedResult[0]?.unsigned_count || '0'),
                morningCheck: morningCheck ? {
                    completed: true,
                    checkedAt: morningCheck.performed_at,
                    checkedBy: morningCheck.performed_by_name
                } : {
                    completed: false,
                    checkedAt: null,
                    checkedBy: null
                },
                eodCheck: eodCheck ? {
                    completed: true,
                    checkedAt: eodCheck.performed_at,
                    checkedBy: eodCheck.performed_by_name
                } : {
                    completed: false,
                    checkedAt: null,
                    checkedBy: null
                },
                recentDiscrepancies: discrepancyResult.map(row => ({
                    date: row.check_date,
                    checkType: row.check_type,
                    by: row.performed_by_name,
                    cbDiscrepancyMl: parseFloat(row.discrepancy_ml_cb),
                    topRxDiscrepancyMl: parseFloat(row.discrepancy_ml_toprx),
                    reason: row.discrepancy_notes,
                    notes: row.notes
                }))
            }
        });
    } catch (error) {
        console.error('DEA Summary API error:', error);
        return NextResponse.json({ error: 'Failed to fetch DEA summary' }, { status: 500 });
    }
}

