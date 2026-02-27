import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try { await requireApiUser(request, 'write'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    const client = await getPool().connect();

    try {
        const body = await request.json();
        const { stagedDoseId, reason } = body;

        if (!stagedDoseId) {
            return NextResponse.json({ success: false, error: 'stagedDoseId is required' }, { status: 400 });
        }

        await client.query('BEGIN');

        // Fetch and lock the staged dose
        const stagedResult = await client.query<{
            staged_dose_id: string;
            total_ml: string;
            vial_id: string | null;
            dispense_dea_tx_id: string | null;
            status: string;
        }>(`
      SELECT staged_dose_id, total_ml, vial_id, dispense_dea_tx_id, status
      FROM staged_doses
      WHERE staged_dose_id = $1
      FOR UPDATE
    `, [stagedDoseId]);

        if (stagedResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ success: false, error: 'Staged dose not found' }, { status: 404 });
        }

        const staged = stagedResult.rows[0];

        if (staged.status !== 'staged') {
            await client.query('ROLLBACK');
            return NextResponse.json({
                success: false,
                error: `Cannot discard: staged dose is already "${staged.status}"`,
            }, { status: 400 });
        }

        // Restore volume to vial if possible
        if (staged.vial_id) {
            const vialInfo = await client.query<{ size_ml: string; remaining_volume_ml: string }>(`
        SELECT size_ml, remaining_volume_ml FROM vials WHERE vial_id = $1
      `, [staged.vial_id]);

            if (vialInfo.rows.length > 0) {
                const sizeMl = parseFloat(vialInfo.rows[0].size_ml);
                const currentMl = parseFloat(vialInfo.rows[0].remaining_volume_ml);
                const restoreMl = parseFloat(staged.total_ml);
                const newVolume = Math.min(currentMl + restoreMl, sizeMl);

                if (currentMl + restoreMl > sizeMl) {
                    console.warn(
                        `[SmartDispense:Discard] Over-restore prevented: ${currentMl} + ${restoreMl} would exceed ${sizeMl}ml. Capped.`
                    );
                }

                await client.query(`
          UPDATE vials
          SET remaining_volume_ml = $1::numeric,
              status = CASE WHEN remaining_volume_ml::numeric <= 0 THEN 'Active' ELSE status END,
              updated_at = NOW()
          WHERE vial_id = $2
        `, [newVolume, staged.vial_id]);
            }
        } else {
            console.warn(`[SmartDispense:Discard] No vial_id for staged dose ${stagedDoseId}, cannot restore inventory`);
        }

        // Mark staging DEA transaction as voided
        if (staged.dispense_dea_tx_id) {
            await client.query(`
        UPDATE dea_transactions
        SET notes = CONCAT(COALESCE(notes, ''), ' [VOIDED - Discarded: ${reason || 'no reason'}]')
        WHERE dea_tx_id = $1
      `, [staged.dispense_dea_tx_id]);
        }

        // Update staged dose status to discarded
        await client.query(`
      UPDATE staged_doses
      SET status = 'discarded', updated_at = NOW()
      WHERE staged_dose_id = $1
    `, [stagedDoseId]);

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            data: {
                staged_dose_id: stagedDoseId,
                status: 'discarded',
                volume_restored: staged.vial_id ? parseFloat(staged.total_ml) : 0,
            },
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[SmartDispense:Discard] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    } finally {
        client.release();
    }
}
