import { query } from './db';

const toNumber = (value: string | number | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

type QuickBooksMappingRow = {
  qb_customer_id: string;
  qb_customer_name: string | null;
  qb_customer_email: string | null;
  match_method: string | null;
  is_active: boolean | null;
  updated_at: string | null;
};

type QuickBooksInvoiceRow = {
  qb_payment_id: string;
  qb_invoice_id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  amount_due: string | number | null;
  amount_paid: string | number | null;
  balance: string | number | null;
  payment_status: string | null;
  days_overdue: number | null;
  last_payment_date: string | null;
  qb_sync_date: string | null;
};

type HealthieInvoiceRow = {
  healthie_invoice_id: string;
  healthie_client_id: string;
  amount: string | number | null;
  status: string | null;
  due_date: string | null;
  invoice_number: string | null;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string | null;
};

type PaymentIssueRow = {
  issue_id: string;
  issue_type: string;
  issue_severity: string;
  amount_owed: string | number | null;
  days_overdue: number | null;
  qb_invoice_id: string | null;
  created_at: string;
};

type MembershipSummaryRow = {
  program_name: string | null;
  status: string | null;
  fee_amount: string | number | null;
  balance_owed: string | number | null;
  next_charge_date: string | null;
  last_charge_date: string | null;
  updated_at: string | null;
};

type SalesReceiptRow = {
  qb_sales_receipt_id: string;
  receipt_number: string | null;
  receipt_date: string | null;
  amount: string | number | null;
  status: string | null;
  payment_method: string | null;
  note: string | null;
  recurring_txn_id: string | null;
};

type PaymentTransactionRow = {
  qb_payment_id: string;
  payment_number: string | null;
  payment_date: string | null;
  amount: string | number | null;
  deposit_account: string | null;
  payment_method: string | null;
};

export type PatientFinancialData = {
  quickbooks: {
    mapping: {
      customerId: string;
      name: string | null;
      email: string | null;
      matchMethod: string | null;
      isActive: boolean;
      updatedAt: string | null;
    } | null;
    invoices: Array<{
      id: string;
      invoiceId: string;
      invoiceNumber: string | null;
      invoiceDate: string | null;
      dueDate: string | null;
      amountDue: number;
      amountPaid: number;
      balance: number;
      paymentStatus: string | null;
      daysOverdue: number;
      lastPaymentDate: string | null;
    }>;
    stats: {
      openBalance: number;
      openInvoices: number;
      lastPaymentDate: string | null;
    };
    membership: {
      programName: string | null;
      status: string | null;
      feeAmount: number;
      balanceOwed: number;
      nextChargeDate: string | null;
      lastChargeDate: string | null;
      updatedAt: string | null;
    } | null;
    salesReceipts: Array<{
      id: string;
      date: string | null;
      amount: number;
      note: string | null;
      paymentMethod: string | null;
      recurringId: string | null;
      status: string | null;
    }>;
    payments: Array<{
      id: string;
      date: string | null;
      amount: number;
      depositAccount: string | null;
    }>;
  };
  healthie: {
    invoices: Array<{
      id: string;
      amount: number;
      status: string | null;
      dueDate: string | null;
      invoiceNumber: string | null;
      sentAt: string | null;
      paidAt: string | null;
    }>;
    stats: {
      totalPaid: number;
      lastPaymentDate: string | null;
      lastPaymentAmount: number;
      invoiceCount: number;
      unpaidCount: number;
      unpaidTotal: number;
    };
  };
  paymentIssues: Array<{
    issueId: string;
    issueType: string;
    severity: string;
    amountOwed: number;
    daysOverdue: number;
    qbInvoiceId: string | null;
    createdAt: string;
  }>;
};

export async function fetchPatientFinancialData(patientId: string): Promise<PatientFinancialData> {
  const [
    qbMappingRows,
    qbInvoiceRows,
    healthieInvoiceRows,
    issueRows,
    membershipRows,
    salesReceiptRows,
    paymentTransactionRows
  ] = await Promise.all([
    query<QuickBooksMappingRow>(
      `SELECT qb_customer_id,
              qb_customer_name,
              qb_customer_email,
              match_method,
              is_active,
              updated_at
         FROM patient_qb_mapping
        WHERE patient_id = $1
        ORDER BY is_active DESC, updated_at DESC
        LIMIT 1`,
      [patientId]
    ),
    query<QuickBooksInvoiceRow>(
      `SELECT qb_payment_id,
              qb_invoice_id,
              invoice_number,
              invoice_date::text,
              due_date::text,
              amount_due,
              amount_paid,
              balance,
              payment_status,
              days_overdue,
              last_payment_date::text,
              qb_sync_date::text
         FROM quickbooks_payments
        WHERE patient_id = $1
        ORDER BY COALESCE(invoice_date, due_date, qb_sync_date) DESC NULLS LAST
        LIMIT 25`,
      [patientId]
    ),
    query<HealthieInvoiceRow>(
      `SELECT hi.healthie_invoice_id,
              hi.healthie_client_id,
              hi.amount,
              hi.status,
              hi.due_date::text,
              hi.invoice_number,
              hi.sent_at::text,
              hi.paid_at::text,
              hi.created_at::text
         FROM healthie_invoices hi
        WHERE hi.patient_id = $1
        ORDER BY COALESCE(hi.paid_at, hi.created_at) DESC NULLS LAST
        LIMIT 25`,
      [patientId]
    ),
    query<PaymentIssueRow>(
      `SELECT issue_id,
              issue_type,
              issue_severity,
              amount_owed,
              days_overdue,
              qb_invoice_id,
              created_at::text
         FROM payment_issues
        WHERE patient_id = $1
          AND resolved_at IS NULL
        ORDER BY created_at DESC`,
      [patientId]
    ),
    query<MembershipSummaryRow>(
      `SELECT program_name,
              status,
              fee_amount,
              balance_owed,
              next_charge_date::text,
              last_charge_date::text,
              updated_at::text
         FROM memberships
        WHERE patient_id = $1
        ORDER BY updated_at DESC
        LIMIT 1`,
      [patientId]
    ),
    query<SalesReceiptRow>(
      `SELECT qb_sales_receipt_id,
              receipt_number,
              receipt_date::text,
              amount,
              status,
              payment_method,
              note,
              recurring_txn_id
         FROM quickbooks_sales_receipts
        WHERE patient_id = $1
        ORDER BY receipt_date DESC NULLS LAST, updated_at DESC
        LIMIT 25`,
      [patientId]
    ),
    query<PaymentTransactionRow>(
      `SELECT qb_payment_id,
              payment_number,
              payment_date::text,
              amount,
              deposit_account,
              payment_method
         FROM quickbooks_payment_transactions
        WHERE patient_id = $1
        ORDER BY payment_date DESC NULLS LAST, updated_at DESC
        LIMIT 25`,
      [patientId]
    )
  ]);

  const qbMapping = qbMappingRows[0]
    ? {
      customerId: qbMappingRows[0].qb_customer_id,
      name: qbMappingRows[0].qb_customer_name,
      email: qbMappingRows[0].qb_customer_email,
      matchMethod: qbMappingRows[0].match_method,
      isActive: Boolean(qbMappingRows[0].is_active),
      updatedAt: qbMappingRows[0].updated_at
    }
    : null;

  const qbInvoices = qbInvoiceRows.map((row) => ({
    id: row.qb_payment_id,
    invoiceId: row.qb_invoice_id,
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    amountDue: toNumber(row.amount_due),
    amountPaid: toNumber(row.amount_paid),
    balance: toNumber(row.balance),
    paymentStatus: row.payment_status,
    daysOverdue: row.days_overdue ?? 0,
    lastPaymentDate: row.last_payment_date
  }));

  const qbStats = qbInvoices.reduce(
    (acc, invoice) => {
      if (invoice.balance > 0) {
        acc.openBalance += invoice.balance;
        acc.openInvoices += 1;
      }
      if (!acc.lastPaymentDate || (invoice.lastPaymentDate && invoice.lastPaymentDate > acc.lastPaymentDate)) {
        acc.lastPaymentDate = invoice.lastPaymentDate;
      }
      return acc;
    },
    { openBalance: 0, openInvoices: 0, lastPaymentDate: null as string | null }
  );

  const healthieInvoices = healthieInvoiceRows.map((row) => ({
    id: row.healthie_invoice_id,
    amount: toNumber(row.amount),
    status: row.status,
    dueDate: row.due_date,
    invoiceNumber: row.invoice_number,
    sentAt: row.sent_at,
    paidAt: row.paid_at,
  }));

  const healthieStats = healthieInvoices.reduce(
    (acc, inv) => {
      if (inv.status === 'paid') {
        acc.totalPaid += inv.amount;
        if (!acc.lastPaymentDate || (inv.paidAt && inv.paidAt > acc.lastPaymentDate)) {
          acc.lastPaymentDate = inv.paidAt;
          acc.lastPaymentAmount = inv.amount;
        }
      } else {
        acc.unpaidCount += 1;
        acc.unpaidTotal += inv.amount;
      }
      acc.invoiceCount += 1;
      return acc;
    },
    { totalPaid: 0, lastPaymentDate: null as string | null, lastPaymentAmount: 0, invoiceCount: 0, unpaidCount: 0, unpaidTotal: 0 }
  );

  const paymentIssues = issueRows.map((row) => ({
    issueId: row.issue_id,
    issueType: row.issue_type,
    severity: row.issue_severity,
    amountOwed: toNumber(row.amount_owed),
    daysOverdue: row.days_overdue ?? 0,
    qbInvoiceId: row.qb_invoice_id,
    createdAt: row.created_at
  }));

  const membershipSummary = membershipRows[0]
    ? {
      programName: membershipRows[0].program_name,
      status: membershipRows[0].status,
      feeAmount: toNumber(membershipRows[0].fee_amount),
      balanceOwed: toNumber(membershipRows[0].balance_owed),
      nextChargeDate: membershipRows[0].next_charge_date,
      lastChargeDate: membershipRows[0].last_charge_date,
      updatedAt: membershipRows[0].updated_at
    }
    : null;

  return {
    quickbooks: {
      mapping: qbMapping,
      invoices: qbInvoices,
      stats: qbStats,
      membership: membershipSummary,
      salesReceipts: salesReceiptRows.map((receipt) => ({
        id: receipt.qb_sales_receipt_id,
        date: receipt.receipt_date,
        amount: toNumber(receipt.amount),
        note: receipt.note,
        paymentMethod: receipt.payment_method,
        recurringId: receipt.recurring_txn_id,
        status: receipt.status
      })),
      payments: paymentTransactionRows.map((payment) => ({
        id: payment.qb_payment_id,
        date: payment.payment_date,
        amount: toNumber(payment.amount),
        depositAccount: payment.deposit_account ?? payment.payment_method ?? null
      }))
    },
    healthie: {
      invoices: healthieInvoices,
      stats: healthieStats,
    },
    paymentIssues
  };
}

