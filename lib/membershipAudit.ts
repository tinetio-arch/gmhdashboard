import { query } from './db';

type AuditBase = {
  patient_name: string;
  plan_name: string | null;
  status: string | null;
  remaining_cycles: string | null;
  contract_end_date: string | null;
  outstanding_balance: string | null;
  category: string | null;
  norm_name: string;
  purchase_date: string | null;
  service_start_date: string | null;
};

type ReadyRow = AuditBase & {
  patient_id: string;
  matched_patient: string;
  clinicsync_patient_id: string;
};

type NeedsDataRow = AuditBase & {
  issue: string;
  patient_id: string | null;
  matched_patient: string | null;
  clinicsync_patient_id: string | null;
  clinicsync_name: string | null;
};

type InactiveRow = AuditBase;

type DuplicateMembershipGroup = {
  patient_name: string;
  norm_name: string;
  memberships: AuditBase[];
};

export type MembershipAuditData = {
  readyToMap: ReadyRow[];
  needsData: NeedsDataRow[];
  inactive: InactiveRow[];
  duplicates: DuplicateMembershipGroup[];
};

const NORMALIZE_PATIENT_SQL =
  "lower(regexp_replace(regexp_replace(full_name, '^(mr\\.?|mrs\\.?|ms\\.?|dr\\.?|miss)\\s+', '', 'i'), '\\s+', ' ', 'g'))";

const NORMALIZE_VALUE_TEMPLATE =
  "lower(regexp_replace(regexp_replace(VALUE_PLACEHOLDER, '^(mr\\.?|mrs\\.?|ms\\.?|dr\\.?|miss)\\s+', '', 'i'), '\\s+', ' ', 'g'))";

const NORMALIZE_CLINICSYNC_SQL = NORMALIZE_VALUE_TEMPLATE.replace('VALUE_PLACEHOLDER', "raw_payload->>'name'");

