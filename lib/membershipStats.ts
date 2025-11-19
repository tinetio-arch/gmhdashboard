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
      SELECT
        patient_name AS "patientName",
        plan_name AS "planName",
        status,
        outstanding_balance::text AS "outstandingBalance",
        contract_end_date::text AS "contractEndDate"
      FROM jane_packages_import
      WHERE COALESCE(outstanding_balance, 0)::numeric > 0
      ORDER BY outstanding_balance::numeric DESC NULLS LAST, patient_name
      LIMIT $1
    `,
    [limit]
  );
}

