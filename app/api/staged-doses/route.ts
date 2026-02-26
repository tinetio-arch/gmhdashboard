import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { query, getPool } from '@/lib/db';
import {
    DEFAULT_TESTOSTERONE_PRESCRIBER,
    DEFAULT_TESTOSTERONE_DEA_CODE,
    DEFAULT_TESTOSTERONE_DEA_SCHEDULE
} from '@/lib/testosterone';

export async function GET() {
    try {
        const user = await requireUser('read');

        // Get all staged doses that haven't been dispensed yet
        const stagedDoses = await query<{
            staged_dose_id: string;
            patient_id: string | null;
            patient_name: string | null;
            dose_ml: string;
            waste_ml: string;
            syringe_count: number;
            total_ml: string;
            vendor: string;
            vial_external_id: string | null;
            staged_date: string;
            staged_for_date: string;
            staged_by_name: string | null;
            status: string;
            notes: string | null;
        }>(`
      SELECT 
        staged_dose_id,
        patient_id,
        patient_name,
        dose_ml,
        waste_ml,
        syringe_count,
        total_ml,
        vendor,
        vial_external_id,
        staged_date,
        staged_for_date,
        staged_by_name,
        status,
        notes
      FROM staged_doses
      WHERE status = 'staged'
      ORDER BY staged_for_date ASC, created_at ASC
    `);

        return NextResponse.json({ stagedDoses });
    } catch (error) {
        console.error('Error fetching staged doses:', error);
        return NextResponse.json(
            { error: 'Failed to fetch staged doses' },
            { status: 500 }
        );
    }
}

export async function POST(req: Request) {
    const pool = getPool();
    const client = await pool.connect();

    try {
        const user = await requireUser('write');
        const body = await req.json();

        const {
            patientId,
            patientName,
            doseMl,
            wasteMl,
            syringeCount,
            vendor,
            stagedDate,
            stagedForDate,
            notes
        } = body;

        await client.query('BEGIN');

        // Calculate total ml needed
        const totalMl = (parseFloat(doseMl) + parseFloat(wasteMl || 0.1)) * parseInt(syringeCount);

        // Find a vial with enough volume (30ml vials for Carrie Boyd)
        const vials = await client.query<{
            vial_id: string;
            external_id: string;
            remaining_volume_ml: string;
            dea_drug_name: string;
            dea_drug_code: string;
        }>(`
      SELECT vial_id, external_id, remaining_volume_ml, dea_drug_name, dea_drug_code
      FROM vials
      WHERE dea_drug_name LIKE '%30%'
        AND status = 'Active'
        AND remaining_volume_ml::numeric >= $1
      ORDER BY expiration_date ASC NULLS LAST, external_id ASC
      LIMIT 1
    `, [totalMl]);

        if (vials.rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json(
                { error: `Not enough medication in vials. Need ${totalMl}ml but no single vial has that much.` },
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

        // Create DEA transaction for the staging
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
        NULL,
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        'mL',
        $8,
        $9
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
            stagedDate || new Date().toISOString().split('T')[0],
            `STAGED PREFILL: ${patientName || 'Generic'} - ${syringeCount} syringes (${doseMl}ml + ${wasteMl}ml waste each)`
        ]);

        // Create staged dose record
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
            wasteMl || 0.1,
            syringeCount,
            totalMl,
            vendor,
            vial.vial_id,
            vial.external_id,
            stagedDate || new Date().toISOString().split('T')[0],
            stagedForDate,
            user.userId,
            user.name,
            notes || null,
            deaTx.rows[0].dea_tx_id
        ]);

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            stagedDoseId: result.rows[0].staged_dose_id,
            totalMl,
            vialUsed: vial.external_id,
            remainingInVial: remainingAfter.toFixed(2)
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating staged dose:', error);
        return NextResponse.json(
            { error: 'Failed to create staged dose' },
            { status: 500 }
        );
    } finally {
        client.release();
    }
}

export async function DELETE(req: Request) {
    const pool = getPool();
    const client = await pool.connect();

    try {
        await requireUser('write');
        const { searchParams } = new URL(req.url);
        const stagedDoseId = searchParams.get('id');

        if (!stagedDoseId) {
            return NextResponse.json({ error: 'Staged dose ID required' }, { status: 400 });
        }

        await client.query('BEGIN');

        // Get the staged dose details - MUST check status = 'staged'
        const staged = await client.query<{
            total_ml: string;
            vial_id: string | null;
            dispense_dea_tx_id: string | null;
            status: string;
        }>(`
          SELECT total_ml, vial_id, dispense_dea_tx_id, status
          FROM staged_doses
          WHERE staged_dose_id = $1
        `, [stagedDoseId]);

        if (staged.rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Staged dose not found' }, { status: 404 });
        }

        const { total_ml, vial_id, dispense_dea_tx_id, status } = staged.rows[0];

        // Prevent double-discard or discarding already-dispensed doses
        if (status !== 'staged') {
            await client.query('ROLLBACK');
            return NextResponse.json({
                error: `Cannot remove: prefill is already ${status}`
            }, { status: 400 });
        }

        // Only restore to vial if we have a valid vial_id
        if (vial_id) {
            // Get vial size to prevent over-restore
            const vialInfo = await client.query<{ size_ml: string; remaining_volume_ml: string }>(`
              SELECT size_ml, remaining_volume_ml FROM vials WHERE vial_id = $1
            `, [vial_id]);

            if (vialInfo.rows.length > 0) {
                const sizeMl = parseFloat(vialInfo.rows[0].size_ml);
                const currentMl = parseFloat(vialInfo.rows[0].remaining_volume_ml);
                const restoreMl = parseFloat(total_ml);

                // Calculate new volume, capped at vial size to prevent over-restore
                const newVolume = Math.min(currentMl + restoreMl, sizeMl);

                // Log if we had to cap
                if (currentMl + restoreMl > sizeMl) {
                    console.warn(`[Staged Dose] Over-restore prevented: ${currentMl} + ${restoreMl} would exceed ${sizeMl}ml. Capped to ${sizeMl}ml`);
                }

                // Restore the ml to the vial
                await client.query(`
                  UPDATE vials
                  SET remaining_volume_ml = $1::numeric,
                      updated_at = NOW()
                  WHERE vial_id = $2
                `, [newVolume, vial_id]);
            }
        } else {
            console.warn(`[Staged Dose] No vial_id for staged dose ${stagedDoseId}, cannot restore inventory`);
        }

        // Mark DEA transaction as voided if it exists
        if (dispense_dea_tx_id) {
            await client.query(`
              UPDATE dea_transactions
              SET notes = CONCAT(COALESCE(notes, ''), ' [VOIDED - Prefill removed]')
              WHERE dea_tx_id = $1
            `, [dispense_dea_tx_id]);
        }

        // Mark staged dose as discarded
        await client.query(`
          UPDATE staged_doses
          SET status = 'discarded', updated_at = NOW()
          WHERE staged_dose_id = $1
        `, [stagedDoseId]);

        await client.query('COMMIT');

        return NextResponse.json({ success: true });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error deleting staged dose:', error);
        return NextResponse.json(
            { error: 'Failed to delete staged dose' },
            { status: 500 }
        );
    } finally {
        client.release();
    }
}
