/**
 * Healthie Invoice Service
 * Handles creating and sending invoices to patients
 * When patients pay invoices, their payment methods are saved in Healthie
 */

import { createHealthieClient, type CreateInvoiceInput } from './healthie';
import { query, getPool } from './db';
import { fetchPatientById } from './patientQueries';

export type InvoiceCreationResult = {
  success: boolean;
  patientId: string;
  patientName: string;
  healthieClientId?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  amount: number;
  error?: string;
};

export type BatchInvoiceResult = {
  success: boolean;
  totalProcessed: number;
  successful: number;
  failed: number;
  results: InvoiceCreationResult[];
  errors: string[];
};

/**
 * Create and send an invoice to a patient
 * This will prompt them to add payment method when they pay
 */
export async function createInvoiceForPatient(
  patientId: string,
  amount: number,
  options?: {
    description?: string;
    dueDate?: Date;
    sendEmail?: boolean;
  }
): Promise<InvoiceCreationResult> {
  const result: InvoiceCreationResult = {
    success: false,
    patientId,
    patientName: '',
    amount,
  };

  const healthieClient = createHealthieClient();
  if (!healthieClient) {
    result.error = 'Healthie client not configured';
    return result;
  }

  try {
    // Get patient data
    const patient = await fetchPatientById(patientId);
    if (!patient) {
      result.error = 'Patient not found';
      return result;
    }

    result.patientName = patient.patient_name;

    // Get Healthie client ID
    const clientMapping = await query<{ healthie_client_id: string }>(
      `SELECT healthie_client_id 
       FROM healthie_clients 
       WHERE patient_id = $1 AND is_active = TRUE
       LIMIT 1`,
      [patientId]
    );

    if (clientMapping.length === 0) {
      result.error = 'Patient not migrated to Healthie yet';
      return result;
    }

    const healthieClientId = clientMapping[0].healthie_client_id;
    result.healthieClientId = healthieClientId;

    // Check if invoice already exists (avoid duplicates)
    const existingInvoice = await query<{ healthie_invoice_id: string }>(
      `SELECT healthie_invoice_id 
       FROM healthie_invoices 
       WHERE patient_id = $1 
         AND status IN ('sent', 'draft')
         AND amount = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [patientId, amount]
    );

    if (existingInvoice.length > 0) {
      result.error = 'Invoice already exists for this patient';
      result.invoiceId = existingInvoice[0].healthie_invoice_id;
      return result;
    }

    // Create invoice in Healthie
    const dueDate = options?.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

    const invoiceInput: CreateInvoiceInput = {
      client_id: healthieClientId,
      amount,
      description: options?.description || `Payment for services - ${patient.patient_name}`,
      due_date: dueDate.toISOString().split('T')[0],
      send_email: options?.sendEmail ?? true,
    };

    const invoice = await healthieClient.createInvoice(invoiceInput);

    result.invoiceId = invoice.id;
    result.invoiceNumber = invoice.invoice_number;
    result.success = true;

    // Store invoice in database
    await query(
      `INSERT INTO healthie_invoices (
        healthie_invoice_id, patient_id, healthie_client_id, amount,
        status, due_date, invoice_number, sent_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (healthie_invoice_id) DO UPDATE SET
        status = EXCLUDED.status,
        updated_at = NOW()`,
      [
        invoice.id,
        patientId,
        healthieClientId,
        amount,
        invoice.status || 'sent',
        invoice.due_date || null,
        invoice.invoice_number || null,
      ]
    );

    // Log migration
    await query(
      `INSERT INTO healthie_migration_log (
        migration_type, patient_id, operation, status, healthie_id, metadata
      ) VALUES ('invoice_creation', $1, 'create_invoice', 'success', $2, $3)`,
      [
        patientId,
        invoice.id,
        JSON.stringify({ amount, due_date: invoice.due_date }),
      ]
    );
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    
    // Log error
    await query(
      `INSERT INTO healthie_migration_log (
        migration_type, patient_id, operation, status, error_message
      ) VALUES ('invoice_creation', $1, 'create_invoice', 'failed', $2)`,
      [patientId, result.error]
    );
  }

  return result;
}

/**
 * Create invoices for all migrated patients based on their recurring package amounts
 */
export async function createInvoicesForAllPatients(
  options?: {
    usePackageAmount?: boolean;
    defaultAmount?: number;
    description?: string;
    dueDate?: Date;
    sendEmail?: boolean;
  }
): Promise<BatchInvoiceResult> {
  const result: BatchInvoiceResult = {
    success: true,
    totalProcessed: 0,
    successful: 0,
    failed: 0,
    results: [],
    errors: [],
  };

  try {
    // Get all migrated patients with active subscriptions
    const patients = await query<{
      patient_id: string;
      patient_name: string;
      healthie_client_id: string;
      package_amount: number;
      subscription_count: number;
    }>(
      `SELECT 
        p.patient_id,
        p.full_name AS patient_name,
        hc.healthie_client_id,
        COALESCE(SUM(hs.amount), 0) AS package_amount,
        COUNT(hs.id) AS subscription_count
       FROM patients p
       INNER JOIN healthie_clients hc ON p.patient_id = hc.patient_id AND hc.is_active = TRUE
       LEFT JOIN healthie_subscriptions hs ON hc.healthie_client_id = hs.healthie_client_id 
         AND hs.is_active = TRUE AND hs.status = 'active'
       WHERE hc.is_active = TRUE
       GROUP BY p.patient_id, p.full_name, hc.healthie_client_id
       HAVING COUNT(hs.id) > 0`
    );

    result.totalProcessed = patients.length;

    for (const patient of patients) {
      try {
        // Determine invoice amount
        let amount = options?.defaultAmount || 0;
        if (options?.usePackageAmount !== false && patient.package_amount > 0) {
          amount = patient.package_amount;
        }

        if (amount <= 0) {
          result.failed++;
          result.errors.push(`${patient.patient_name}: No amount specified`);
          continue;
        }

        // Create invoice
        const invoiceResult = await createInvoiceForPatient(
          patient.patient_id,
          amount,
          {
            description: options?.description,
            dueDate: options?.dueDate,
            sendEmail: options?.sendEmail,
          }
        );

        result.results.push(invoiceResult);

        if (invoiceResult.success) {
          result.successful++;
        } else {
          result.failed++;
          if (invoiceResult.error) {
            result.errors.push(`${patient.patient_name}: ${invoiceResult.error}`);
          }
        }
      } catch (error) {
        result.failed++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(`${patient.patient_name}: ${errorMsg}`);
        
        result.results.push({
          success: false,
          patientId: patient.patient_id,
          patientName: patient.patient_name,
          amount: 0,
          error: errorMsg,
        });
      }
    }

    result.success = result.failed === 0;
  } catch (error) {
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
  }

  return result;
}

/**
 * Check payment method status for migrated patients
 */
export async function checkPaymentMethodStatus(): Promise<Array<{
  patientId: string;
  patientName: string;
  healthieClientId: string;
  hasPaymentMethod: boolean;
  invoiceCount: number;
  paidInvoiceCount: number;
}>> {
  const healthieClient = createHealthieClient();
  if (!healthieClient) {
    throw new Error('Healthie client not configured');
  }

  const patients = await query<{
    patient_id: string;
    patient_name: string;
    healthie_client_id: string;
    invoice_count: number;
    paid_invoice_count: number;
  }>(
    `SELECT 
      p.patient_id,
      p.full_name AS patient_name,
      hc.healthie_client_id,
      COUNT(hi.id) AS invoice_count,
      COUNT(CASE WHEN hi.status = 'paid' THEN 1 END) AS paid_invoice_count
     FROM patients p
     INNER JOIN healthie_clients hc ON p.patient_id = hc.patient_id AND hc.is_active = TRUE
     LEFT JOIN healthie_invoices hi ON hc.healthie_client_id = hi.healthie_client_id
     WHERE hc.is_active = TRUE
     GROUP BY p.patient_id, p.full_name, hc.healthie_client_id`
  );

  const results = [];

  for (const patient of patients) {
    try {
      const hasPaymentMethod = await healthieClient.hasPaymentMethod(patient.healthie_client_id);
      
      results.push({
        patientId: patient.patient_id,
        patientName: patient.patient_name,
        healthieClientId: patient.healthie_client_id,
        hasPaymentMethod,
        invoiceCount: Number(patient.invoice_count),
        paidInvoiceCount: Number(patient.paid_invoice_count),
      });
    } catch (error) {
      console.error(`Error checking payment method for ${patient.patient_name}:`, error);
      results.push({
        patientId: patient.patient_id,
        patientName: patient.patient_name,
        healthieClientId: patient.healthie_client_id,
        hasPaymentMethod: false,
        invoiceCount: Number(patient.invoice_count),
        paidInvoiceCount: Number(patient.paid_invoice_count),
      });
    }
  }

  return results;
}


