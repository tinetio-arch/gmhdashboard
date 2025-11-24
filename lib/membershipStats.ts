import { query } from './db';

export type MembershipStats = {
  renewalsDue: number;
  expired: number;
  outstanding: number;
};

export type OutstandingMembership = {
  patientId: string | null;
  patientName: string;
  planName: string | null;
  status: string | null;
  outstandingBalance: string | null;
  contractEndDate: string | null;
  paymentSource: 'Jane' | 'QuickBooks' | null;
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

export async function getJaneOutstandingMemberships(limit = 8): Promise<OutstandingMembership[]> {
  return query<OutstandingMembership>(
    `
      SELECT
        pn.patient_id AS "patientId",
        pkg.patient_name AS "patientName",
        pkg.plan_name AS "planName",
        pkg.status,
        pkg.outstanding_balance AS "outstandingBalance",
        pkg.contract_end_date::text AS "contractEndDate",
        'Jane' AS "paymentSource"
      FROM jane_packages_import pkg
      LEFT JOIN (
        SELECT
          patient_id,
          ${NORMALIZE_PATIENT_SQL} AS normalized_name,
          status_key
        FROM patients
      ) pn ON pn.normalized_name = lower(pkg.norm_name)
      WHERE COALESCE(pkg.outstanding_balance, 0)::numeric > 0
        AND NOT (
          COALESCE(pn.status_key, '') ILIKE 'inactive%'
          OR COALESCE(pn.status_key, '') ILIKE 'discharg%'
        )
      ORDER BY pkg.outstanding_balance::numeric DESC NULLS LAST, pkg.patient_name
      LIMIT $1
    `,
    [limit]
  );
}

export async function getQuickBooksOutstandingMemberships(limit = 8): Promise<OutstandingMembership[]> {
  return query<OutstandingMembership>(
    `
      WITH payment_issue_balances AS (
        SELECT
          p.patient_id,
          p.full_name,
          p.status_key,
          p.payment_method_key,
          COALESCE(SUM(pi.amount_owed), 0) AS total_owed
        FROM patients p
        JOIN payment_issues pi ON p.patient_id = pi.patient_id
        WHERE pi.resolved_at IS NULL
          AND pi.issue_type IN (
            'payment_declined', 
            'payment_failed', 
            'insufficient_funds',
            'overdue_invoice',
            'outstanding_balance',
            'failed_payment'
          )
          AND (p.payment_method_key IN ('qbo', 'quickbooks') OR p.payment_method_key = 'jane_quickbooks')
          AND NOT (
            COALESCE(p.status_key, '') ILIKE 'inactive%'
            OR COALESCE(p.status_key, '') ILIKE 'discharg%'
          )
        GROUP BY p.patient_id, p.full_name, p.status_key, p.payment_method_key
      ),
      invoice_balances AS (
        SELECT
          p.patient_id,
          p.full_name,
          p.status_key,
          p.payment_method_key,
          COALESCE(SUM(qp.balance), 0) AS total_owed
        FROM patients p
        JOIN quickbooks_payments qp ON p.patient_id = qp.patient_id
        WHERE qp.balance > 0
          AND (p.payment_method_key IN ('qbo', 'quickbooks') OR p.payment_method_key = 'jane_quickbooks')
          AND NOT (
            COALESCE(p.status_key, '') ILIKE 'inactive%'
            OR COALESCE(p.status_key, '') ILIKE 'discharg%'
          )
        GROUP BY p.patient_id, p.full_name, p.status_key, p.payment_method_key
      ),
      combined_balances AS (
        SELECT
          COALESCE(pib.patient_id, ib.patient_id) AS patient_id,
          COALESCE(pib.full_name, ib.full_name) AS full_name,
          COALESCE(pib.status_key, ib.status_key) AS status_key,
          GREATEST(COALESCE(pib.total_owed, 0), COALESCE(ib.total_owed, 0)) AS total_owed
        FROM payment_issue_balances pib
        FULL OUTER JOIN invoice_balances ib ON pib.patient_id = ib.patient_id
        WHERE COALESCE(pib.total_owed, 0) > 0 OR COALESCE(ib.total_owed, 0) > 0
      )
      SELECT
        cb.patient_id AS "patientId",
        cb.full_name AS "patientName",
        'QuickBooks Recurring' AS "planName",
        cb.status_key AS status,
        cb.total_owed::text AS "outstandingBalance",
        NULL AS "contractEndDate",
        'QuickBooks' AS "paymentSource"
      FROM combined_balances cb
      WHERE cb.total_owed > 0
      ORDER BY cb.total_owed DESC NULLS LAST, cb.full_name
      LIMIT $1
    `,
    [limit]
  );
}

export async function getOutstandingMemberships(limit = 8): Promise<OutstandingMembership[]> {
  return query<OutstandingMembership>(
    `
      WITH jane_outstanding AS (
        SELECT
          pn.patient_id,
          pkg.patient_name,
          pkg.plan_name,
          pkg.status,
          pkg.outstanding_balance::numeric AS balance,
          pkg.contract_end_date,
          'Jane' AS payment_source
        FROM jane_packages_import pkg
        LEFT JOIN (
          SELECT
            patient_id,
            ${NORMALIZE_PATIENT_SQL} AS normalized_name,
            status_key
          FROM patients
        ) pn ON pn.normalized_name = lower(pkg.norm_name)
        WHERE COALESCE(pkg.outstanding_balance, 0)::numeric > 0
          AND NOT (
            COALESCE(pn.status_key, '') ILIKE 'inactive%'
            OR COALESCE(pn.status_key, '') ILIKE 'discharg%'
          )
      ),
      qbo_outstanding AS (
        SELECT
          p.patient_id,
          p.full_name AS patient_name,
          'QuickBooks Recurring' AS plan_name,
          p.status_key AS status,
          COALESCE(pi.amount_owed, 0) AS balance,
          NULL::date AS contract_end_date,
          'QuickBooks' AS payment_source
        FROM patients p
        JOIN payment_issues pi ON p.patient_id = pi.patient_id
        WHERE pi.resolved_at IS NULL
          AND pi.issue_type IN (
            'payment_declined', 
            'payment_failed', 
            'insufficient_funds',
            'overdue_invoice',
            'outstanding_balance',
            'failed_payment'
          )
          AND (p.payment_method_key IN ('qbo', 'quickbooks') OR p.payment_method_key = 'jane_quickbooks')
          AND NOT (
            COALESCE(p.status_key, '') ILIKE 'inactive%'
            OR COALESCE(p.status_key, '') ILIKE 'discharg%'
          )
      ),
      combined AS (
        SELECT * FROM jane_outstanding
        UNION ALL
        SELECT * FROM qbo_outstanding
      )
      SELECT
        patient_id AS "patientId",
        patient_name AS "patientName",
        plan_name AS "planName",
        status,
        balance::text AS "outstandingBalance",
        contract_end_date::text AS "contractEndDate",
        payment_source AS "paymentSource"
      FROM combined
      ORDER BY balance DESC NULLS LAST, patient_name
      LIMIT $1
    `,
    [limit]
  );
}

