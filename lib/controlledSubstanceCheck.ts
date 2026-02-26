/**
 * Controlled Substance Morning Check System
 * 
 * DEA Compliance: Staff must complete a physical count verification
 * before dispensing any controlled substances each day.
 * 
 * Features:
 * - Morning check prompt at configurable time
 * - Record physical count vs system count
 * - Flag discrepancies immediately
 * - Block dispensing until check is complete
 * - Audit trail for DEA compliance
 */

import { query } from './db';

// Types
export interface ControlledSubstanceCheckInput {
    performedBy: string;       // User ID who performed the check
    performedByName: string;   // User name
    physicalVialsCb30ml: number;   // Carrie Boyd 30ml physical count
    physicalVialsTopRx10ml: number; // TopRX 10ml physical count
    physicalPartialMlCb?: number;  // Partial vial ml (Carrie Boyd)
    physicalPartialMlTopRx?: number; // Partial vial ml (TopRX)
    checkType?: 'morning' | 'evening';  // Type of check
    notes?: string;
    discrepancyNotes?: string;     // Required if discrepancy found
}

export interface ControlledSubstanceCheck {
    checkId: string;
    checkDate: string;
    performedBy: string;
    performedByName: string;
    performedAt: string;

    // System counts (at time of check)
    systemVialsCb30ml: number;
    systemRemainingMlCb: number;
    systemVialsTopRx10ml: number;
    systemRemainingMlTopRx: number;

    // Physical counts (entered by staff)
    physicalVialsCb30ml: number;
    physicalPartialMlCb: number;
    physicalVialsTopRx10ml: number;
    physicalPartialMlTopRx: number;

    // Calculated
    discrepancyFound: boolean;
    discrepancyMlCb: number;
    discrepancyMlTopRx: number;
    discrepancyNotes: string | null;
    notes: string | null;

    status: 'pending' | 'completed' | 'discrepancy_flagged' | 'discrepancy_resolved';
}

export interface TodayCheckStatus {
    completed: boolean;
    check: ControlledSubstanceCheck | null;
    requiredBeforeDispensing: boolean;
}

/**
 * Get today's check status
 */
export async function getTodayCheckStatus(checkType: 'morning' | 'evening' = 'morning'): Promise<TodayCheckStatus> {
    const result = await query<{
        check_id: string;
        check_date: string;
        performed_by: string;
        performed_by_name: string;
        performed_at: string;
        system_vials_cb_30ml: string;
        system_remaining_ml_cb: string;
        system_vials_toprx_10ml: string;
        system_remaining_ml_toprx: string;
        physical_vials_cb_30ml: string;
        physical_partial_ml_cb: string;
        physical_vials_toprx_10ml: string;
        physical_partial_ml_toprx: string;
        discrepancy_found: boolean;
        discrepancy_ml_cb: string;
        discrepancy_ml_toprx: string;
        discrepancy_notes: string | null;
        notes: string | null;
        status: string;
        check_type: string;
    }>(`
    SELECT * FROM controlled_substance_checks
    WHERE check_date = (NOW() AT TIME ZONE 'America/Denver')::DATE
      AND check_type = $1
    ORDER BY performed_at DESC
    LIMIT 1
  `, [checkType]);

    if (result.length === 0) {
        return {
            completed: false,
            check: null,
            requiredBeforeDispensing: true
        };
    }

    const row = result[0];
    const check: ControlledSubstanceCheck = {
        checkId: row.check_id,
        checkDate: row.check_date,
        performedBy: row.performed_by,
        performedByName: row.performed_by_name,
        performedAt: row.performed_at,
        systemVialsCb30ml: parseInt(row.system_vials_cb_30ml),
        systemRemainingMlCb: parseFloat(row.system_remaining_ml_cb),
        systemVialsTopRx10ml: parseInt(row.system_vials_toprx_10ml),
        systemRemainingMlTopRx: parseFloat(row.system_remaining_ml_toprx),
        physicalVialsCb30ml: parseInt(row.physical_vials_cb_30ml),
        physicalPartialMlCb: parseFloat(row.physical_partial_ml_cb),
        physicalVialsTopRx10ml: parseInt(row.physical_vials_toprx_10ml),
        physicalPartialMlTopRx: parseFloat(row.physical_partial_ml_toprx),
        discrepancyFound: row.discrepancy_found,
        discrepancyMlCb: parseFloat(row.discrepancy_ml_cb),
        discrepancyMlTopRx: parseFloat(row.discrepancy_ml_toprx),
        discrepancyNotes: row.discrepancy_notes,
        notes: row.notes,
        status: row.status as ControlledSubstanceCheck['status']
    };

    return {
        completed: true,
        check,
        requiredBeforeDispensing: false
    };
}

