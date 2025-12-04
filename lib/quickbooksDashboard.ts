import { query } from '@/lib/db';

export type QuickBooksDashboardMetrics = {
  dailyRevenue: number;
  weeklyRevenue: number;
  monthlyRevenue: number;
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

  const [
    dailyReceiptRevenue,
    dailyPaymentRevenue,
    weeklyReceiptRevenue,
    weeklyPaymentRevenue,
    monthlyReceiptRevenue,
    monthlyPaymentRevenue,
    paymentIssues,
    unmatchedPatients,
    totalPatientsOnRecurring,
  ] = await Promise.all([
    // Daily: Sales receipts (recurring subscriptions)
    query<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM quickbooks_sales_receipts
        WHERE receipt_date = $1
          AND amount > 0
          AND status IS DISTINCT FROM 'voided'`,
      [startOfToday],
    ),
    // Daily: Payment transactions (one-time payments)
    query<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM quickbooks_payment_transactions
        WHERE payment_date = $1
          AND amount > 0`,
      [startOfToday],
    ),
    // Weekly: Sales receipts
    query<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM quickbooks_sales_receipts
        WHERE receipt_date >= $1
          AND receipt_date < $2
          AND amount > 0
          AND status IS DISTINCT FROM 'voided'`,
      [startOfWeek, endOfWeek],
    ),
    // Weekly: Payment transactions
    query<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM quickbooks_payment_transactions
        WHERE payment_date >= $1
          AND payment_date < $2
          AND amount > 0`,
      [startOfWeek, endOfWeek],
    ),
    // Monthly: Sales receipts
    query<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM quickbooks_sales_receipts
        WHERE receipt_date >= $1
          AND receipt_date < $2
          AND amount > 0
          AND status IS DISTINCT FROM 'voided'`,
      [startOfMonth, startOfNextMonth],
    ),
    // Monthly: Payment transactions
    query<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM quickbooks_payment_transactions
        WHERE payment_date >= $1
          AND payment_date < $2
          AND amount > 0`,
      [startOfMonth, startOfNextMonth],
    ),
    query<{ count: number }>(
      `SELECT COUNT(*) AS count
         FROM payment_issues pi
         JOIN patients p ON p.patient_id = pi.patient_id
        WHERE pi.resolved_at IS NULL
          AND ${QUICKBOOKS_METHOD_FILTER}`,
    ),
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
    query<{ count: number }>(
      `SELECT COUNT(DISTINCT p.patient_id) AS count
         FROM patients p
         JOIN patient_qb_mapping m
           ON m.patient_id = p.patient_id
          AND m.is_active = TRUE
        WHERE ${QUICKBOOKS_METHOD_FILTER}`,
    ),
  ]);

  const parseTotal = (rows: { total?: number }[]) =>
    parseFloat(rows[0]?.total?.toString() || '0');

  const parseCount = (rows: { count?: number }[]) =>
    parseInt(rows[0]?.count?.toString() || '0', 10);

  return {
    dailyRevenue: parseTotal(dailyReceiptRevenue) + parseTotal(dailyPaymentRevenue),
    weeklyRevenue: parseTotal(weeklyReceiptRevenue) + parseTotal(weeklyPaymentRevenue),
    monthlyRevenue: parseTotal(monthlyReceiptRevenue) + parseTotal(monthlyPaymentRevenue),
    paymentIssues: parseCount(paymentIssues),
    unmatchedPatients: parseCount(unmatchedPatients),
    totalPatientsOnRecurring: parseCount(totalPatientsOnRecurring),
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



