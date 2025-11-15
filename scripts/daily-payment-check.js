#!/usr/bin/env node

/**
 * Daily Payment Check Script
 *
 * This script runs daily to:
 * 1. Check QuickBooks payment statuses for patients with recurring payments
 * 2. Update patient statuses based on payment rules
 * 3. Create payment issues for problems requiring attention
 */

const { createQuickBooksClient } = require('../lib/quickbooks');
const { query } = require('../lib/db');

async function dailyPaymentCheck() {
  console.log('[Daily Payment Check] Starting payment evaluation...');

  try {
    // Create QuickBooks client
    const qbClient = await createQuickBooksClient();
    if (!qbClient) {
      console.log('[Daily Payment Check] QuickBooks not connected, skipping...');
      return;
    }

    // Start sync log
    const syncLog = await query(`
      INSERT INTO payment_sync_log (sync_type, sync_status)
      VALUES ('daily_payment_check', 'running')
      RETURNING sync_id
    `);

    const syncId = syncLog[0].sync_id;
    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalIssues = 0;

    try {
      // Get all patients with QuickBooks payment method and active QBO mappings
      const patients = await query(`
        SELECT
          p.patient_id,
          p.full_name,
          p.status_key,
          pqm.qb_customer_id,
          pqm.qb_customer_email
        FROM patients p
        JOIN patient_qb_mapping pqm ON pqm.patient_id = p.patient_id AND pqm.is_active = TRUE
        WHERE p.payment_method_key = 'quickbooks'
        AND p.status_key NOT IN ('inactive', 'discharged')
      `);

      console.log(`[Daily Payment Check] Found ${patients.length} patients with QuickBooks recurring payments`);

      for (const patient of patients) {
        try {
          totalProcessed++;

          // Get open invoices for this customer
          const invoices = await qbClient.getInvoicesForCustomer(patient.qb_customer_id);

          // Filter to open invoices only
          const openInvoices = invoices.filter(inv => inv.Balance > 0);

          if (openInvoices.length === 0) {
            continue; // No open invoices, skip
          }

          // Check for overdue invoices
          const overdueInvoices = openInvoices.filter(inv => {
            const status = qbClient.getPaymentStatus(inv);
            return status === 'overdue';
          });

          if (overdueInvoices.length > 0) {
            // Check payment rules
            const rules = await query(`
              SELECT * FROM payment_rules
              WHERE is_active = TRUE
              ORDER BY min_days_overdue DESC
            `);

            for (const rule of rules) {
              const qualifyingInvoices = overdueInvoices.filter(inv => {
                const daysOverdue = qbClient.calculateDaysOverdue(inv);
                const amountOwed = inv.Balance;

                return daysOverdue >= rule.min_days_overdue &&
                       amountOwed >= rule.min_amount_threshold;
              });

              if (qualifyingInvoices.length > 0) {
                // Check if issue already exists
                const existingIssue = await query(`
                  SELECT issue_id FROM payment_issues
                  WHERE patient_id = $1 AND resolved_at IS NULL
                  AND issue_type = 'overdue_invoice'
                `, [patient.patient_id]);

                if (existingIssue.length === 0) {
                  // Create payment issue
                  const worstInvoice = qualifyingInvoices.reduce((worst, current) => {
                    const currentDays = qbClient.calculateDaysOverdue(current);
                    const worstDays = qbClient.calculateDaysOverdue(worst);
                    return currentDays > worstDays ? current : worst;
                  });

                  const daysOverdue = qbClient.calculateDaysOverdue(worstInvoice);

                  await query(`
                    INSERT INTO payment_issues (
                      patient_id, issue_type, issue_severity, amount_owed,
                      days_overdue, qb_invoice_id, previous_status_key, auto_updated
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                  `, [
                    patient.patient_id,
                    'overdue_invoice',
                    daysOverdue >= 60 ? 'critical' : 'warning',
                    worstInvoice.Balance,
                    daysOverdue,
                    worstInvoice.Id,
                    patient.status_key,
                    true
                  ]);

                  totalIssues++;

                  // Update patient status if rule specifies
                  if (rule.auto_update_status && rule.target_status_key) {
                    await query(`
                      UPDATE patients SET
                        status_key = $1,
                        updated_at = NOW()
                      WHERE patient_id = $2
                    `, [rule.target_status_key, patient.patient_id]);

                    totalUpdated++;
                    console.log(`[Daily Payment Check] Updated patient ${patient.full_name} status to ${rule.target_status_key}`);
                  }
                }
              }
            }
          }
        } catch (error) {
          console.error(`[Daily Payment Check] Error processing patient ${patient.patient_id}:`, error);
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
      `, [totalProcessed, totalUpdated, 0, syncId]);

      console.log(`[Daily Payment Check] Completed. Processed: ${totalProcessed}, Updated: ${totalUpdated}, Issues: ${totalIssues}`);

    } catch (error) {
      // Update sync log as failed
      await query(`
        UPDATE payment_sync_log SET
          sync_status = 'failed',
          error_message = $1,
          completed_at = NOW()
        WHERE sync_id = $2
      `, [error.message, syncId]);

      throw error;
    }

  } catch (error) {
    console.error('[Daily Payment Check] Fatal error:', error);
    process.exit(1);
  }
}

// Run the check
dailyPaymentCheck().then(() => {
  console.log('[Daily Payment Check] Finished successfully');
  process.exit(0);
}).catch((error) => {
  console.error('[Daily Payment Check] Failed:', error);
  process.exit(1);
});
