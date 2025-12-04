import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query, getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireApiUser(req, 'admin');

    const { keepPatientId, mergePatientId } = await req.json();

    if (!keepPatientId || !mergePatientId) {
      return NextResponse.json(
        { error: 'Both keepPatientId and mergePatientId are required' },
        { status: 400 }
      );
    }

    if (keepPatientId === mergePatientId) {
      return NextResponse.json(
        { error: 'Cannot merge a patient with itself' },
        { status: 400 }
      );
    }

    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Verify both patients exist
      const patients = await client.query(
        'SELECT patient_id, full_name FROM patients WHERE patient_id IN ($1, $2)',
        [keepPatientId, mergePatientId]
      );

      if (patients.rows.length !== 2) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'One or both patients not found' },
          { status: 404 }
        );
      }

      const keepPatient = patients.rows.find(p => p.patient_id === keepPatientId);
      const mergePatient = patients.rows.find(p => p.patient_id === mergePatientId);

      // List of tables with patient_id foreign keys to update
      const tablesToUpdate = [
        { table: 'dispenses', column: 'patient_id' },
        { table: 'dea_transactions', column: 'patient_id' },
        { table: 'dispense_history', column: 'patient_id' },
        { table: 'clinicsync_memberships', column: 'patient_id' },
        { table: 'patient_qb_mapping', column: 'patient_id' },
        { table: 'payment_issues', column: 'patient_id' },
        { table: 'quickbooks_sales_receipts', column: 'patient_id' },
        { table: 'quickbooks_payments', column: 'patient_id' },
        { table: 'quickbooks_payment_transactions', column: 'patient_id' },
        { table: 'jane_packages_import', column: 'patient_id' },
      ];

      const mergeStats: Record<string, number> = {};

      // Update all related records
      for (const { table, column } of tablesToUpdate) {
        try {
          const result = await client.query(
            `UPDATE ${table} SET ${column} = $1 WHERE ${column} = $2`,
            [keepPatientId, mergePatientId]
          );
          mergeStats[table] = result.rowCount || 0;
        } catch (error: any) {
          // If table doesn't exist or column doesn't exist, skip it
          if (error.code === '42P01' || error.code === '42703') {
            mergeStats[table] = 0;
            continue;
          }
          throw error;
        }
      }

      // Update patient_qb_mapping - handle conflicts (if both patients are mapped to same QB customer)
      try {
        await client.query(`
          UPDATE patient_qb_mapping 
          SET patient_id = $1, updated_at = NOW()
          WHERE patient_id = $2
          AND NOT EXISTS (
            SELECT 1 FROM patient_qb_mapping 
            WHERE patient_id = $1 AND qb_customer_id = patient_qb_mapping.qb_customer_id AND is_active = TRUE
          )
        `, [keepPatientId, mergePatientId]);

        // Deactivate any duplicate mappings
        await client.query(`
          UPDATE patient_qb_mapping 
          SET is_active = FALSE, updated_at = NOW()
          WHERE patient_id = $2
        `, [mergePatientId]);
      } catch (error: any) {
        if (error.code !== '42P01') throw error;
      }

      // Update clinicsync_memberships - handle conflicts
      try {
        await client.query(`
          UPDATE clinicsync_memberships 
          SET patient_id = $1, updated_at = NOW()
          WHERE patient_id = $2
          AND NOT EXISTS (
            SELECT 1 FROM clinicsync_memberships 
            WHERE patient_id = $1 AND clinicsync_patient_id = clinicsync_memberships.clinicsync_patient_id AND is_active = TRUE
          )
        `, [keepPatientId, mergePatientId]);

        // Deactivate any duplicate memberships
        await client.query(`
          UPDATE clinicsync_memberships 
          SET is_active = FALSE, updated_at = NOW()
          WHERE patient_id = $2
        `, [mergePatientId]);
      } catch (error: any) {
        if (error.code !== '42P01') throw error;
      }

      // Mark the merged patient as inactive (don't delete for audit trail)
      await client.query(
        `UPDATE patients 
         SET status_key = 'inactive',
             alert_status = 'Inactive (Merged)',
             updated_at = NOW()
         WHERE patient_id = $1`,
        [mergePatientId]
      );

      // Log the merge (if patient_status_activity_log exists)
      try {
        await client.query(`
          INSERT INTO patient_status_activity_log (
            patient_id, previous_status_key, new_status_key, 
            reason, changed_by, changed_at
          ) VALUES ($1, $2, 'inactive', $3, $4, NOW())
        `, [
          mergePatientId,
          mergePatient.status_key || 'active',
          `Merged into patient ${keepPatient.full_name} (${keepPatientId})`,
          user.email || 'system'
        ]);
      } catch (error: any) {
        // Table might not exist, that's okay
        if (error.code !== '42P01') {
          console.warn('Could not log merge to patient_status_activity_log:', error);
        }
      }

      await client.query('COMMIT');

      return NextResponse.json({
        success: true,
        message: `Successfully merged ${mergePatient.full_name} into ${keepPatient.full_name}`,
        stats: mergeStats,
        keepPatientId,
        mergePatientId
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error merging patients:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to merge patients' },
      { status: 500 }
    );
  }
}