/**
 * Get current system inventory counts
 */
export async function getSystemInventoryCounts(): Promise<{
    cb30ml: { fullVials: number; vialCount: number; totalMl: number; partialVialMl: number };
    topRx10ml: { fullVials: number; vialCount: number; totalMl: number; partialVialMl: number };
}> {
    // Carrie Boyd 30ml
    const cbResult = await query<{
        full_vials: string;
        vial_count: string;
        total_ml: string;
        partial_ml: string;
    }>(`
    SELECT 
      COUNT(*) FILTER (WHERE remaining_volume_ml::numeric = size_ml::numeric) as full_vials,
      COUNT(*) as vial_count,
      COALESCE(SUM(remaining_volume_ml::numeric), 0) as total_ml,
      COALESCE(SUM(CASE 
        WHEN remaining_volume_ml::numeric < size_ml::numeric 
        THEN remaining_volume_ml::numeric 
        ELSE 0 
      END), 0) as partial_ml
    FROM vials 
    WHERE controlled_substance = true 
      AND size_ml::numeric >= 20
      AND remaining_volume_ml::numeric > 0
  `);

    // TopRX 10ml — now tracks full/partial the same way as CB
    const topRxResult = await query<{
        full_vials: string;
        vial_count: string;
        total_ml: string;
        partial_ml: string;
    }>(`
    SELECT 
      COUNT(*) FILTER (WHERE remaining_volume_ml::numeric = size_ml::numeric) as full_vials,
      COUNT(*) as vial_count,
      COALESCE(SUM(remaining_volume_ml::numeric), 0) as total_ml,
      COALESCE(SUM(CASE 
        WHEN remaining_volume_ml::numeric < size_ml::numeric 
        THEN remaining_volume_ml::numeric 
        ELSE 0 
      END), 0) as partial_ml
    FROM vials 
    WHERE controlled_substance = true 
      AND size_ml::numeric < 20 AND size_ml::numeric > 0
      AND remaining_volume_ml::numeric > 0
  `);

    return {
        cb30ml: {
            fullVials: parseInt(cbResult[0]?.full_vials || '0'),
            vialCount: parseInt(cbResult[0]?.vial_count || '0'),
            totalMl: parseFloat(cbResult[0]?.total_ml || '0'),
            partialVialMl: parseFloat(cbResult[0]?.partial_ml || '0')
        },
        topRx10ml: {
            fullVials: parseInt(topRxResult[0]?.full_vials || '0'),
            vialCount: parseInt(topRxResult[0]?.vial_count || '0'),
            totalMl: parseFloat(topRxResult[0]?.total_ml || '0'),
            partialVialMl: parseFloat(topRxResult[0]?.partial_ml || '0')
        }
    };
}

/**
 * Record a controlled substance check
 */
