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
        await client.query('ROLLBACK').catch(() => {}); // Ignore rollback errors
        return NextResponse.json(
          { error: 'One or both patients not found' },
          { status: 404 }
        );
      }

      const keepPatient = patients.rows.find(p => p.patient_id === keepPatientId);
      const mergePatient = patients.rows.find(p => p.patient_id === mergePatientId);

      // List of tables with patient_id foreign keys to update
      // Note: clinicsync_memberships and patient_qb_mapping are handled separately with conflict resolution
      // Note: Some tables may not have patient_id column - we'll check dynamically
      const tablesToUpdate = [
        { table: 'dispenses', column: 'patient_id' },
        { table: 'dea_transactions', column: 'patient_id' },
        { table: 'payment_issues', column: 'patient_id' },
        { table: 'quickbooks_sales_receipts', column: 'patient_id' },
        { table: 'quickbooks_payments', column: 'patient_id' },
        { table: 'quickbooks_payment_transactions', column: 'patient_id' },
        // jane_packages_import - removed as it may not have patient_id column
        // dispense_history - removed as it may not have patient_id column
      ];

      const mergeStats: Record<string, number> = {};

      // Update all related records
      // Use SAVEPOINT to allow recovery from column-not-found errors
      for (const { table, column } of tablesToUpdate) {
        const savepointName = `sp_${table.replace(/[^a-z0-9]/g, '_')}`;
        try {
          // Create a savepoint before each update
          await client.query(`SAVEPOINT ${savepointName}`);
          
          console.log(`[MERGE] Updating ${table}.${column} for patient ${mergePatientId} -> ${keepPatientId}`);
          // Explicitly cast to UUID to help PostgreSQL determine types
          const result = await client.query(
            `UPDATE ${table} SET ${column} = $1::uuid WHERE ${column} = $2::uuid`,
            [keepPatientId, mergePatientId]
          );
          mergeStats[table] = result.rowCount || 0;
          console.log(`[MERGE] Updated ${table}.${column}: ${result.rowCount} rows`);
          
          // Release savepoint on success
          await client.query(`RELEASE SAVEPOINT ${savepointName}`);
        } catch (error: any) {
          console.error(`[MERGE] Error updating ${table}.${column}:`, {
            code: error.code,
            message: error.message,
            detail: error.detail,
            constraint: error.constraint,
            table: error.table,
            column: error.column
          });
          
          // If table doesn't exist or column doesn't exist, rollback to savepoint and skip
          if (error.code === '42P01' || error.code === '42703') {
            try {
              await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
              await client.query(`RELEASE SAVEPOINT ${savepointName}`);
            } catch (spError: any) {
              // Savepoint might not exist if error happened before it was created
              console.warn(`[MERGE] Could not rollback to savepoint ${savepointName}:`, spError);
            }
            mergeStats[table] = 0;
            console.log(`[MERGE] Skipping ${table}.${column} (table/column doesn't exist)`);
            continue;
          }
          
          // For ANY other error, rollback to savepoint first, then abort entire transaction
          try {
            await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
            await client.query(`RELEASE SAVEPOINT ${savepointName}`);
          } catch (spError: any) {
            console.warn(`[MERGE] Could not rollback to savepoint ${savepointName}:`, spError);
          }
          
          // Now rollback the entire transaction
          console.error(`[MERGE] Rolling back entire transaction due to error in ${table}.${column} (Code: ${error.code})`);
          try {
            await client.query('ROLLBACK');
          } catch (rollbackError: any) {
            console.error(`[MERGE] Error during rollback:`, rollbackError);
          }
          
          // Provide a detailed error message
          const errorDetails = error.detail ? ` Detail: ${error.detail}` : '';
          const constraintInfo = error.constraint ? ` Constraint: ${error.constraint}` : '';
          throw new Error(
            `Failed to update ${table}.${column}: ${error.message}${errorDetails}${constraintInfo} (Code: ${error.code})`
          );
        }
      }

      // Update patient_qb_mapping - handle conflicts (if both patients are mapped to same QB customer)
      try {
        console.log(`[MERGE] Updating patient_qb_mapping for patient ${mergePatientId} -> ${keepPatientId}`);
        // Explicitly cast parameters to UUID to help PostgreSQL determine types
        await client.query(`
          UPDATE patient_qb_mapping 
          SET patient_id = $1::uuid, updated_at = NOW()
          WHERE patient_id = $2::uuid
          AND NOT EXISTS (
            SELECT 1 FROM patient_qb_mapping 
            WHERE patient_id = $1::uuid 
              AND qb_customer_id = patient_qb_mapping.qb_customer_id 
              AND is_active = TRUE
          )
        `, [keepPatientId, mergePatientId]);

        // Deactivate any duplicate mappings
        await client.query(`
          UPDATE patient_qb_mapping 
          SET is_active = FALSE, updated_at = NOW()
          WHERE patient_id = $1::uuid
        `, [mergePatientId]);
        console.log(`[MERGE] Updated patient_qb_mapping`);
      } catch (error: any) {
        console.error(`[MERGE] Error updating patient_qb_mapping:`, {
          code: error.code,
          message: error.message,
          detail: error.detail,
          constraint: error.constraint
        });
        if (error.code === '42P01') {
          // Table doesn't exist, skip it
          console.log(`[MERGE] Skipping patient_qb_mapping (table doesn't exist)`);
          // Do nothing, just continue to next section
        } else if (error.code === '25P02') {
          // Transaction aborted
          console.error('[MERGE] Transaction aborted in patient_qb_mapping update');
          await client.query('ROLLBACK').catch(() => {});
          throw new Error(`Transaction was aborted while updating patient_qb_mapping. Original error: ${error.message}`);
        } else {
          console.error('[MERGE] Rolling back due to error in patient_qb_mapping');
          await client.query('ROLLBACK').catch(() => {});
          throw new Error(`Failed to update patient_qb_mapping: ${error.message} (Code: ${error.code})`);
        }
      }

      // Update clinicsync_memberships - handle conflicts
      try {
        console.log(`[MERGE] Updating clinicsync_memberships for patient ${mergePatientId} -> ${keepPatientId}`);
        // Explicitly cast parameters to UUID to help PostgreSQL determine types
        await client.query(`
          UPDATE clinicsync_memberships 
          SET patient_id = $1::uuid, updated_at = NOW()
          WHERE patient_id = $2::uuid
          AND NOT EXISTS (
            SELECT 1 FROM clinicsync_memberships 
            WHERE patient_id = $1::uuid 
              AND clinicsync_patient_id = clinicsync_memberships.clinicsync_patient_id 
              AND is_active = TRUE
          )
        `, [keepPatientId, mergePatientId]);

        // Deactivate any duplicate memberships
        await client.query(`
          UPDATE clinicsync_memberships 
          SET is_active = FALSE, updated_at = NOW()
          WHERE patient_id = $1::uuid
        `, [mergePatientId]);
        console.log(`[MERGE] Updated clinicsync_memberships`);
      } catch (error: any) {
        console.error(`[MERGE] Error updating clinicsync_memberships:`, {
          code: error.code,
          message: error.message,
          detail: error.detail,
          constraint: error.constraint
        });
        if (error.code === '42P01') {
          // Table doesn't exist, skip it
          console.log(`[MERGE] Skipping clinicsync_memberships (table doesn't exist)`);
          // Do nothing, just continue to next section
        } else if (error.code === '25P02') {
          // Transaction aborted
          console.error('[MERGE] Transaction aborted in clinicsync_memberships update');
          await client.query('ROLLBACK').catch(() => {});
          throw new Error(`Transaction was aborted while updating clinicsync_memberships. Original error: ${error.message}`);
        } else {
          console.error('[MERGE] Rolling back due to error in clinicsync_memberships');
          await client.query('ROLLBACK').catch(() => {});
          throw new Error(`Failed to update clinicsync_memberships: ${error.message} (Code: ${error.code})`);
        }
      }

      // Mark the merged patient as inactive (don't delete for audit trail)
      try {
        console.log(`[MERGE] Marking patient ${mergePatientId} as inactive`);
        await client.query(
          `UPDATE patients 
           SET status_key = 'inactive',
               alert_status = 'Inactive (Merged)',
               updated_at = NOW()
           WHERE patient_id = $1::uuid`,
          [mergePatientId]
        );
        console.log(`[MERGE] Patient ${mergePatientId} marked as inactive`);
      } catch (error: any) {
        console.error(`[MERGE] Error updating patient status:`, {
          code: error.code,
          message: error.message,
          detail: error.detail,
          constraint: error.constraint
        });
        if (error.code === '25P02') {
          console.error('[MERGE] Transaction aborted while updating patient status');
          await client.query('ROLLBACK').catch(() => {});
          throw new Error(`Transaction was aborted while updating patient status. Original error: ${error.message}`);
        }
        console.error('[MERGE] Rolling back due to error updating patient status');
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Failed to update patient status: ${error.message} (Code: ${error.code})`);
      }

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
        // Table might not exist, that's okay - don't fail the transaction
        if (error.code === '42P01') {
          // Table doesn't exist, continue
        } else if (error.code === '25P02') {
          // Transaction already aborted, will be handled by outer catch
          throw error;
        } else {
          console.warn('Could not log merge to patient_status_activity_log:', error);
          // Don't throw - logging failure shouldn't fail the merge
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
      // Always try to rollback, but don't fail if rollback itself fails
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error during rollback (non-fatal):', rollbackError);
      }
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