export async function getMembershipAuditData(): Promise<MembershipAuditData> {
  const readyQuery = `
    WITH pkg AS (
      SELECT *, lower(norm_name) AS normalized_name
      FROM jane_packages_import
      WHERE COALESCE(status, '') <> ''
        AND lower(status) NOT LIKE 'inactive%'
        AND lower(status) NOT LIKE 'discharg%'
    ),
    patient_norm AS (
      SELECT
        patient_id,
        full_name,
        ${NORMALIZE_PATIENT_SQL} AS normalized_name,
        COUNT(*) OVER (PARTITION BY ${NORMALIZE_PATIENT_SQL}) AS name_count
      FROM patients
      WHERE COALESCE(payment_method,'') ILIKE '%jane%'
    ),
    cs_norm AS (
      SELECT
        clinicsync_patient_id,
        raw_payload->>'name' AS cs_name,
        ${NORMALIZE_CLINICSYNC_SQL} AS normalized_name,
        COUNT(*) OVER (PARTITION BY ${NORMALIZE_CLINICSYNC_SQL}) AS name_count
      FROM clinicsync_memberships
      WHERE COALESCE(membership_status,'') ILIKE 'active%'
    ),
    mapped AS (
      SELECT patient_id, clinicsync_patient_id FROM patient_clinicsync_mapping
    ),
    resolved AS (
      SELECT normalized_name FROM membership_audit_resolutions
    )
    SELECT
      pkg.patient_name,
      pkg.plan_name,
      pkg.status,
      pkg.remaining_cycles::text,
      pkg.contract_end_date::text,
      pkg.outstanding_balance::text,
      pkg.category,
      pkg.normalized_name AS norm_name,
      pkg.purchase_date::text,
      pkg.start_date::text AS service_start_date,
      pn.patient_id,
      pn.full_name AS matched_patient,
      cs.clinicsync_patient_id
    FROM pkg
    JOIN patient_norm pn ON pn.normalized_name = pkg.normalized_name
    JOIN cs_norm cs ON cs.normalized_name = pkg.normalized_name
    LEFT JOIN mapped m
      ON (m.patient_id = pn.patient_id OR m.clinicsync_patient_id = cs.clinicsync_patient_id)
    LEFT JOIN resolved r ON r.normalized_name = pkg.normalized_name
    WHERE pn.name_count = 1
      AND cs.name_count = 1
      AND m.patient_id IS NULL
      AND m.clinicsync_patient_id IS NULL
      AND r.normalized_name IS NULL
    ORDER BY pkg.patient_name;
  `;

  const needsDataQuery = `
    WITH pkg AS (
      SELECT *, lower(norm_name) AS normalized_name
      FROM jane_packages_import
      WHERE COALESCE(status, '') <> ''
        AND lower(status) NOT LIKE 'inactive%'
        AND lower(status) NOT LIKE 'discharg%'
    ),
    patient_norm AS (
      SELECT
        patient_id,
        full_name,
        ${NORMALIZE_PATIENT_SQL} AS normalized_name,
        COUNT(*) OVER (PARTITION BY ${NORMALIZE_PATIENT_SQL}) AS name_count
      FROM patients
      WHERE COALESCE(payment_method,'') ILIKE '%jane%'
    ),
    cs_norm AS (
      SELECT
        clinicsync_patient_id,
        raw_payload->>'name' AS cs_name,
        ${NORMALIZE_CLINICSYNC_SQL} AS normalized_name,
        COUNT(*) OVER (PARTITION BY ${NORMALIZE_CLINICSYNC_SQL}) AS name_count
      FROM clinicsync_memberships
      WHERE COALESCE(membership_status,'') ILIKE 'active%'
    ),
    mapped AS (
      SELECT patient_id, clinicsync_patient_id FROM patient_clinicsync_mapping
    ),
    resolved AS (
      SELECT normalized_name FROM membership_audit_resolutions
    )
    SELECT
      pkg.patient_name,
      pkg.plan_name,
      pkg.status,
      pkg.remaining_cycles::text,
      pkg.contract_end_date::text,
      pkg.outstanding_balance::text,
      pkg.category,
      pkg.normalized_name AS norm_name,
      pkg.purchase_date::text,
      pkg.start_date::text AS service_start_date,
      pn.patient_id,
      pn.full_name AS matched_patient,
      cs.clinicsync_patient_id,
      cs.cs_name AS clinicsync_name,
      CASE
        WHEN r.normalized_name IS NOT NULL THEN 'resolved'
        WHEN pn.patient_id IS NULL THEN 'no_gmh_match'
        WHEN pn.name_count > 1 THEN 'multiple_gmh_matches'
        WHEN cs.clinicsync_patient_id IS NULL THEN 'no_clinicsync_match'
        WHEN cs.name_count > 1 THEN 'multiple_clinicsync_matches'
        WHEN EXISTS (
          SELECT 1 FROM mapped m
          WHERE m.patient_id = pn.patient_id OR m.clinicsync_patient_id = cs.clinicsync_patient_id
        ) THEN 'already_mapped'
        ELSE 'unknown'
      END AS issue
    FROM pkg
    LEFT JOIN patient_norm pn ON pn.normalized_name = pkg.normalized_name
    LEFT JOIN cs_norm cs ON cs.normalized_name = pkg.normalized_name
    LEFT JOIN resolved r ON r.normalized_name = pkg.normalized_name
    WHERE
      (
        pn.patient_id IS NULL
        OR pn.name_count > 1
        OR cs.clinicsync_patient_id IS NULL
        OR cs.name_count > 1
        OR EXISTS (
          SELECT 1 FROM mapped m
          WHERE m.patient_id = pn.patient_id OR m.clinicsync_patient_id = cs.clinicsync_patient_id
        )
      )
      AND r.normalized_name IS NULL
    ORDER BY pkg.patient_name;
  `;

  const inactiveQuery = `
    SELECT
      patient_name,
      plan_name,
      status,
      remaining_cycles::text,
      contract_end_date::text,
      outstanding_balance::text,
      category,
      lower(norm_name) AS norm_name,
      purchase_date::text,
      start_date::text AS service_start_date
    FROM jane_packages_import
    WHERE COALESCE(status, '') = ''
      OR lower(status) LIKE 'inactive%'
      OR lower(status) LIKE 'discharg%'
    ORDER BY patient_name;
  `;

  const duplicatesQuery = `
    SELECT
      lower(norm_name) AS norm_name,
      MIN(patient_name) AS patient_name,
      json_agg(
        json_build_object(
          'patient_name', patient_name,
          'plan_name', plan_name,
          'status', status,
          'remaining_cycles', remaining_cycles::text,
          'contract_end_date', contract_end_date::text,
          'outstanding_balance', outstanding_balance::text,
          'category', category,
          'norm_name', lower(norm_name),
          'purchase_date', purchase_date::text,
          'service_start_date', start_date::text
        )
        ORDER BY plan_name
      ) AS memberships
    FROM jane_packages_import
    GROUP BY lower(norm_name)
    HAVING COUNT(*) > 1
    ORDER BY MIN(patient_name);
  `;

  const [readyRows, needsRows, inactiveRows, duplicateRows] = await Promise.all([
    query<ReadyRow>(readyQuery),
    query<NeedsDataRow>(needsDataQuery),
    query<InactiveRow>(inactiveQuery),
    query<DuplicateMembershipGroup>(duplicatesQuery)
  ]);

  return {
    readyToMap: readyRows,
    needsData: needsRows,
    inactive: inactiveRows,
    duplicates: duplicateRows
  };
}

