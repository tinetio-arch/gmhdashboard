import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { createQuickBooksClient } from '@/lib/quickbooks';
import { query } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized - Admin access required' },
        { status: 403 }
      );
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
    `, [session.user.userId]);

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

            // Check for payment issues
            if (paymentData.payment_status === 'overdue' && paymentData.days_overdue >= 30) {
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

                // Create payment issue
                await query(`
                  INSERT INTO payment_issues (
                    patient_id, issue_type, issue_severity, amount_owed,
                    days_overdue, qb_invoice_id, previous_status_key
                  ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [
                  patientId,
                  'overdue_invoice',
                  paymentData.days_overdue >= 60 ? 'critical' : 'warning',
                  paymentData.balance,
                  paymentData.days_overdue,
                  invoice.Id,
                  patientStatus[0]?.status_key || 'active'
                ]);

                // Update patient status to 'Hold - Payment Research'
                await query(`
                  UPDATE patients SET
                    status_key = 'hold_payment_research',
                    updated_at = NOW()
                  WHERE patient_id = $1
                `, [patientId]);
              }
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