export async function recordControlledSubstanceCheck(
    input: ControlledSubstanceCheckInput
): Promise<ControlledSubstanceCheck> {
    // Get current system counts
    const systemCounts = await getSystemInventoryCounts();

    // Calculate physical totals
    const physicalTotalCb = (input.physicalVialsCb30ml * 30) + (input.physicalPartialMlCb || 0);
    const physicalTotalTopRx = (input.physicalVialsTopRx10ml * 10) + (input.physicalPartialMlTopRx || 0);

    // Calculate discrepancies (system count - physical count)
    // Positive = system has more than physical (loss/waste)
    // Negative = physical has more than system (gain)
    const discrepancyCb = systemCounts.cb30ml.totalMl - physicalTotalCb;
    const discrepancyTopRx = systemCounts.topRx10ml.totalMl - physicalTotalTopRx;

    // Threshold: Only flag as discrepancy if difference > 2ml
    // Differences <= 2ml are auto-documented as "user waste" (needle dead-space, spillage, etc.)
    const DISCREPANCY_THRESHOLD_ML = 2.0;
    const discrepancyFound = Math.abs(discrepancyCb) > DISCREPANCY_THRESHOLD_ML ||
        Math.abs(discrepancyTopRx) > DISCREPANCY_THRESHOLD_ML;

    // Auto-generate waste notes for small differences
    const wasteNotes: string[] = [];
    if (Math.abs(discrepancyCb) > 0.1 && Math.abs(discrepancyCb) <= DISCREPANCY_THRESHOLD_ML) {
        wasteNotes.push(`CB auto-waste: ${Math.abs(discrepancyCb).toFixed(1)}ml (within threshold)`);
    }
    if (Math.abs(discrepancyTopRx) > 0.1 && Math.abs(discrepancyTopRx) <= DISCREPANCY_THRESHOLD_ML) {
        wasteNotes.push(`TopRX auto-waste: ${Math.abs(discrepancyTopRx).toFixed(1)}ml (within threshold)`);
    }

    // Combine user notes with auto-waste notes
    const combinedNotes = [
        input.notes,
        wasteNotes.length > 0 ? wasteNotes.join('; ') : null
    ].filter(Boolean).join(' | ') || null;

    // Determine status
    let status: string = 'completed';
    if (discrepancyFound) {
        status = input.discrepancyNotes ? 'discrepancy_resolved' : 'discrepancy_flagged';
    }

    const result = await query<{ check_id: string }>(`
    INSERT INTO controlled_substance_checks (
      check_date,
      performed_by,
      performed_by_name,
      performed_at,
      system_vials_cb_30ml,
      system_remaining_ml_cb,
      system_vials_toprx_10ml,
      system_remaining_ml_toprx,
      physical_vials_cb_30ml,
      physical_partial_ml_cb,
      physical_vials_toprx_10ml,
      physical_partial_ml_toprx,
      discrepancy_found,
      discrepancy_ml_cb,
      discrepancy_ml_toprx,
      discrepancy_notes,
      notes,
      status,
      check_type
    ) VALUES (
      (NOW() AT TIME ZONE 'America/Denver')::DATE,
      $1, $2, NOW(),
      $3, $4, $5, $6,
      $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17
    )
    RETURNING check_id
  `, [
        input.performedBy,
        input.performedByName,
        systemCounts.cb30ml.vialCount,
        systemCounts.cb30ml.totalMl,
        systemCounts.topRx10ml.vialCount,
        systemCounts.topRx10ml.totalMl,
        input.physicalVialsCb30ml,
        input.physicalPartialMlCb || 0,
        input.physicalVialsTopRx10ml,
        input.physicalPartialMlTopRx || 0,
        discrepancyFound,
        discrepancyCb,
        discrepancyTopRx,
        input.discrepancyNotes || null,
        combinedNotes,
        status,
        input.checkType || 'morning'
    ]);

    return {
        checkId: result[0].check_id,
        checkDate: new Date().toISOString().split('T')[0],
        performedBy: input.performedBy,
        performedByName: input.performedByName,
        performedAt: new Date().toISOString(),
        systemVialsCb30ml: systemCounts.cb30ml.vialCount,
        systemRemainingMlCb: systemCounts.cb30ml.totalMl,
        systemVialsTopRx10ml: systemCounts.topRx10ml.vialCount,
        systemRemainingMlTopRx: systemCounts.topRx10ml.totalMl,
        physicalVialsCb30ml: input.physicalVialsCb30ml,
        physicalPartialMlCb: input.physicalPartialMlCb || 0,
        physicalVialsTopRx10ml: input.physicalVialsTopRx10ml,
        physicalPartialMlTopRx: input.physicalPartialMlTopRx || 0,
        discrepancyFound,
        discrepancyMlCb: discrepancyCb,
        discrepancyMlTopRx: discrepancyTopRx,
        discrepancyNotes: input.discrepancyNotes || null,
        notes: combinedNotes,
        status: status as ControlledSubstanceCheck['status']
    };
}

