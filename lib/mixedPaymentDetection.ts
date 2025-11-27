import { query, getPool } from './db';
import type { PoolClient } from 'pg';

export async function detectAndUpdateMixedPaymentPatients(): Promise<number> {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Find all patients who have both QuickBooks mapping and active Jane memberships
    const mixedPatients = await client.query<{ patient_id: string; client_type_key: string }>(
      `SELECT DISTINCT p.patient_id, p.client_type_key
       FROM patients p
       INNER JOIN patient_qb_mapping qb ON qb.patient_id = p.patient_id AND qb.is_active = TRUE
       INNER JOIN clinicsync_memberships cm ON cm.patient_id = p.patient_id AND cm.is_active = TRUE
       WHERE p.payment_method_key != 'jane_quickbooks'`
    );
    
    let updatedCount = 0;
    
    for (const row of mixedPatients.rows) {
      // Update payment method to 'jane_quickbooks'
      // Update client type to mixed if they're primary care
      const clientTypeUpdate = 
        row.client_type_key && ['primary_care', 'primcare', 'primary'].includes(row.client_type_key)
          ? 'mixed_primcare_jane_qbo_tcmh'
          : row.client_type_key;
      
      await client.query(
        `UPDATE patients 
         SET payment_method_key = 'jane_quickbooks',
             client_type_key = $2,
             row_style_class = 'mixed-payment-lightblue',
             updated_at = NOW()
         WHERE patient_id = $1`,
        [row.patient_id, clientTypeUpdate]
      );
      
      updatedCount++;
    }
    
    await client.query('COMMIT');
    console.log(`Updated ${updatedCount} patients to mixed payment method`);
    return updatedCount;
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error detecting mixed payment patients:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function getMixedPaymentPatientStats(): Promise<{
  totalMixed: number;
  mixedPrimaryCare: number;
  mixedWithMultipleMemberships: number;
}> {
  const stats = await query<{
    total_mixed: string;
    mixed_primary_care: string;
    mixed_multi_memberships: string;
  }>(`
    WITH mixed_patients AS (
      SELECT p.patient_id, p.client_type_key
      FROM patients p
      WHERE p.payment_method_key = 'jane_quickbooks'
    ),
    multi_memberships AS (
      SELECT cm.patient_id, COUNT(DISTINCT cm.clinicsync_patient_id) as membership_count
      FROM clinicsync_memberships cm
      WHERE cm.is_active = TRUE
      GROUP BY cm.patient_id
      HAVING COUNT(DISTINCT cm.clinicsync_patient_id) > 1
    )
    SELECT 
      COUNT(DISTINCT mp.patient_id)::text as total_mixed,
      COUNT(DISTINCT CASE WHEN mp.client_type_key = 'mixed_primcare_jane_qbo_tcmh' THEN mp.patient_id END)::text as mixed_primary_care,
      COUNT(DISTINCT mm.patient_id)::text as mixed_multi_memberships
    FROM mixed_patients mp
    LEFT JOIN multi_memberships mm ON mm.patient_id = mp.patient_id
  `);
  
  return {
    totalMixed: parseInt(stats[0]?.total_mixed || '0', 10),
    mixedPrimaryCare: parseInt(stats[0]?.mixed_primary_care || '0', 10),
    mixedWithMultipleMemberships: parseInt(stats[0]?.mixed_multi_memberships || '0', 10)
  };
}







