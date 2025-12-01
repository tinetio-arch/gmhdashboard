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

export type CombinedOutstandingMembership = {
  patientId: string | null;
  patientName: string;
  planName: string | null;
  status: string | null;
  janeBalance: string | null;
  quickbooksBalance: string | null;
  totalBalance: string | null;
  contractEndDate: string | null;
};

const NORMALIZE_PATIENT_SQL =
  "lower(regexp_replace(regexp_replace(full_name, '^(mr\\.?|mrs\\.?|ms\\.?|dr\\.?|miss)\\s+', '', 'i'), '\\s+', ' ', 'g'))";

export async function getMembershipStats(): Promise<MembershipStats> {
  const statsQuery = `
    WITH patient_memberships AS (
      SELECT
        pkg.*,
        pn.patient_id,
        pn.status_key
      FROM jane_packages_import pkg
      INNER JOIN (
        SELECT
          patient_id,
          ${NORMALIZE_PATIENT_SQL} AS normalized_name,
          status_key
        FROM patients
        WHERE patient_id IS NOT NULL
          AND NOT (
            COALESCE(status_key, '') ILIKE 'inactive%'
            OR COALESCE(status_key, '') ILIKE 'discharg%'
          )
      ) pn ON pn.normalized_name = lower(pkg.norm_name)
      WHERE pn.patient_id IS NOT NULL
    ),
    active_memberships AS (
      SELECT DISTINCT patient_id
      FROM patient_memberships
      WHERE lower(status) LIKE 'active%'
        AND contract_end_date IS NOT NULL
        AND contract_end_date >= CURRENT_DATE
    )
    SELECT
      COUNT(*) FILTER (
        WHERE lower(pm.status) LIKE 'active%'
          AND remaining_cycles IS NOT NULL
          AND remaining_cycles < 2
          AND NOT EXISTS (
            SELECT 1 FROM active_memberships am 
            WHERE am.patient_id = pm.patient_id
          )
      ) AS renewals_due,
      COUNT(*) FILTER (
        WHERE (lower(pm.status) LIKE 'expired%'
           OR (pm.contract_end_date IS NOT NULL AND pm.contract_end_date < CURRENT_DATE))
          AND NOT EXISTS (
            SELECT 1 FROM active_memberships am 
            WHERE am.patient_id = pm.patient_id
          )
      ) AS expired_count,
      COUNT(*) FILTER (
        WHERE lower(pm.status) LIKE 'active%'
          AND COALESCE(pm.outstanding_balance, 0) > 0
      ) AS outstanding_count
    FROM patient_memberships pm;
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
      INNER JOIN (
        SELECT
          patient_id,
          ${NORMALIZE_PATIENT_SQL} AS normalized_name,
          status_key
        FROM patients
        WHERE patient_id IS NOT NULL
      ) pn ON pn.normalized_name = lower(pkg.norm_name)
      WHERE COALESCE(pkg.outstanding_balance, 0)::numeric > 0
        AND pn.patient_id IS NOT NULL
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
        WHERE p.patient_id IS NOT NULL
          AND pi.resolved_at IS NULL
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
        WHERE p.patient_id IS NOT NULL
          AND qp.balance > 0
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
        AND cb.patient_id IS NOT NULL
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
        INNER JOIN (
          SELECT
            patient_id,
            ${NORMALIZE_PATIENT_SQL} AS normalized_name,
            status_key
          FROM patients
          WHERE patient_id IS NOT NULL
        ) pn ON pn.normalized_name = lower(pkg.norm_name)
        WHERE COALESCE(pkg.outstanding_balance, 0)::numeric > 0
          AND pn.patient_id IS NOT NULL
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
        WHERE p.patient_id IS NOT NULL
          AND pi.resolved_at IS NULL
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
      WHERE patient_id IS NOT NULL
      ORDER BY balance DESC NULLS LAST, patient_name
      LIMIT $1
    `,
    [limit]
  );
}

/**
 * Get combined outstanding memberships with Jane and QuickBooks balances in separate columns
 */
