import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { getPool } from '@/lib/db';
import {
    DEFAULT_TESTOSTERONE_PRESCRIBER,
    DEFAULT_TESTOSTERONE_DEA_SCHEDULE,
    WASTE_PER_SYRINGE,
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
        const { stagedDoseId, prescriber, signatureNote } = body;

        if (!stagedDoseId) {
            return NextResponse.json({ success: false, error: 'stagedDoseId is required' }, { status: 400 });
        }

        await client.query('BEGIN');

        // (1) Lock and fetch the staged dose
        const stagedResult = await client.query<{
            staged_dose_id: string;
            patient_id: string | null;
            patient_name: string | null;
            dose_ml: string;
            waste_ml: string;
            syringe_count: number;
            total_ml: string;
            vial_id: string | null;
            vial_external_id: string | null;
            status: string;
            dispense_dea_tx_id: string | null;
        }>(`
      SELECT staged_dose_id, patient_id, patient_name, dose_ml, waste_ml,
             syringe_count, total_ml, vial_id, vial_external_id, status,
             dispense_dea_tx_id
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
                error: `Cannot dispense: staged dose is already "${staged.status}"`,
            }, { status: 400 });
        }

        // Fetch patient info for DEA snapshot
        let patientInfo: {
            full_name: string | null;
            phone_primary: string | null;
            address_line1: string | null;
            city: string | null;
            state: string | null;
            postal_code: string | null;
        } | null = null;

        if (staged.patient_id) {
            const patResult = await client.query<{
                full_name: string | null;
                phone_primary: string | null;
                address_line1: string | null;
                city: string | null;
                state: string | null;
                postal_code: string | null;
            }>(`
        SELECT full_name, phone_primary, address_line1, city, state, postal_code
        FROM patients WHERE patient_id = $1
      `, [staged.patient_id]);

            if (patResult.rowCount) {
                patientInfo = patResult.rows[0];
            }
        }

        // Get vial info for DEA fields
        let vialInfo: {
            dea_drug_name: string | null;
            dea_drug_code: string | null;
            controlled_substance: boolean;
        } | null = null;

        if (staged.vial_id) {
            const vialResult = await client.query<{
                dea_drug_name: string | null;
                dea_drug_code: string | null;
                controlled_substance: boolean;
            }>(`
        SELECT dea_drug_name, dea_drug_code, controlled_substance
        FROM vials WHERE vial_id = $1
      `, [staged.vial_id]);

            if (vialResult.rowCount) {
                vialInfo = vialResult.rows[0];
            }
        }

        const doseMl = parseFloat(staged.dose_ml);
        const wasteMl = parseFloat(staged.waste_ml || '0');
        const totalDispensed = doseMl * staged.syringe_count;
        const totalWaste = wasteMl * staged.syringe_count;
        const totalAmount = totalDispensed + totalWaste;
        const dispenseDate = new Date();

        // (1) Update staged_doses status → 'dispensed'
        await client.query(`
      UPDATE staged_doses
      SET status = 'dispensed', updated_at = NOW()
      WHERE staged_dose_id = $1
    `, [stagedDoseId]);

        // (2) Insert into dispenses
        const dispenseInsert = await client.query<{ dispense_id: string }>(`
      INSERT INTO dispenses (
        vial_id, vial_external_id, patient_id, patient_name,
        dispense_date, transaction_type, total_dispensed_ml,
        syringe_count, dose_per_syringe_ml, waste_ml, total_amount,
        notes, prescriber, created_by, created_by_role,
        signature_status, signature_note
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING dispense_id
    `, [
            staged.vial_id,
            staged.vial_external_id,
            staged.patient_id,
            staged.patient_name,
            dispenseDate.toISOString(),
            'dispense',
            totalDispensed,
            staged.syringe_count,
            doseMl,
            totalWaste,
            totalAmount,
            `Dispensed from staged dose ${stagedDoseId}`,
            prescriber ?? DEFAULT_TESTOSTERONE_PRESCRIBER,
            user.user_id,
            user.role,
            'awaiting_signature',
            signatureNote ?? null,
        ]);

        const dispenseId = dispenseInsert.rows[0].dispense_id;

        // (3) Insert into dea_transactions with patient snapshot
        let deaTransactionId: string | null = null;
        if (vialInfo?.controlled_substance) {
            const deaInsert = await client.query<{ dea_tx_id: string }>(`
        INSERT INTO dea_transactions (
          dispense_id, vial_id, patient_id,
          patient_name, phone_primary, address_line1, city, state, postal_code,
          prescriber, dea_drug_name, dea_drug_code, dea_schedule,
          quantity_dispensed, units, transaction_time,
          source_system, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        ON CONFLICT (dispense_id) DO UPDATE SET
          quantity_dispensed = EXCLUDED.quantity_dispensed,
          transaction_time = EXCLUDED.transaction_time,
          patient_name = COALESCE(EXCLUDED.patient_name, dea_transactions.patient_name),
          phone_primary = COALESCE(EXCLUDED.phone_primary, dea_transactions.phone_primary),
          address_line1 = COALESCE(EXCLUDED.address_line1, dea_transactions.address_line1),
          city = COALESCE(EXCLUDED.city, dea_transactions.city),
          state = COALESCE(EXCLUDED.state, dea_transactions.state),
          postal_code = COALESCE(EXCLUDED.postal_code, dea_transactions.postal_code),
          updated_at = NOW()
        RETURNING dea_tx_id
      `, [
                dispenseId,
                staged.vial_id,
                staged.patient_id,
                patientInfo?.full_name ?? staged.patient_name,
                patientInfo?.phone_primary ?? null,
                patientInfo?.address_line1 ?? null,
                patientInfo?.city ?? null,
                patientInfo?.state ?? null,
                patientInfo?.postal_code ?? null,
                prescriber ?? DEFAULT_TESTOSTERONE_PRESCRIBER,
                vialInfo.dea_drug_name,
                vialInfo.dea_drug_code,
                DEFAULT_TESTOSTERONE_DEA_SCHEDULE,
                totalDispensed,
                'mL',
                dispenseDate.toISOString(),
                'smart-dispense',
                `Dispensed from staged dose ${stagedDoseId}`,
            ]);

            deaTransactionId = deaInsert.rows[0]?.dea_tx_id ?? null;

            // Mark the staging DEA tx as superseded
            if (staged.dispense_dea_tx_id) {
                await client.query(`
          UPDATE dea_transactions
          SET notes = CONCAT(COALESCE(notes, ''), ' [SUPERSEDED by dispense ${dispenseId}]')
          WHERE dea_tx_id = $1
        `, [staged.dispense_dea_tx_id]);
            }
        }

        // (4) Volume was already deducted during staging — no vial update needed
        // (The staging step already decremented remaining_volume_ml)

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            data: {
                dispense_id: dispenseId,
                dea_transaction_id: deaTransactionId,
                staged_dose_id: stagedDoseId,
                total_dispensed_ml: totalDispensed,
                total_waste_ml: totalWaste,
            },
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[SmartDispense:Dispense] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    } finally {
        client.release();
    }
}