/**
 * Adjust vials to match physical count
 * Called when staff reports a different count than system shows
 */
export async function adjustInventoryToPhysicalCount(
    physicalVialsCb30ml: number,
    physicalPartialMlCb: number,
    physicalVialsTopRx10ml: number,
    adjustedBy: string,
    physicalPartialMlTopRx: number = 0
): Promise<{ cbAdjusted: boolean; topRxAdjusted: boolean; details: string }> {
    const details: string[] = [];
    let cbAdjusted = false;
    let topRxAdjusted = false;

    // ===== Carrie Boyd 30ml adjustment =====
    // Get current CB vials sorted by external_id (oldest first)
    const cbVials = await query<{
        vial_id: string;
        external_id: string;
        remaining_volume_ml: string;
        size_ml: string;
    }>(`
        SELECT vial_id, external_id, remaining_volume_ml, size_ml
        FROM vials 
        WHERE controlled_substance = true 
          AND size_ml::numeric >= 20
          AND remaining_volume_ml::numeric > 0
        ORDER BY external_id ASC
    `);

    // Calculate what staff sees
    const physicalTotalCb = (physicalVialsCb30ml * 30) + physicalPartialMlCb;
    const systemTotalCb = cbVials.reduce((sum, v) => sum + parseFloat(v.remaining_volume_ml), 0);

    if (Math.abs(systemTotalCb - physicalTotalCb) > 0.5) {
        cbAdjusted = true;

        // Strategy: Keep physicalVialsCb30ml full vials, one partial, rest zero
        let mlToDistribute = physicalTotalCb;

        for (let i = 0; i < cbVials.length; i++) {
            const vial = cbVials[i];
            const sizeml = parseFloat(vial.size_ml);
            let newRemaining = 0;

            if (mlToDistribute >= sizeml) {
                // Full vial
                newRemaining = sizeml;
                mlToDistribute -= sizeml;
            } else if (mlToDistribute > 0) {
                // Partial vial
                newRemaining = mlToDistribute;
                mlToDistribute = 0;
            }
            // else: 0

            // Update if different
            if (Math.abs(parseFloat(vial.remaining_volume_ml) - newRemaining) > 0.01) {
                await query(`
                    UPDATE vials 
                    SET remaining_volume_ml = $1,
                        updated_at = NOW()
                    WHERE vial_id = $2
                `, [newRemaining.toFixed(2), vial.vial_id]);

                details.push(`${vial.external_id}: ${parseFloat(vial.remaining_volume_ml).toFixed(1)}ml → ${newRemaining.toFixed(1)}ml`);
            }
        }

        details.push(`CB adjusted: System had ${systemTotalCb.toFixed(1)}ml → Physical ${physicalTotalCb.toFixed(1)}ml`);
    }

    // ===== TopRX 10ml adjustment =====
    // Now supports partial volume tracking (same strategy as CB)
    const topRxVials = await query<{
        vial_id: string;
        external_id: string;
        remaining_volume_ml: string;
        size_ml: string;
    }>(`
        SELECT vial_id, external_id, remaining_volume_ml, size_ml
        FROM vials 
        WHERE controlled_substance = true 
          AND size_ml::numeric < 20 AND size_ml::numeric > 0
          AND remaining_volume_ml::numeric > 0
        ORDER BY external_id ASC
    `);

    const physicalTotalTopRx = (physicalVialsTopRx10ml * 10) + physicalPartialMlTopRx;
    const systemTotalTopRx = topRxVials.reduce((sum, v) => sum + parseFloat(v.remaining_volume_ml), 0);

    if (Math.abs(systemTotalTopRx - physicalTotalTopRx) > 0.5) {
        topRxAdjusted = true;

        // Distribute volume across vials: full vials first, then one partial, rest zero
        let mlToDistribute = physicalTotalTopRx;

        for (let i = 0; i < topRxVials.length; i++) {
            const vial = topRxVials[i];
            const sizeml = parseFloat(vial.size_ml);
            let newRemaining = 0;

            if (mlToDistribute >= sizeml) {
                // Full vial
                newRemaining = sizeml;
                mlToDistribute -= sizeml;
            } else if (mlToDistribute > 0) {
                // Partial vial
                newRemaining = mlToDistribute;
                mlToDistribute = 0;
            }
            // else: 0

            if (Math.abs(parseFloat(vial.remaining_volume_ml) - newRemaining) > 0.01) {
                await query(`
                    UPDATE vials 
                    SET remaining_volume_ml = $1,
                        updated_at = NOW()
                    WHERE vial_id = $2
                `, [newRemaining.toFixed(2), vial.vial_id]);

                details.push(`${vial.external_id}: ${parseFloat(vial.remaining_volume_ml).toFixed(1)}ml → ${newRemaining.toFixed(1)}ml`);
            }
        }

        details.push(`TopRX adjusted: System had ${systemTotalTopRx.toFixed(1)}ml → Physical ${physicalTotalTopRx.toFixed(1)}ml`);
    }

    // Log adjustment
    if (cbAdjusted || topRxAdjusted) {
        console.log(`[inventory-adjustment] Adjusted by ${adjustedBy}:`, details.join('; '));
    }

    return {
        cbAdjusted,
        topRxAdjusted,
        details: details.join('\n')
    };
}