export async function getCombinedOutstandingMemberships(limit = 50): Promise<CombinedOutstandingMembership[]> {
  return query<CombinedOutstandingMembership>(
    `
      WITH jane_balances AS (
        SELECT
          pn.patient_id,
          pn.full_name AS patient_name,
          pkg.plan_name,
          pn.status_key AS status,
          pkg.outstanding_balance::numeric AS jane_balance,
          pkg.contract_end_date
        FROM jane_packages_import pkg
        INNER JOIN (
          SELECT
            patient_id,
            full_name,
            ${NORMALIZE_PATIENT_SQL} AS normalized_name,
            status_key
          FROM patients
          WHERE patient_id IS NOT NULL
            AND NOT (
              COALESCE(status_key, '') ILIKE 'inactive%'
              OR COALESCE(status_key, '') ILIKE 'discharg%'
            )
        ) pn ON pn.normalized_name = lower(pkg.norm_name)
        WHERE pn.patient_id IS NOT NULL
          AND COALESCE(pkg.outstanding_balance, 0)::numeric > 0
      ),
      sales_receipt_balances AS (
        SELECT
          patient_id,
          SUM(amount) AS total_receipt_balance
        FROM quickbooks_sales_receipts
        WHERE amount > 0
          AND LOWER(COALESCE(status, '')) IN ('unknown', 'declined', 'error', 'failed', 'rejected')
        GROUP BY patient_id
      ),
      payment_issue_totals AS (
        SELECT
          patient_id,
          SUM(amount_owed) AS total_issue_amount
        FROM payment_issues
        WHERE resolved_at IS NULL
          AND amount_owed > 0
          AND issue_type IN (
            'payment_declined', 
            'payment_failed', 
            'insufficient_funds',
            'failed_payment',
            'overdue_invoice',
            'outstanding_balance'
          )
        GROUP BY patient_id
      ),
      qb_balances AS (
        SELECT
          p.patient_id,
          p.full_name AS patient_name,
          p.status_key AS status,
          -- QuickBooks ONLY uses sales receipts, not invoices
          -- For outstanding balances, use payment issues as primary source (they're created from sales receipts with status 'unknown')
          -- Also include sales receipts with declined status as fallback
          -- Use the greater of the two to avoid double-counting (payment issues are usually created from declined sales receipts)
          GREATEST(
            COALESCE(pit.total_issue_amount, 0),
            COALESCE(srb.total_receipt_balance, 0)
          ) AS qb_balance
        FROM patients p
        LEFT JOIN payment_issue_totals pit ON p.patient_id = pit.patient_id
        LEFT JOIN sales_receipt_balances srb ON p.patient_id = srb.patient_id
        WHERE p.patient_id IS NOT NULL
          -- Include patients with QuickBooks payment method OR patients with QuickBooks sales receipts/payment issues
          AND (
            p.payment_method_key IN ('qbo', 'quickbooks') 
            OR p.payment_method_key = 'jane_quickbooks'
            OR EXISTS (SELECT 1 FROM quickbooks_sales_receipts WHERE patient_id = p.patient_id)
            OR EXISTS (SELECT 1 FROM payment_issues WHERE patient_id = p.patient_id AND resolved_at IS NULL)
          )
          AND NOT (
            COALESCE(p.status_key, '') ILIKE 'inactive%'
            OR COALESCE(p.status_key, '') ILIKE 'discharg%'
          )
          AND (
            COALESCE(pit.total_issue_amount, 0) > 0
            OR COALESCE(srb.total_receipt_balance, 0) > 0
          )
      ),
      combined AS (
        SELECT
          COALESCE(j.patient_id, qb.patient_id) AS patient_id,
          COALESCE(j.patient_name, qb.patient_name) AS patient_name,
          CASE 
            WHEN j.patient_id IS NOT NULL AND qb.patient_id IS NOT NULL THEN 'Mixed (Jane + QuickBooks)'
            WHEN j.patient_id IS NOT NULL THEN j.plan_name
            ELSE 'QuickBooks Recurring'
          END AS plan_name,
          COALESCE(j.status, qb.status) AS status,
          COALESCE(j.jane_balance, 0) AS jane_balance,
          COALESCE(qb.qb_balance, 0) AS qb_balance,
          COALESCE(j.jane_balance, 0) + COALESCE(qb.qb_balance, 0) AS total_balance,
          j.contract_end_date
        FROM jane_balances j
        FULL OUTER JOIN qb_balances qb ON j.patient_id = qb.patient_id
        WHERE COALESCE(j.jane_balance, 0) > 0 
           OR COALESCE(qb.qb_balance, 0) > 0
      )
      SELECT
        patient_id AS "patientId",
        patient_name AS "patientName",
        plan_name AS "planName",
        status,
        jane_balance::text AS "janeBalance",
        qb_balance::text AS "quickbooksBalance",
        total_balance::text AS "totalBalance",
        contract_end_date::text AS "contractEndDate"
      FROM combined
      WHERE patient_id IS NOT NULL
        AND total_balance > 0
      ORDER BY total_balance DESC NULLS LAST, patient_name
      LIMIT $1
    `,
    [limit]
  );
}

