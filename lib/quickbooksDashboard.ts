import { query } from '@/lib/db';

export type RevenuePeriod = {
  total: number;
  quickbooks: number;
  healthie: number;
};

export type QuickBooksDashboardMetrics = {
  daily: RevenuePeriod;
  weekly: RevenuePeriod;
  monthly: RevenuePeriod;
  paymentIssues: number;
  unmatchedPatients: number;
  totalPatientsOnRecurring: number;
};

export type QuickBooksPaymentIssue = {
  issue_id: string;
  patient_id: string;
  patient_name: string;
  issue_type: string;
  amount_owed: number;
  days_overdue: number;
  created_at: string;
};

export type QuickBooksUnmatchedPatient = {
  patient_id: string;
  full_name: string;
  email: string | null;
  phone_primary: string | null;
};

const QUICKBOOKS_METHOD_FILTER = `
  (
    COALESCE(p.payment_method_key, '') IN ('quickbooks', 'qbo', 'jane_quickbooks')
    OR LOWER(COALESCE(p.payment_method, '')) LIKE '%quickbook%'
  )
`;

export async function getQuickBooksDashboardMetrics(): Promise<QuickBooksDashboardMetrics> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfNextMonth = new Date(startOfMonth.getFullYear(), startOfMonth.getMonth() + 1, 1);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  const results = await Promise.all([
    // 0: Daily: Sales receipts (recurring subscriptions)
    query<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM quickbooks_sales_receipts
        WHERE receipt_date = $1
          AND amount > 0
          AND status IS DISTINCT FROM 'voided'`,
      [startOfToday],
    ),
    // 1: Daily: Payment transactions (one-time payments)
    query<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM quickbooks_payment_transactions
        WHERE payment_date = $1
          AND amount > 0`,
      [startOfToday],
    ),
    // 2: Weekly: Sales receipts
    query<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM quickbooks_sales_receipts
        WHERE receipt_date >= $1
          AND receipt_date < $2
          AND amount > 0
          AND status IS DISTINCT FROM 'voided'`,
      [startOfWeek, endOfWeek],
    ),
    // 3: Weekly: Payment transactions
    query<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM quickbooks_payment_transactions
        WHERE payment_date >= $1
          AND payment_date < $2
          AND amount > 0`,
      [startOfWeek, endOfWeek],
    ),
    // 4: Monthly: Sales receipts
    query<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM quickbooks_sales_receipts
        WHERE receipt_date >= $1
          AND receipt_date < $2
          AND amount > 0
          AND status IS DISTINCT FROM 'voided'`,
      [startOfMonth, startOfNextMonth],
    ),
    // 5: Monthly: Payment transactions
    query<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM quickbooks_payment_transactions
        WHERE payment_date >= $1
          AND payment_date < $2
          AND amount > 0`,
      [startOfMonth, startOfNextMonth],
    ),
    // 6: Payment Issues Count
    query<{ count: number }>(
      `SELECT COUNT(*) AS count
         FROM payment_issues pi
         JOIN patients p ON p.patient_id = pi.patient_id
        WHERE pi.resolved_at IS NULL
          AND ${QUICKBOOKS_METHOD_FILTER}`,
    ),
    // 7: Unmatched Patients Count
    query<{ count: number }>(
      `SELECT COUNT(*) AS count
         FROM patients p
        WHERE ${QUICKBOOKS_METHOD_FILTER}
          AND NOT EXISTS (
                SELECT 1
                  FROM patient_qb_mapping m
                 WHERE m.patient_id = p.patient_id
                   AND m.is_active = TRUE
               )`,
    ),
    // 8: Total Patients on Recurring
    query<{ count: number }>(
      `SELECT COUNT(DISTINCT p.patient_id) AS count
         FROM patients p
         JOIN patient_qb_mapping m
           ON m.patient_id = p.patient_id
          AND m.is_active = TRUE
        WHERE ${QUICKBOOKS_METHOD_FILTER}`,
    ),
    // 9: Healthie Daily
    query<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM healthie_invoices
       WHERE paid_at >= $1 AND paid_at < $2 AND status IN ('paid', 'succeeded', 'processed')`,
      [startOfToday, new Date(startOfToday.getTime() + 86400000)]
    ),
    // 10: Healthie Weekly
    query<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM healthie_invoices
       WHERE paid_at >= $1 AND paid_at < $2 AND status IN ('paid', 'succeeded', 'processed')`,
      [startOfWeek, endOfWeek]
    ),
    // 11: Healthie Monthly
    query<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM healthie_invoices
       WHERE paid_at >= $1 AND paid_at < $2 AND status IN ('paid', 'succeeded', 'processed')`,
      [startOfMonth, startOfNextMonth]
    ),
  ]);

  const parseTotal = (rows: { total?: number }[]) =>
    parseFloat(rows[0]?.total?.toString() || '0');

  const parseCount = (rows: { count?: number }[]) =>
    parseInt(rows[0]?.count?.toString() || '0', 10);

  const qbDaily = parseTotal(results[0]) + parseTotal(results[1]);
  const qbWeekly = parseTotal(results[2]) + parseTotal(results[3]);
  const qbMonthly = parseTotal(results[4]) + parseTotal(results[5]);

  const hDaily = parseTotal(results[9]);
  const hWeekly = parseTotal(results[10]);
  const hMonthly = parseTotal(results[11]);

  return {
    daily: {
      total: qbDaily + hDaily,
      quickbooks: qbDaily,
      healthie: hDaily
    },
    weekly: {
      total: qbWeekly + hWeekly,
      quickbooks: qbWeekly,
      healthie: hWeekly
    },
    monthly: {
      total: qbMonthly + hMonthly,
      quickbooks: qbMonthly,
      healthie: hMonthly
    },
    paymentIssues: parseCount(results[6]),
    unmatchedPatients: parseCount(results[7]),
    totalPatientsOnRecurring: parseCount(results[8]),
  };
}

export async function getQuickBooksPaymentIssues(limit = 10): Promise<QuickBooksPaymentIssue[]> {
  return query<QuickBooksPaymentIssue>(
    `SELECT
        pi.issue_id,
        pi.patient_id,
        p.full_name AS patient_name,
        pi.issue_type,
        pi.amount_owed,
        pi.days_overdue,
        pi.created_at
      FROM payment_issues pi
      JOIN patients p ON p.patient_id = pi.patient_id
      WHERE pi.resolved_at IS NULL
        AND p.status_key NOT IN ('inactive', 'discharged')
        AND ${QUICKBOOKS_METHOD_FILTER}
      ORDER BY pi.days_overdue DESC NULLS LAST,
               pi.amount_owed DESC NULLS LAST,
               pi.created_at DESC
      LIMIT $1`,
    [limit],
  );
}

export async function getQuickBooksUnmatchedPatients(limit = 10): Promise<QuickBooksUnmatchedPatient[]> {
  return query<QuickBooksUnmatchedPatient>(
    `SELECT
        p.patient_id,
        p.full_name,
        p.email,
        p.phone_primary
      FROM patients p
      WHERE ${QUICKBOOKS_METHOD_FILTER}
        AND NOT EXISTS (
              SELECT 1
                FROM patient_qb_mapping m
               WHERE m.patient_id = p.patient_id
                 AND m.is_active = TRUE
             )
      ORDER BY p.updated_at DESC NULLS LAST
      LIMIT $1`,
    [limit],
  );
}