/**
 * Get check history
 */
export async function getCheckHistory(days: number = 30): Promise<ControlledSubstanceCheck[]> {
    const result = await query<any>(`
    SELECT * FROM controlled_substance_checks
    WHERE check_date >= (NOW() AT TIME ZONE 'America/Denver')::DATE - INTERVAL '${days} days'
    ORDER BY check_date DESC, performed_at DESC
  `);

    return result.map(row => ({
        checkId: row.check_id,
        checkDate: row.check_date,
        performedBy: row.performed_by,
        performedByName: row.performed_by_name,
        performedAt: row.performed_at,
        systemVialsCb30ml: parseInt(row.system_vials_cb_30ml),
        systemRemainingMlCb: parseFloat(row.system_remaining_ml_cb),
        systemVialsTopRx10ml: parseInt(row.system_vials_toprx_10ml),
        systemRemainingMlTopRx: parseFloat(row.system_remaining_ml_toprx),
        physicalVialsCb30ml: parseInt(row.physical_vials_cb_30ml),
        physicalPartialMlCb: parseFloat(row.physical_partial_ml_cb),
        physicalVialsTopRx10ml: parseInt(row.physical_vials_toprx_10ml),
        physicalPartialMlTopRx: parseFloat(row.physical_partial_ml_toprx),
        discrepancyFound: row.discrepancy_found,
        discrepancyMlCb: parseFloat(row.discrepancy_ml_cb),
        discrepancyMlTopRx: parseFloat(row.discrepancy_ml_toprx),
        discrepancyNotes: row.discrepancy_notes,
        notes: row.notes,
        status: row.status
    }));
}

/**
 * Format check for display (Telegram or UI)
 */
