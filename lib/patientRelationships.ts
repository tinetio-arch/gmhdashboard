/**
 * Bulk patient relationships for the /ops/patients/ page.
 *
 * For each patient, returns:
 *   - parentName: if parent_patient_id is set, the parent's full name (for "Dependent of X" chip)
 *   - spouseName: if spouse_patient_id is set, the spouse's full name
 *   - dependentCount: number of patients where parent_patient_id = this row's id
 *
 * Per policy §7.4 (Dependents) and §7.5 (Spouses).
 */

import { query } from '@/lib/db';

export type RelationshipInfo = {
  parentPatientId: string | null;
  parentName: string | null;
  spousePatientId: string | null;
  spouseName: string | null;
  dependentCount: number;
};

export async function fetchBulkRelationships(): Promise<Record<string, RelationshipInfo>> {
  const rows = await query<{
    patient_id: string;
    parent_patient_id: string | null;
    parent_name: string | null;
    spouse_patient_id: string | null;
    spouse_name: string | null;
    dependent_count: string;
  }>(`
    SELECT
      p.patient_id::text AS patient_id,
      p.parent_patient_id::text AS parent_patient_id,
      parent.full_name AS parent_name,
      p.spouse_patient_id::text AS spouse_patient_id,
      spouse.full_name AS spouse_name,
      (SELECT COUNT(*)::text FROM patients c WHERE c.parent_patient_id = p.patient_id) AS dependent_count
    FROM patients p
    LEFT JOIN patients parent ON p.parent_patient_id = parent.patient_id
    LEFT JOIN patients spouse ON p.spouse_patient_id = spouse.patient_id
  `);

  const map: Record<string, RelationshipInfo> = {};
  for (const r of rows) {
    map[r.patient_id] = {
      parentPatientId: r.parent_patient_id,
      parentName: r.parent_name,
      spousePatientId: r.spouse_patient_id,
      spouseName: r.spouse_name,
      dependentCount: parseInt(r.dependent_count, 10) || 0
    };
  }
  return map;
}
