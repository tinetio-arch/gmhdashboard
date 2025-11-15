/**
 * Payment Tracking Service
 * Handles syncing payment data from QuickBooks, identifying payment issues,
 * and automatically updating patient eligibility status
 */

import { query, getPool } from './db';
import { createQuickBooksClient, type QuickBooksInvoice, type QuickBooksCustomer } from './quickbooks';
import { createGHLClient } from './ghl';

export type PaymentSyncResult = {
  success: boolean;
  recordsProcessed: number;
  recordsUpdated: number;
  recordsFailed: number;
  patientsMarkedIneligible: number;
  errors: string[];
};

export type PaymentIssue = {
  patientId: string;
  patientName: string;
  issueType: 'overdue_invoice' | 'unpaid_balance' | 'failed_payment' | 'payment_declined';
  severity: 'warning' | 'critical';
  amountOwed: number;
  daysOverdue: number;
  invoiceId?: string;
};

/**
 * Sync QuickBooks recurring transactions and update patient membership data
 */
export async function syncQuickBooksRecurringTransactions(): Promise<PaymentSyncResult> {
  const qbClient = await createQuickBooksClient();
  if (!qbClient) {
    throw new Error('QuickBooks client not configured. Please complete OAuth flow at /api/auth/quickbooks');
  }

  const result: PaymentSyncResult = {
    success: true,
    recordsProcessed: 0,
    recordsUpdated: 0,
    recordsFailed: 0,
    patientsMarkedIneligible: 0,
    errors: [],
  };

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get all active recurring transactions
    const recurringTransactions = await qbClient.getActiveRecurringTransactions();
    result.recordsProcessed = recurringTransactions.length;

    for (const recurring of recurringTransactions) {
      try {
        if (!recurring.CustomerRef?.value) continue;

        const customerId = recurring.CustomerRef.value;
        const nextChargeDate = qbClient.calculateNextChargeDate(recurring);

        // Find patient mapping
        const mappingResult = await client.query(
          `SELECT patient_id FROM patient_qb_mapping 
           WHERE qb_customer_id = $1 AND is_active = TRUE`,
          [customerId]
        );

        if (mappingResult.rows.length === 0) {
          continue;
        }

        const patientId = mappingResult.rows[0].patient_id;

        // Update or insert membership record
        await client.query(
          `INSERT INTO memberships (
            patient_id, program_name, status, fee_amount,
            next_charge_date, balance_owed
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (patient_id) DO UPDATE SET
            program_name = EXCLUDED.program_name,
            status = CASE 
              WHEN EXCLUDED.next_charge_date < NOW() THEN 'overdue'
              WHEN EXCLUDED.next_charge_date IS NULL THEN 'inactive'
              ELSE 'active'
            END,
            fee_amount = EXCLUDED.fee_amount,
            next_charge_date = EXCLUDED.next_charge_date,
            updated_at = NOW()`,
          [
            patientId,
            recurring.Name,
            recurring.Active ? 'active' : 'inactive',
            recurring.TotalAmt || 0,
            nextChargeDate?.toISOString().split('T')[0] || null,
            0, // Balance will be updated from invoices
          ]
        );

        result.recordsUpdated++;
      } catch (error) {
        result.recordsFailed++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Recurring ${recurring.Id}: ${errorMsg}`);
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    client.release();
  }

  return result;
}

/**
 * Sync QuickBooks invoices and customer data
 */
export async function syncQuickBooksPayments(): Promise<PaymentSyncResult> {
  const qbClient = await createQuickBooksClient();
  if (!qbClient) {
    throw new Error('QuickBooks client not configured. Please complete OAuth flow at /api/auth/quickbooks');
  }

  const result: PaymentSyncResult = {
    success: true,
    recordsProcessed: 0,
    recordsUpdated: 0,
    recordsFailed: 0,
    patientsMarkedIneligible: 0,
    errors: [],
  };

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Create sync log entry
    const syncLogResult = await client.query(
      `INSERT INTO payment_sync_log (sync_type, sync_status, started_at)
       VALUES ('quickbooks', 'running', NOW())
       RETURNING sync_id`
    );
    const syncId = syncLogResult.rows[0].sync_id;

    try {
      // Get all open invoices from QuickBooks
      const invoices = await qbClient.getOpenInvoices();
      result.recordsProcessed = invoices.length;

      // Process each invoice
      for (const invoice of invoices) {
        try {
          const customerId = invoice.CustomerRef.value;
          const balance = invoice.Balance || 0;
          const totalAmt = invoice.TotalAmt || 0;
          const daysOverdue = qbClient.calculateDaysOverdue(invoice);
          const paymentStatus = qbClient.getPaymentStatus(invoice);

          // Find patient mapping
          const mappingResult = await client.query(
            `SELECT patient_id FROM patient_qb_mapping 
             WHERE qb_customer_id = $1 AND is_active = TRUE`,
            [customerId]
          );

          if (mappingResult.rows.length === 0) {
            // No patient mapping found - skip for now
            continue;
          }

          const patientId = mappingResult.rows[0].patient_id;

          // Upsert payment record
          await client.query(
            `INSERT INTO quickbooks_payments (
              qb_invoice_id, qb_customer_id, patient_id, invoice_number,
              invoice_date, due_date, amount_due, amount_paid, balance,
              payment_status, days_overdue, qb_sync_date
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
            ON CONFLICT (qb_invoice_id) DO UPDATE SET
              balance = EXCLUDED.balance,
              payment_status = EXCLUDED.payment_status,
              days_overdue = EXCLUDED.days_overdue,
              last_payment_date = CASE 
                WHEN EXCLUDED.balance < quickbooks_payments.balance 
                THEN NOW()::DATE 
                ELSE quickbooks_payments.last_payment_date 
              END,
              updated_at = NOW()`,
            [
              invoice.Id,
              customerId,
              patientId,
              invoice.DocNumber || null,
              invoice.TxnDate || null,
              invoice.DueDate || null,
              totalAmt,
              totalAmt - balance,
              balance,
              paymentStatus,
              daysOverdue,
            ]
          );

          result.recordsUpdated++;
        } catch (error) {
          result.recordsFailed++;
          const errorMsg = error instanceof Error ? error.message : String(error);
          result.errors.push(`Invoice ${invoice.Id}: ${errorMsg}`);
        }
      }

      // Update sync log
      await client.query(
        `UPDATE payment_sync_log 
         SET sync_status = 'completed',
             records_processed = $1,
             records_updated = $2,
             records_failed = $3,
             completed_at = NOW()
         WHERE sync_id = $4`,
        [result.recordsProcessed, result.recordsUpdated, result.recordsFailed, syncId]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      
      // Update sync log with error
      await client.query(
        `UPDATE payment_sync_log 
         SET sync_status = 'failed',
             error_message = $1,
             completed_at = NOW()
         WHERE sync_id = $2`,
        [error instanceof Error ? error.message : String(error), syncId]
      );

      result.success = false;
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  } finally {
    client.release();
  }

  return result;
}

/**
 * Identify patients with payment issues and update their status
 */
export async function updatePatientStatusFromPayments(): Promise<PaymentSyncResult> {
  const result: PaymentSyncResult = {
    success: true,
    recordsProcessed: 0,
    recordsUpdated: 0,
    recordsFailed: 0,
    patientsMarkedIneligible: 0,
    errors: [],
  };

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get active payment rule
    const ruleResult = await client.query(
      `SELECT * FROM payment_rules WHERE is_active = TRUE ORDER BY created_at DESC LIMIT 1`
    );

    if (ruleResult.rows.length === 0) {
      throw new Error('No active payment rule found');
    }

    const rule = ruleResult.rows[0];
    const minDaysOverdue = rule.min_days_overdue || 30;
    const minAmountThreshold = parseFloat(rule.min_amount_threshold || '0');
    const targetStatusKey = rule.target_status_key || 'hold_payment_research';

    // Find patients with overdue invoices
    const overduePatients = await client.query(
      `SELECT DISTINCT
         p.patient_id,
         p.full_name,
         p.status_key AS current_status,
         COALESCE(SUM(qbp.balance), 0) AS total_balance,
         MAX(qbp.days_overdue) AS max_days_overdue,
         COUNT(qbp.qb_payment_id) AS overdue_count
       FROM patients p
       INNER JOIN patient_qb_mapping pqm ON pqm.patient_id = p.patient_id AND pqm.is_active = TRUE
       INNER JOIN quickbooks_payments qbp ON qbp.qb_customer_id = pqm.qb_customer_id
       WHERE qbp.payment_status = 'overdue'
         AND qbp.days_overdue >= $1
         AND qbp.balance >= $2
       GROUP BY p.patient_id, p.full_name, p.status_key
       HAVING COALESCE(SUM(qbp.balance), 0) >= $2`,
      [minDaysOverdue, minAmountThreshold]
    );

    result.recordsProcessed = overduePatients.rows.length;

    for (const patient of overduePatients.rows) {
      try {
        const patientId = patient.patient_id;
        const currentStatus = patient.current_status;
        const totalBalance = parseFloat(patient.total_balance || '0');
        const maxDaysOverdue = parseInt(patient.max_days_overdue || '0');

        // Only update if not already in a hold status
        if (currentStatus && currentStatus.startsWith('hold_')) {
          continue;
        }

        // Determine issue severity
        const severity = maxDaysOverdue >= 60 || totalBalance >= 500 ? 'critical' : 'warning';

        // Create payment issue record
        await client.query(
          `INSERT INTO payment_issues (
            patient_id, issue_type, issue_severity, amount_owed,
            days_overdue, previous_status_key, status_changed_to, auto_updated
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
          ON CONFLICT DO NOTHING`,
          [
            patientId,
            'overdue_invoice',
            severity,
            totalBalance,
            maxDaysOverdue,
            currentStatus,
            targetStatusKey,
          ]
        );

        // Update patient status
        await client.query(
          `UPDATE patients 
           SET status_key = $1,
               alert_status = (SELECT display_name FROM patient_status_lookup WHERE status_key = $1),
               membership_owes = $2
           WHERE patient_id = $3`,
          [targetStatusKey, totalBalance, patientId]
        );

        result.recordsUpdated++;
        result.patientsMarkedIneligible++;
      } catch (error) {
        result.recordsFailed++;
        result.errors.push(
          `Patient ${patient.patient_id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    client.release();
  }

  return result;
}

/**
 * Sync patient data to Go-High-Level
 */
export async function syncPatientsToGHL(patientIds?: string[]): Promise<PaymentSyncResult> {
  const ghlClient = createGHLClient();
  if (!ghlClient) {
    throw new Error('GHL client not configured');
  }

  const result: PaymentSyncResult = {
    success: true,
    recordsProcessed: 0,
    recordsUpdated: 0,
    recordsFailed: 0,
    patientsMarkedIneligible: 0,
    errors: [],
  };

  const pool = getPool();
  const client = await pool.connect();

  try {
    // Get patients to sync
    let patients;
    if (patientIds && patientIds.length > 0) {
      patients = await client.query(
        `SELECT p.*, pqm.ghl_contact_id, pss.total_balance_owed, pss.max_days_overdue
         FROM patients p
         LEFT JOIN patient_ghl_mapping pqm ON pqm.patient_id = p.patient_id AND pqm.is_active = TRUE
         LEFT JOIN payment_status_summary_v pss ON pss.patient_id = p.patient_id
         WHERE p.patient_id = ANY($1)`,
        [patientIds]
      );
    } else {
      // Sync all patients with QBO payment method
      patients = await client.query(
        `SELECT p.*, pqm.ghl_contact_id, pss.total_balance_owed, pss.max_days_overdue
         FROM patients p
         LEFT JOIN patient_ghl_mapping pqm ON pqm.patient_id = p.patient_id AND pqm.is_active = TRUE
         LEFT JOIN payment_status_summary_v pss ON pss.patient_id = p.patient_id
         WHERE p.payment_method_key IN ('qbo', 'quickbooks', 'jane_quickbooks')`
      );
    }

    result.recordsProcessed = patients.rows.length;

    // Get or create "Payment Issue" tag
    let paymentIssueTag;
    try {
      paymentIssueTag = await ghlClient.findOrCreateTag('Payment Issue');
    } catch (error) {
      console.warn('Could not create GHL tag:', error);
    }

    for (const patient of patients.rows) {
      try {
        let ghlContactId = patient.ghl_contact_id;

        // Find or create GHL contact
        if (!ghlContactId) {
          // Try to find by email
          if (patient.email || patient.qbo_customer_email) {
            const email = patient.email || patient.qbo_customer_email;
            const existingContact = await ghlClient.findContactByEmail(email);
            if (existingContact) {
              ghlContactId = existingContact.id;
            }
          }

          // Try to find by phone
          if (!ghlContactId && patient.phone_primary) {
            const existingContact = await ghlClient.findContactByPhone(patient.phone_primary);
            if (existingContact) {
              ghlContactId = existingContact.id;
            }
          }

          // Create new contact if not found
          if (!ghlContactId) {
            const newContact = await ghlClient.createContact({
              firstName: patient.full_name?.split(' ')[0] || '',
              lastName: patient.full_name?.split(' ').slice(1).join(' ') || '',
              email: patient.email || patient.qbo_customer_email || undefined,
              phone: patient.phone_primary || undefined,
              address1: patient.address_line1 || undefined,
              city: patient.city || undefined,
              state: patient.state || undefined,
              postalCode: patient.postal_code || undefined,
            });
            ghlContactId = newContact.id;

            // Create mapping
            await client.query(
              `INSERT INTO patient_ghl_mapping (patient_id, ghl_contact_id, match_method)
               VALUES ($1, $2, 'manual')
               ON CONFLICT (patient_id, ghl_contact_id) DO UPDATE SET is_active = TRUE`,
              [patient.patient_id, ghlContactId]
            );
          } else {
            // Create mapping for existing contact
            await client.query(
              `INSERT INTO patient_ghl_mapping (patient_id, ghl_contact_id, match_method)
               VALUES ($1, $2, 'email')
               ON CONFLICT (patient_id, ghl_contact_id) DO UPDATE SET is_active = TRUE`,
              [patient.patient_id, ghlContactId]
            );
          }
        }

        // Update contact with payment status
        const updates: any = {};

        // Update status if patient is on hold due to payment
        if (patient.status_key === 'hold_payment_research') {
          updates.status = 'Ineligible - Payment Issue';
          
          // Add payment issue tag
          if (paymentIssueTag) {
            try {
              await ghlClient.addTagsToContact(ghlContactId, [paymentIssueTag.id]);
            } catch (error) {
              console.warn(`Could not add tag to contact ${ghlContactId}:`, error);
            }
          }
        }

        // Update custom fields with payment info
        if (patient.total_balance_owed) {
          await ghlClient.updateCustomField(
            ghlContactId,
            'balance_owed',
            patient.total_balance_owed.toString()
          );
        }

        if (patient.max_days_overdue) {
          await ghlClient.updateCustomField(
            ghlContactId,
            'days_overdue',
            patient.max_days_overdue.toString()
          );
        }

        // Apply updates
        if (Object.keys(updates).length > 0) {
          await ghlClient.updateContact(ghlContactId, updates);
        }

        result.recordsUpdated++;
      } catch (error) {
        result.recordsFailed++;
        result.errors.push(
          `Patient ${patient.patient_id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    client.release();
  } catch (error) {
    client.release();
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
  }

  return result;
}

/**
 * Full payment sync workflow: QuickBooks Recurring -> QuickBooks Invoices -> Identify Issues -> Update Status -> Sync GHL
 */
export async function runFullPaymentSync(): Promise<PaymentSyncResult> {
  const results: PaymentSyncResult[] = [];

  // Step 1: Sync QuickBooks recurring transactions (memberships)
  try {
    const recurringResult = await syncQuickBooksRecurringTransactions();
    results.push(recurringResult);
  } catch (error) {
    results.push({
      success: false,
      recordsProcessed: 0,
      recordsUpdated: 0,
      recordsFailed: 0,
      patientsMarkedIneligible: 0,
      errors: [`Recurring sync: ${error instanceof Error ? error.message : String(error)}`],
    });
  }

  // Step 2: Sync QuickBooks invoices and payments
  try {
    const qbResult = await syncQuickBooksPayments();
    results.push(qbResult);
  } catch (error) {
    results.push({
      success: false,
      recordsProcessed: 0,
      recordsUpdated: 0,
      recordsFailed: 0,
      patientsMarkedIneligible: 0,
      errors: [`Invoice sync: ${error instanceof Error ? error.message : String(error)}`],
    });
  }

  // Step 2: Update patient statuses
  try {
    const statusResult = await updatePatientStatusFromPayments();
    results.push(statusResult);
  } catch (error) {
    results.push({
      success: false,
      recordsProcessed: 0,
      recordsUpdated: 0,
      recordsFailed: 0,
      patientsMarkedIneligible: 0,
      errors: [error instanceof Error ? error.message : String(error)],
    });
  }

  // Step 3: Sync to GHL
  try {
    const ghlResult = await syncPatientsToGHL();
    results.push(ghlResult);
  } catch (error) {
    results.push({
      success: false,
      recordsProcessed: 0,
      recordsUpdated: 0,
      recordsFailed: 0,
      patientsMarkedIneligible: 0,
      errors: [error instanceof Error ? error.message : String(error)],
    });
  }

  // Aggregate results
  return {
    success: results.every(r => r.success),
    recordsProcessed: results.reduce((sum, r) => sum + r.recordsProcessed, 0),
    recordsUpdated: results.reduce((sum, r) => sum + r.recordsUpdated, 0),
    recordsFailed: results.reduce((sum, r) => sum + r.recordsFailed, 0),
    patientsMarkedIneligible: results.reduce((sum, r) => sum + r.patientsMarkedIneligible, 0),
    errors: results.flatMap(r => r.errors),
  };
}

