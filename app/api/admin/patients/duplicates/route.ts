import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export type DuplicatePatient = {
  patient_id: string;
  full_name: string;
  email: string | null;
  phone_primary: string | null;
  payment_method_key: string | null;
  status_key: string | null;
  date_added: string | null;
  dispense_count: number;
  transaction_count: number;
  membership_count: number;
  qb_mapping_count: number;
  payment_issue_count: number;
};

export async function GET(req: NextRequest) {
  try {
    const user = await requireApiUser(req, 'admin');

    // Find duplicate patients by normalized name
    const duplicates = await query<{
      normalized_name: string;
      patient_ids: string[];
      names: string[];
      count: number;
    }>(`
      WITH normalized_patients AS (
        SELECT 
          patient_id,
          full_name,
          LOWER(TRIM(REGEXP_REPLACE(full_name, '[^a-zA-Z0-9\\s]', '', 'g'))) AS normalized_name
        FROM patients
        WHERE patient_id IS NOT NULL
          AND status_key != 'inactive'
          AND (alert_status IS NULL OR LOWER(alert_status) NOT LIKE '%inactive%' AND LOWER(alert_status) NOT LIKE '%merged%')
      ),
      duplicate_groups AS (
        SELECT 
          normalized_name,
          array_agg(patient_id ORDER BY patient_id) AS patient_ids,
          array_agg(full_name ORDER BY patient_id) AS names,
          COUNT(*) AS count
        FROM normalized_patients
        GROUP BY normalized_name
        HAVING COUNT(*) > 1
      )
      SELECT * FROM duplicate_groups
      ORDER BY count DESC, normalized_name
    `);

    // For each duplicate group, get detailed patient info
    const duplicateDetails: Array<{
      normalized_name: string;
      patients: DuplicatePatient[];
    }> = [];

    for (const group of duplicates) {
      const patientDetails = await query<DuplicatePatient>(`
        SELECT 
          p.patient_id,
          p.full_name,
          p.email,
          p.phone_primary,
          p.payment_method_key,
          p.status_key,
          p.date_added,
          COALESCE(d.dispense_count, 0)::int AS dispense_count,
          COALESCE(t.transaction_count, 0)::int AS transaction_count,
          COALESCE(m.membership_count, 0)::int AS membership_count,
          COALESCE(qb.qb_mapping_count, 0)::int AS qb_mapping_count,
          COALESCE(pi.payment_issue_count, 0)::int AS payment_issue_count
        FROM patients p
        LEFT JOIN (
          SELECT patient_id, COUNT(*) AS dispense_count
          FROM dispenses
          GROUP BY patient_id
        ) d ON d.patient_id = p.patient_id
        LEFT JOIN (
          SELECT patient_id, COUNT(*) AS transaction_count
          FROM dea_transactions
          GROUP BY patient_id
        ) t ON t.patient_id = p.patient_id
        LEFT JOIN (
          SELECT patient_id, COUNT(*) AS membership_count
          FROM clinicsync_memberships
          GROUP BY patient_id
        ) m ON m.patient_id = p.patient_id
        LEFT JOIN (
          SELECT patient_id, COUNT(*) AS qb_mapping_count
          FROM patient_qb_mapping
          WHERE is_active = TRUE
          GROUP BY patient_id
        ) qb ON qb.patient_id = p.patient_id
        LEFT JOIN (
          SELECT patient_id, COUNT(*) AS payment_issue_count
          FROM payment_issues
          WHERE resolved_at IS NULL
          GROUP BY patient_id
        ) pi ON pi.patient_id = p.patient_id
        WHERE p.patient_id = ANY($1::uuid[])
          AND p.status_key != 'inactive'
          AND (p.alert_status IS NULL OR LOWER(p.alert_status) NOT LIKE '%inactive%' AND LOWER(p.alert_status) NOT LIKE '%merged%')
        ORDER BY 
          d.dispense_count DESC NULLS LAST,
          t.transaction_count DESC NULLS LAST,
          p.date_added ASC NULLS LAST
      `, [group.patient_ids]);

      duplicateDetails.push({
        normalized_name: group.normalized_name,
        patients: patientDetails
      });
    }

    return NextResponse.json({ duplicates: duplicateDetails });
  } catch (error) {
    console.error('Error finding duplicate patients:', error);
    return NextResponse.json(
      { error: 'Failed to find duplicate patients' },
      { status: 500 }
    );
  }
}




