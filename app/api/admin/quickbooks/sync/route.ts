import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { requireApiUser } from '@/lib/auth';
import { createQuickBooksClient } from '@/lib/quickbooks';
import { query } from '@/lib/db';

const DECLINED_STATUSES = new Set(['declined', 'error', 'failed', 'rejected', 'unknown']);

// Helper to check if request is from internal cron job
async function isInternalRequest(): Promise<boolean> {
  const headersList = headers();
  const internalAuth = headersList.get('x-internal-auth');
  return internalAuth === process.env.INTERNAL_AUTH_SECRET;
}

export async function POST(req: NextRequest) {
  try {
    // Allow internal cron requests to bypass auth
    let user;
    if (await isInternalRequest()) {
      // Get the first admin user from database for cron jobs
      const adminUsers = await query<{ user_id: string; email: string; role: string; display_name: string | null; created_at: string; updated_at: string; is_active: boolean; is_provider: boolean; can_sign: boolean }>(
        `SELECT user_id, email, role, display_name, created_at, updated_at, is_active, is_provider, can_sign 
         FROM users 
         WHERE role = 'admin' AND is_active = TRUE 
         LIMIT 1`
      );
      if (adminUsers.length > 0) {
        user = adminUsers[0];
      } else {
        // Fallback: use requireApiUser if no admin found
        user = await requireApiUser(req, 'admin');
      }
    } else {
      user = await requireApiUser(req, 'admin');
    }

    // Create QuickBooks client
    const qbClient = await createQuickBooksClient();
    if (!qbClient) {
      return NextResponse.json(
        { error: 'QuickBooks not connected. Please connect first.' },
        { status: 400 }
      );
    }

    // Start sync log
    const syncLog = await query<{ sync_id: string }>(`
      INSERT INTO payment_sync_log (sync_type, sync_status, created_by)
      VALUES ('quickbooks', 'running', $1)
      RETURNING sync_id
    `, [user.user_id]);

    const syncId = syncLog[0].sync_id;

    try {
      let totalProcessed = 0;
      let totalUpdated = 0;
      let totalFailed = 0;

      // Sync customers and payments
      const customers = await qbClient.getCustomers();

      for (const customer of customers) {
        try {
          // Check if this customer is mapped to a patient
          const mappings = await query<{ patient_id: string }>(`
            SELECT patient_id FROM patient_qb_mapping
            WHERE qb_customer_id = $1 AND is_active = TRUE
          `, [customer.Id]);

          if (mappings.length === 0) {
            continue; // Skip unmapped customers
          }

          const patientId = mappings[0].patient_id;

          // Get invoices for this customer
          const invoices = await qbClient.getInvoicesForCustomer(customer.Id);

          for (const invoice of invoices) {
            totalProcessed++;

            // Check if we already have this invoice
            const existing = await query<{ qb_payment_id: string }>(`
              SELECT qb_payment_id FROM quickbooks_payments
              WHERE qb_invoice_id = $1
            `, [invoice.Id]);

            const paymentData = {
              qb_invoice_id: invoice.Id,
              qb_customer_id: customer.Id,
              patient_id: patientId,
              invoice_number: invoice.DocNumber,
              invoice_date: invoice.TxnDate ? new Date(invoice.TxnDate) : null,
              due_date: invoice.DueDate ? new Date(invoice.DueDate) : null,
              amount_due: invoice.TotalAmt,
              amount_paid: invoice.TotalAmt - invoice.Balance,
              balance: invoice.Balance,
              payment_status: qbClient.getPaymentStatus(invoice),
              days_overdue: qbClient.calculateDaysOverdue(invoice),
              qb_sync_date: new Date()
            };

            if (existing.length === 0) {
              // Insert new payment record
              await query(`
                INSERT INTO quickbooks_payments (
                  qb_invoice_id, qb_customer_id, patient_id, invoice_number,
                  invoice_date, due_date, amount_due, amount_paid, balance,
                  payment_status, days_overdue, qb_sync_date
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
              `, [
                paymentData.qb_invoice_id,
                paymentData.qb_customer_id,
                paymentData.patient_id,
                paymentData.invoice_number,
                paymentData.invoice_date,
                paymentData.due_date,
                paymentData.amount_due,
                paymentData.amount_paid,
                paymentData.balance,
                paymentData.payment_status,
                paymentData.days_overdue,
                paymentData.qb_sync_date
              ]);
            } else {
              // Update existing record
              await query(`
                UPDATE quickbooks_payments SET
                  amount_paid = $1, balance = $2, payment_status = $3,
                  days_overdue = $4, qb_sync_date = $5, updated_at = NOW()
                WHERE qb_payment_id = $6
              `, [
                paymentData.amount_paid,
                paymentData.balance,
                paymentData.payment_status,
                paymentData.days_overdue,
                paymentData.qb_sync_date,
                existing[0].qb_payment_id
              ]);
              totalUpdated++;
            }

            // Check for payment issues - create for ANY invoice with outstanding balance
            // Not just "overdue" status, but any balance > 0
            if (paymentData.balance > 0) {
              // Check if issue already exists
              const existingIssue = await query<{ issue_id: string }>(`
                SELECT issue_id FROM payment_issues
                WHERE patient_id = $1 AND qb_invoice_id = $2 AND resolved_at IS NULL
              `, [patientId, invoice.Id]);

              if (existingIssue.length === 0) {
                // Get current patient status
                const patientStatus = await query<{ status_key: string }>(`
                  SELECT status_key FROM patients WHERE patient_id = $1
                `, [patientId]);

                // Determine severity based on balance and days overdue
                const daysOverdue = paymentData.days_overdue || 0;
                const severity = daysOverdue >= 60 || paymentData.balance >= 500 
                  ? 'critical' 
                  : daysOverdue >= 30 || paymentData.balance >= 200
                    ? 'warning'
                    : 'info';

                // Create payment issue for any outstanding balance
                await query(`
                  INSERT INTO payment_issues (
                    patient_id, issue_type, issue_severity, amount_owed,
                    days_overdue, qb_invoice_id, previous_status_key
                  ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [
                  patientId,
                  paymentData.payment_status === 'overdue' ? 'overdue_invoice' : 'outstanding_balance',
                  severity,
                  paymentData.balance,
                  daysOverdue,
                  invoice.Id,
                  patientStatus[0]?.status_key || 'active'
                ]);

                // Update patient status to 'Hold - Payment Research' if overdue or high balance
                if (daysOverdue >= 30 || paymentData.balance >= 200) {
                  await query(`
                    UPDATE patients SET
                      status_key = 'hold_payment_research',
                      updated_at = NOW()
                    WHERE patient_id = $1
                      AND status_key != 'hold_payment_research'
                  `, [patientId]);
                }
              }
            }
          }

          // Sales receipts (recurring subscriptions)
          const salesReceipts = await qbClient.getSalesReceiptsForCustomer(customer.Id, 365);
          for (const receipt of salesReceipts) {
            try {
              const receiptDate = receipt.TxnDate ? new Date(receipt.TxnDate) : null;
              const statusRaw = receipt.CreditCardPayment?.CreditChargeResponse?.Status ?? null;
              const status = statusRaw ? statusRaw.toLowerCase() : null;
              await query(
                `INSERT INTO quickbooks_sales_receipts (
                   qb_sales_receipt_id, qb_customer_id, patient_id, receipt_number,
                   receipt_date, amount, status, payment_method, note, recurring_txn_id, qb_sync_date, updated_at
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
                 ON CONFLICT (qb_sales_receipt_id) DO UPDATE SET
                   amount = EXCLUDED.amount,
                   status = EXCLUDED.status,
                   payment_method = EXCLUDED.payment_method,
                   note = EXCLUDED.note,
                   receipt_date = EXCLUDED.receipt_date,
                   recurring_txn_id = EXCLUDED.recurring_txn_id,
                   qb_sync_date = NOW(),
                   updated_at = NOW()`,
                [
                  receipt.Id,
                  customer.Id,
                  patientId,
                  receipt.DocNumber ?? null,
                  receiptDate,
                  receipt.TotalAmt ?? 0,
                  statusRaw ?? null,
                  receipt.PaymentMethodRef?.name ?? receipt.PaymentMethodRef?.value ?? null,
                  receipt.PrivateNote ?? null,
                  receipt.RecurringInfo?.RecurringTxnId ?? null
                ]
              );

              // Handle declined or unknown payment statuses
              if (status && (DECLINED_STATUSES.has(status) || status.toLowerCase() === 'unknown')) {
                const existingIssue = await query<{ issue_id: string }>(
                  `SELECT issue_id FROM payment_issues
                   WHERE patient_id = $1 AND qb_sales_receipt_id = $2 AND resolved_at IS NULL`,
                  [patientId, receipt.Id]
                );
                if (existingIssue.length === 0) {
                  const patientStatus = await query<{ status_key: string }>(
                    `SELECT status_key FROM patients WHERE patient_id = $1`,
                    [patientId]
                  );
                  await query(
                    `INSERT INTO payment_issues (
                       patient_id, issue_type, issue_severity, amount_owed,
                       days_overdue, qb_sales_receipt_id, previous_status_key, auto_updated
                     ) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)`,
                    [
                      patientId,
                      'payment_declined',
                      'warning',
                      Number(receipt.TotalAmt ?? 0),
                      0,
                      receipt.Id,
                      patientStatus[0]?.status_key || 'active'
                    ]
                  );
                  await query(
                    `UPDATE patients
                       SET status_key = 'hold_payment_research',
                           updated_at = NOW()
                     WHERE patient_id = $1`,
                    [patientId]
                  );
                }
              }
            } catch (error) {
              console.error(`Error processing sales receipt ${receipt.Id}:`, error);
              totalFailed++;
            }
          }

          // Payments (non-recurring or applied to invoices)
          const payments = await qbClient.getPaymentsForCustomer(customer.Id);
          for (const payment of payments) {
            try {
              await query(
                `INSERT INTO quickbooks_payment_transactions (
                   qb_payment_id, qb_customer_id, patient_id, payment_number,
                   payment_date, amount, deposit_account, payment_method, qb_sync_date, updated_at
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
                 ON CONFLICT (qb_payment_id) DO UPDATE SET
                   amount = EXCLUDED.amount,
                   payment_date = EXCLUDED.payment_date,
                   deposit_account = EXCLUDED.deposit_account,
                   payment_method = EXCLUDED.payment_method,
                   qb_sync_date = NOW(),
                   updated_at = NOW()`,
                [
                  payment.Id,
                  customer.Id,
                  patientId,
                  payment.DocNumber ?? null,
                  payment.TxnDate ? new Date(payment.TxnDate) : null,
                  payment.TotalAmt ?? 0,
                  payment.DepositToAccountRef?.value ?? null,
                  payment.PaymentMethodRef?.name ?? payment.PaymentMethodRef?.value ?? null
                ]
              );
            } catch (error) {
              console.error(`Error processing payment ${payment.Id}:`, error);
              totalFailed++;
            }
          }
        } catch (error) {
          console.error(`Error processing customer ${customer.Id}:`, error);
          totalFailed++;
        }
      }

      // Update sync log as completed
      await query(`
        UPDATE payment_sync_log SET
          sync_status = 'completed',
          records_processed = $1,
          records_updated = $2,
          records_failed = $3,
          completed_at = NOW()
        WHERE sync_id = $4
      `, [totalProcessed, totalUpdated, totalFailed, syncId]);

      return NextResponse.json({
        success: true,
        message: `Sync completed. Processed: ${totalProcessed}, Updated: ${totalUpdated}, Failed: ${totalFailed}`
      });
    } catch (error) {
      // Update sync log as failed
      await query(`
        UPDATE payment_sync_log SET
          sync_status = 'failed',
          error_message = $1,
          completed_at = NOW()
        WHERE sync_id = $2
      `, [error instanceof Error ? error.message : 'Unknown error', syncId]);

      throw error;
    }
  } catch (error) {
    console.error('Error syncing QuickBooks data:', error);
    return NextResponse.json(
      { error: 'Failed to sync QuickBooks data' },
      { status: 500 }
    );
  }
}
