import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
    getTodayCheckStatus,
    getSystemInventoryCounts,
    recordControlledSubstanceCheck,
    adjustInventoryToPhysicalCount,
    getCheckHistory,
    formatCheckForDisplay,
    type ControlledSubstanceCheckInput
} from '@/lib/controlledSubstanceCheck';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inventory/controlled-check
 * Get today's check status or system counts
 */
export async function GET(request: NextRequest) {
    try {
        const user = await requireUser('read');

        const { searchParams } = new URL(request.url);
        const action = searchParams.get('action') || 'status';

        if (action === 'status') {
            const type = (searchParams.get('type') || 'morning') as 'morning' | 'evening';
            const status = await getTodayCheckStatus(type);
            // Format for UI
            return NextResponse.json({
                completed: status.completed,
                checkTime: status.check?.performedAt
                    ? new Date(status.check.performedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                    : null,
                checkedBy: status.check?.performedByName || null,
                hasDiscrepancy: status.check?.discrepancyFound || false,
                checkType: type
            });
        }

        if (action === 'counts') {
            const counts = await getSystemInventoryCounts();
            // Format for UI - flatten the structure
            return NextResponse.json({
                carrieboyd_full_vials: counts.cb30ml.fullVials,
                carrieboyd_partial_ml: counts.cb30ml.partialVialMl,
                carrieboyd_total_ml: counts.cb30ml.totalMl,
                toprx_vials: counts.topRx10ml.vialCount,
                toprx_full_vials: counts.topRx10ml.fullVials,
                toprx_partial_ml: counts.topRx10ml.partialVialMl,
                toprx_total_ml: counts.topRx10ml.totalMl
            });
        }

        if (action === 'history') {
            const days = parseInt(searchParams.get('days') || '30');
            const history = await getCheckHistory(days);
            return NextResponse.json({ checks: history });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error: any) {
        console.error('[controlled-check] GET error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

/**
 * POST /api/inventory/controlled-check
 * Record a controlled substance check and optionally adjust inventory
 */
export async function POST(request: NextRequest) {
    try {
        const user = await requireUser('write');
        const body = await request.json();

        // Accept both naming conventions from UI
        const input: ControlledSubstanceCheckInput = {
            performedBy: user.user_id,
            performedByName: user.display_name || user.email || user.user_id,
            physicalVialsCb30ml: parseInt(body.carrieboyd_full_vials ?? body.physicalVialsCb30ml) || 0,
            physicalVialsTopRx10ml: parseInt(body.toprx_vials ?? body.physicalVialsTopRx10ml) || 0,
            physicalPartialMlCb: parseFloat(body.carrieboyd_partial_ml ?? body.physicalPartialMlCb) || 0,
            physicalPartialMlTopRx: parseFloat(body.physicalPartialMlTopRx) || 0,
            checkType: body.check_type || 'morning',
            notes: body.notes || null,
            discrepancyNotes: body.discrepancyNotes || null
        };

        // Get system counts to check for discrepancy
        const systemCounts = await getSystemInventoryCounts();
        const physicalTotalCb = (input.physicalVialsCb30ml * 30) + (input.physicalPartialMlCb || 0);
        const physicalTotalTopRx = (input.physicalVialsTopRx10ml * 10) + (input.physicalPartialMlTopRx || 0);
        const discrepancyCb = Math.abs(systemCounts.cb30ml.totalMl - physicalTotalCb);
        const discrepancyTopRx = Math.abs(systemCounts.topRx10ml.totalMl - physicalTotalTopRx);

        // Require discrepancy notes if difference > 2ml
        const DISCREPANCY_THRESHOLD = 2.0;
        if ((discrepancyCb > DISCREPANCY_THRESHOLD || discrepancyTopRx > DISCREPANCY_THRESHOLD) && !input.discrepancyNotes) {
            return NextResponse.json(
                { error: 'Discrepancy detected (>2ml difference). A reason must be provided.' },
                { status: 400 }
            );
        }

        // Record the check
        const check = await recordControlledSubstanceCheck(input);

        let adjustmentDetails = '';

        // If discrepancy found, adjust inventory to match physical count
        if (check.discrepancyFound) {
            console.warn('[controlled-check] DISCREPANCY DETECTED:', {
                date: check.checkDate,
                performedBy: check.performedByName,
                discrepancyMlCb: check.discrepancyMlCb,
                discrepancyMlTopRx: check.discrepancyMlTopRx
            });

            // Adjust vials to match what staff says is physically there
            const adjustment = await adjustInventoryToPhysicalCount(
                input.physicalVialsCb30ml,
                input.physicalPartialMlCb || 0,
                input.physicalVialsTopRx10ml,
                input.performedByName,
                input.physicalPartialMlTopRx || 0
            );

            if (adjustment.cbAdjusted || adjustment.topRxAdjusted) {
                adjustmentDetails = adjustment.details;
                console.log('[controlled-check] Inventory adjusted to match physical count:', adjustmentDetails);
            }
        }

        return NextResponse.json({
            success: true,
            hasDiscrepancy: check.discrepancyFound,
            discrepancyDetails: check.discrepancyFound
                ? `CB: ${check.discrepancyMlCb > 0 ? '+' : ''}${check.discrepancyMlCb.toFixed(1)}ml, TopRX: ${check.discrepancyMlTopRx > 0 ? '+' : ''}${check.discrepancyMlTopRx.toFixed(1)}ml`
                : null,
            inventoryAdjusted: !!adjustmentDetails,
            adjustmentDetails,
            check,
            display: formatCheckForDisplay(check)
        });
    } catch (error: any) {
        console.error('[controlled-check] POST error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
