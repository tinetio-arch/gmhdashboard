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

type ClinicSyncMembershipRow = {
  clinicsync_patient_id: string;
  membership_plan: string | null;
  membership_status: string | null;
  membership_tier: string | null;
  pass_id: number | null;
  balance_owing: string | number | null;
  amount_due: string | number | null;
  last_payment_at: string | null;
  next_payment_due: string | null;
  service_start_date: string | null;
  contract_end_date: string | null;
  is_active: boolean | null;
  updated_at: string | null;
};

type ClinicSyncMappingRow = {
  clinicsync_patient_id: string;
  match_method: string | null;
  match_confidence: string | number | null;
  updated_at: string | null;
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
  clinicsync: {
    mapping: {
      clinicsyncId: string;
      matchMethod: string | null;
      matchConfidence: number | null;
      updatedAt: string | null;
    } | null;
    memberships: Array<{
      clinicsyncId: string;
      plan: string | null;
      status: string | null;
      tier: string | null;
      passId: number | null;
      balanceOwing: number;
      amountDue: number;
      lastPaymentAt: string | null;
      nextPaymentDue: string | null;
      serviceStart: string | null;
      contractEnd: string | null;
      isActive: boolean;
      updatedAt: string | null;
    }>;
    stats: {
      activeMemberships: number;
      totalBalance: number;
      nextPaymentDue: string | null;
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
    clinicMembershipRows,
    clinicMappingRows,
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
        query<ClinicSyncMembershipRow>(
          `SELECT clinicsync_patient_id,
                  membership_plan,
                  membership_status,
                  membership_tier,
                  pass_id,
                  balance_owing,
                  amount_due,
                  last_payment_at::text,
                  next_payment_due::text,
                  service_start_date::text,
                  contract_end_date::text,
                  is_active,
                  updated_at::text
             FROM clinicsync_memberships
            WHERE patient_id = $1
               -- Include recently expired memberships (within last 90 days)
               AND (is_active = TRUE 
                    OR contract_end_date >= CURRENT_DATE - INTERVAL '90 days'
                    OR updated_at >= CURRENT_DATE - INTERVAL '90 days')
            ORDER BY is_active DESC, 
                     COALESCE(contract_end_date, CURRENT_DATE) DESC,
                     updated_at DESC
            LIMIT 25`,
          [patientId]
        ),
    query<ClinicSyncMappingRow>(
      `SELECT clinicsync_patient_id,
              match_method,
              match_confidence,
              updated_at
         FROM patient_clinicsync_mapping
        WHERE patient_id = $1
        ORDER BY updated_at DESC
        LIMIT 1`,
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

  const clinicMemberships = clinicMembershipRows.map((row) => ({
    clinicsyncId: row.clinicsync_patient_id,
    plan: row.membership_plan,
    status: row.membership_status,
    tier: row.membership_tier,
    passId: row.pass_id,
    balanceOwing: toNumber(row.balance_owing),
    amountDue: toNumber(row.amount_due),
    lastPaymentAt: row.last_payment_at,
    nextPaymentDue: row.next_payment_due,
    serviceStart: row.service_start_date,
    contractEnd: row.contract_end_date,
    isActive: Boolean(row.is_active),
    updatedAt: row.updated_at
  }));

  const clinicStats = clinicMemberships.reduce(
    (acc, membership) => {
      if (membership.isActive) {
        acc.activeMemberships += 1;
      }
      acc.totalBalance += membership.balanceOwing;
      if (!acc.nextPaymentDue || (membership.nextPaymentDue && membership.nextPaymentDue < acc.nextPaymentDue)) {
        acc.nextPaymentDue = membership.nextPaymentDue;
      }
      return acc;
    },
    { activeMemberships: 0, totalBalance: 0, nextPaymentDue: null as string | null }
  );

  const clinicMapping = clinicMappingRows[0]
    ? {
        clinicsyncId: clinicMappingRows[0].clinicsync_patient_id,
        matchMethod: clinicMappingRows[0].match_method,
        matchConfidence:
          clinicMappingRows[0].match_confidence !== null
            ? Number(clinicMappingRows[0].match_confidence)
            : null,
        updatedAt: clinicMappingRows[0].updated_at
      }
    : null;

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
    clinicsync: {
      mapping: clinicMapping,
      memberships: clinicMemberships,
      stats: clinicStats
    },
    paymentIssues
  };
}

