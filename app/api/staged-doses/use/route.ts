import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getPool } from '@/lib/db';

export async function POST(req: Request) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const user = await requireUser('write');
    const body = await req.json();
    const { stagedDoseId, patientId, patientName } = body;

    if (!stagedDoseId) {
      return NextResponse.json({ error: 'Staged dose ID required' }, { status: 400 });
    }

    await client.query('BEGIN');

    // Get the staged dose details
    const stagedResult = await client.query<{
      patient_id: string | null;
      patient_name: string | null;
      dose_ml: string;
      waste_ml: string;
      syringe_count: number;
      total_ml: string;
      vial_id: string;
      vial_external_id: string;
      vendor: string;
      dispense_dea_tx_id: string;
      staged_date: string;
    }>(`
      SELECT 
        patient_id, patient_name, dose_ml, waste_ml, syringe_count, 
        total_ml, vial_id, vial_external_id, vendor, dispense_dea_tx_id, staged_date
      FROM staged_doses
      WHERE staged_dose_id = $1 AND status = 'staged'
    `, [stagedDoseId]);

    if (stagedResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Staged dose not found or already used' }, { status: 404 });
    }

    const staged = stagedResult.rows[0];

    // Determine final patient (use provided if generic, or staged patient if specific)
    const finalPatientId = staged.patient_id || patientId;
    const finalPatientName = staged.patient_name || patientName;

    if (!finalPatientId || !finalPatientName) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Patient required to use this prefill' }, { status: 400 });
    }

    // Compute actual medication dispensed (dose only, not waste)
    // total_ml includes waste — we need to separate them
    const totalDispensed = Number(staged.dose_ml) * Number(staged.syringe_count);
    const dosePerSyringe = Number(staged.dose_ml);
    const wasteMl = Number(staged.waste_ml) * Number(staged.syringe_count);
    const syringeCount = Number(staged.syringe_count);
    const dispenseDate = new Date();
    // Format the staged date nicely
    const stagedDateFormatted = new Date(staged.staged_date).toLocaleDateString('en-US', {
      month: '2-digit', day: '2-digit', year: 'numeric'
    });
    const notes = `Used prefilled dose from ${stagedDateFormatted}`;

    console.log('[Use Staged] Creating dispense:', {
      finalPatientId, finalPatientName, vialId: staged.vial_id,
      totalDispensed, dosePerSyringe, syringeCount, wasteMl
    });

    const dispenseResult = await client.query<{ dispense_id: string }>(
      `INSERT INTO dispenses (
        patient_id, patient_name, vial_id, vial_external_id, total_dispensed_ml, 
        dose_per_syringe_ml, syringe_count, waste_ml, prescriber, 
        dispense_date, recorded_by, notes, transaction_type
      ) VALUES (
        $1::uuid, $2::text, $3::uuid, $4::text, $5::numeric, 
        $6::numeric, $7::integer, $8::numeric, $9::text, 
        $10::timestamp, $11::text, $12::text, $13::text
      ) RETURNING dispense_id`,
      [
        finalPatientId,
        finalPatientName,
        staged.vial_id,
        staged.vial_external_id,
        totalDispensed,
        dosePerSyringe,
        syringeCount,
        wasteMl,
        staged.vendor || 'Unknown',
        dispenseDate.toISOString(),
        user.name || 'System',
        notes,
        'Dispense'
      ]
    );

    const dispenseId = dispenseResult.rows[0].dispense_id;
    console.log('[Use Staged] Created dispense:', dispenseId);

    // Update DEA transaction to link to dispense and update notes
    const todayStr = new Date().toISOString().split('T')[0];
    const newNote = ` → DISPENSED TO: ${finalPatientName} on ${todayStr}`;

    await client.query(
      `UPDATE dea_transactions
       SET dispense_id = $1::uuid,
           patient_id = $2::uuid,
           patient_name = $3::text,
           notes = CONCAT(COALESCE(notes, ''), $4::text)
       WHERE dea_tx_id = $5::uuid`,
      [dispenseId, finalPatientId, finalPatientName, newNote, staged.dispense_dea_tx_id]
    );
    console.log('[Use Staged] Updated DEA transaction');

    // Mark staged dose as dispensed
    await client.query(
      `UPDATE staged_doses
       SET status = 'dispensed',
           dispensed_at = NOW(),
           dispensed_to_patient_id = $1::uuid,
           updated_at = NOW()
       WHERE staged_dose_id = $2::uuid`,
      [finalPatientId, stagedDoseId]
    );
    console.log('[Use Staged] Marked staged dose as dispensed');

    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      dispenseId,
      patientName: finalPatientName,
      totalMl: staged.total_ml
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error using staged dose:', error);
    return NextResponse.json(
      { error: 'Failed to use staged dose' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
