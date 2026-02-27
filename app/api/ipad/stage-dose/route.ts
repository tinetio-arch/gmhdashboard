import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { getPool } from '@/lib/db';
import {
    DEFAULT_TESTOSTERONE_PRESCRIBER,
    DEFAULT_TESTOSTERONE_DEA_SCHEDULE,
} from '@/lib/testosterone';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    let user;
    try { user = await requireApiUser(request, 'write'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    const client = await getPool().connect();

    try {
        const body = await request.json();

        const {
            patientId,
            patientName,
            doseMl,
            wasteMl = 0.1,
            syringeCount,
            vendor,
            stagedForDate,
            notes,
        } = body;

        // Validate required fields
        if (!doseMl || doseMl <= 0) {
            return NextResponse.json(
                { success: false, error: 'doseMl must be positive' }, { status: 400 }
            );
        }
        if (!syringeCount || syringeCount < 1) {
            return NextResponse.json(
                { success: false, error: 'syringeCount must be at least 1' }, { status: 400 }
            );
        }
        if (!stagedForDate) {
            return NextResponse.json(
                { success: false, error: 'stagedForDate is required' }, { status: 400 }
            );
        }

        await client.query('BEGIN');

        // Calculate total ml needed
        const totalMl = (parseFloat(doseMl) + parseFloat(wasteMl)) * parseInt(syringeCount, 10);

        // Find a vial with enough volume (uses FEFO — first expiring, first out)
        const vials = await client.query<{
            vial_id: string;
            external_id: string;
            remaining_volume_ml: string;
            dea_drug_name: string;
            dea_drug_code: string;
        }>(`
      SELECT vial_id, external_id, remaining_volume_ml, dea_drug_name, dea_drug_code
      FROM vials
      WHERE status = 'Active'
        AND remaining_volume_ml::numeric >= $1
        AND controlled_substance = true
      ORDER BY expiration_date ASC NULLS LAST, external_id ASC
      LIMIT 1
    `, [totalMl]);

        if (vials.rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json(
                { success: false, error: `No active vial has ${totalMl.toFixed(2)} mL available. Check inventory.` },
                { status: 400 }
            );
        }

        const vial = vials.rows[0];
        const remainingAfter = parseFloat(vial.remaining_volume_ml) - totalMl;

        // Deduct from vial
        await client.query(`
      UPDATE vials
      SET remaining_volume_ml = $1, updated_at = NOW()
      WHERE vial_id = $2
    `, [remainingAfter, vial.vial_id]);

        // Auto-mark vial as Empty when fully depleted
        if (remainingAfter <= 0) {
            await client.query(
                `UPDATE vials SET status = 'Empty', updated_at = NOW() WHERE vial_id = $1`,
                [vial.vial_id]
            );
        }

        // Create DEA transaction for the staging
        const stagedDate = new Date().toISOString().split('T')[0];
        const deaTx = await client.query<{ dea_tx_id: string }>(`
      INSERT INTO dea_transactions (
        dispense_id,
        vial_id,
        patient_id,
        prescriber,
        dea_drug_name,
        dea_drug_code,
        dea_schedule,
        quantity_dispensed,
        units,
        transaction_time,
        notes
      ) VALUES (
        NULL, $1, $2, $3, $4, $5, $6, $7, 'mL', $8, $9
      )
      RETURNING dea_tx_id
    `, [
            vial.vial_id,
            patientId || null,
            DEFAULT_TESTOSTERONE_PRESCRIBER,
            vial.dea_drug_name,
            vial.dea_drug_code,
            DEFAULT_TESTOSTERONE_DEA_SCHEDULE,
            totalMl,
            stagedDate,
            `STAGED PREFILL: ${patientName || 'Generic'} - ${syringeCount} syringes (${doseMl}ml + ${wasteMl}ml waste each)`,
        ]);

        // Insert staged dose record
        const result = await client.query<{ staged_dose_id: string }>(`
      INSERT INTO staged_doses (
        patient_id,
        patient_name,
        dose_ml,
        waste_ml,
        syringe_count,
        total_ml,
        vendor,
        vial_id,
        vial_external_id,
        staged_date,
        staged_for_date,
        staged_by_user_id,
        staged_by_name,
        status,
        notes,
        dispense_dea_tx_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'staged', $14, $15)
      RETURNING staged_dose_id
    `, [
            patientId || null,
            patientName || null,
            doseMl,
            wasteMl,
            syringeCount,
            totalMl,
            vendor || vial.dea_drug_name,
            vial.vial_id,
            vial.external_id,
            stagedDate,
            stagedForDate,
            user.user_id,
            user.display_name || user.email,
            notes || null,
            deaTx.rows[0].dea_tx_id,
        ]);

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            data: {
                staged_dose_id: result.rows[0].staged_dose_id,
                total_ml: totalMl,
                vial_used: vial.external_id,
                remaining_in_vial: remainingAfter.toFixed(2),
                dea_tx_id: deaTx.rows[0].dea_tx_id,
            },
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[iPad StageDose] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    } finally {
        client.release();
    }
}
