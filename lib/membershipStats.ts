import { query } from './db';

export type MembershipStats = {
  renewalsDue: number;
  expired: number;
  outstanding: number;
};

export type OutstandingMembership = {
  patientName: string;
  planName: string | null;
  status: string | null;
  outstandingBalance: string | null;
  contractEndDate: string | null;
};

const NORMALIZE_PATIENT_SQL =
  "lower(regexp_replace(regexp_replace(full_name, '^(mr\\.?|mrs\\.?|ms\\.?|dr\\.?|miss)\\s+', '', 'i'), '\\s+', ' ', 'g'))";

export async function getMembershipStats(): Promise<MembershipStats> {
  const statsQuery = `
    SELECT
      COUNT(*) FILTER (
        WHERE lower(status) LIKE 'active%'
          AND remaining_cycles IS NOT NULL
          AND remaining_cycles < 2
      ) AS renewals_due,
      COUNT(*) FILTER (
        WHERE lower(status) LIKE 'expired%'
           OR (contract_end_date IS NOT NULL AND contract_end_date < CURRENT_DATE)
      ) AS expired_count,
      COUNT(*) FILTER (
        WHERE lower(status) LIKE 'active%'
          AND COALESCE(outstanding_balance, 0) > 0
      ) AS outstanding_count
    FROM jane_packages_import;
  `;

  const [row] = await query<{ renewals_due: string; expired_count: string; outstanding_count: string }>(statsQuery);

  return {
    renewalsDue: Number(row?.renewals_due ?? 0),
    expired: Number(row?.expired_count ?? 0),
    outstanding: Number(row?.outstanding_count ?? 0)
  };
}

export async function getOutstandingMemberships(limit = 8): Promise<OutstandingMembership[]> {
  return query<OutstandingMembership>(
    `
      WITH pkg AS (
        SELECT
          patient_name,
          plan_name,
          status,
          outstanding_balance::numeric AS balance,
          contract_end_date,
          lower(norm_name) AS normalized_name
        FROM jane_packages_import
        WHERE COALESCE(outstanding_balance, 0)::numeric > 0
      ),
      patient_norm AS (
        SELECT
          ${NORMALIZE_PATIENT_SQL} AS normalized_name,
          status_key
        FROM patients
      )
      SELECT
        pkg.patient_name AS "patientName",
        pkg.plan_name AS "planName",
        pkg.status,
        pkg.balance::text AS "outstandingBalance",
        pkg.contract_end_date::text AS "contractEndDate"
      FROM pkg
      LEFT JOIN patient_norm pn
        ON pn.normalized_name = pkg.normalized_name
      WHERE NOT (
        COALESCE(pn.status_key, '') ILIKE 'inactive%'
        OR COALESCE(pn.status_key, '') ILIKE 'discharg%'
      )
      ORDER BY pkg.balance DESC NULLS LAST, pkg.patient_name
      LIMIT $1
    `,
    [limit]
  );
}