export function formatCheckForDisplay(check: ControlledSubstanceCheck): string {
    const cbPhysicalTotal = (check.physicalVialsCb30ml * 30) + check.physicalPartialMlCb;
    const topRxPhysicalTotal = (check.physicalVialsTopRx10ml * 10) + check.physicalPartialMlTopRx;

    let display = `📋 **Controlled Substance Check**\n`;
    display += `📅 Date: ${check.checkDate}\n`;
    display += `👤 By: ${check.performedByName}\n`;
    display += `🕐 Time: ${new Date(check.performedAt).toLocaleTimeString()}\n\n`;

    display += `**Carrie Boyd 30ml:**\n`;
    display += `  System: ${check.systemRemainingMlCb.toFixed(1)}ml\n`;
    display += `  Physical: ${cbPhysicalTotal.toFixed(1)}ml (${check.physicalVialsCb30ml} full + ${check.physicalPartialMlCb.toFixed(1)}ml partial)\n`;
    if (Math.abs(check.discrepancyMlCb) > 0.5) {
        display += `  ⚠️ Discrepancy: ${check.discrepancyMlCb > 0 ? '+' : ''}${check.discrepancyMlCb.toFixed(1)}ml\n`;
    } else {
        display += `  ✅ Match\n`;
    }

    display += `\n**TopRX 10ml:**\n`;
    display += `  System: ${check.systemRemainingMlTopRx.toFixed(1)}ml (${check.systemVialsTopRx10ml} vials)\n`;
    display += `  Physical: ${topRxPhysicalTotal.toFixed(1)}ml (${check.physicalVialsTopRx10ml} vials)\n`;
    if (Math.abs(check.discrepancyMlTopRx) > 0.5) {
        display += `  ⚠️ Discrepancy: ${check.discrepancyMlTopRx > 0 ? '+' : ''}${check.discrepancyMlTopRx.toFixed(1)}ml\n`;
    } else {
        display += `  ✅ Match\n`;
    }

    display += `\n**Status:** ${check.status.replace(/_/g, ' ').toUpperCase()}\n`;

    if (check.notes) {
        display += `\n📝 Notes: ${check.notes}\n`;
    }
    if (check.discrepancyNotes) {
        display += `\n🔍 Discrepancy Notes: ${check.discrepancyNotes}\n`;
    }

    return display;
}

/**
 * Get daily check summary for Telegram morning report
 */
export async function getDailyCheckSummary(date: Date = new Date()): Promise<{
    morning: { completed: boolean; time?: string; by?: string; hasDiscrepancy?: boolean; reason?: string; notes?: string };
    evening: { completed: boolean; time?: string; by?: string; hasDiscrepancy?: boolean; reason?: string; notes?: string };
    inventory: { cbTotal: number; cbVials: number; trTotal: number; trVials: number };
}> {
    const dateStr = date.toISOString().split('T')[0];

    // Get yesterday's checks (for morning report showing what happened yesterday)
    const checks = await query<{
        check_type: string;
        performed_at: string;
        performed_by_name: string;
        discrepancy_found: boolean;
        discrepancy_notes: string | null;
        notes: string | null;
    }>(`
        SELECT check_type, performed_at, performed_by_name, discrepancy_found, discrepancy_notes, notes
        FROM controlled_substance_checks
        WHERE check_date = $1
        ORDER BY performed_at DESC
    `, [dateStr]);

    const morningCheck = checks.find(c => c.check_type === 'morning');
    const eveningCheck = checks.find(c => c.check_type === 'evening');

    // Get current inventory counts
    const inventory = await getSystemInventoryCounts();

    return {
        morning: {
            completed: !!morningCheck,
            time: morningCheck ? new Date(morningCheck.performed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : undefined,
            by: morningCheck?.performed_by_name,
            hasDiscrepancy: morningCheck?.discrepancy_found,
            reason: morningCheck?.discrepancy_notes || undefined,
            notes: morningCheck?.notes || undefined
        },
        evening: {
            completed: !!eveningCheck,
            time: eveningCheck ? new Date(eveningCheck.performed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : undefined,
            by: eveningCheck?.performed_by_name,
            hasDiscrepancy: eveningCheck?.discrepancy_found,
            reason: eveningCheck?.discrepancy_notes || undefined,
            notes: eveningCheck?.notes || undefined
        },
        inventory: {
            cbTotal: inventory.cb30ml.totalMl,
            cbVials: inventory.cb30ml.vialCount,
            trTotal: inventory.topRx10ml.totalMl,
            trVials: inventory.topRx10ml.vialCount
        }
    };
}

