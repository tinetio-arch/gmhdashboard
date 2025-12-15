/**
 * Healthie Migration Service
 * Handles migration of QuickBooks patients to Healthie EMR
 */

import { createQuickBooksClient, type QuickBooksCustomer, type QuickBooksRecurringTransaction } from './quickbooks';
import { createHealthieClient, type HealthieClient, type CreateClientInput } from './healthie';
import { query, getPool } from './db';
import { fetchPatientById } from './patientQueries';
import {
  createPackageMapping,
  getOrCreateHealthiePackage,
  type PackageMapping,
} from './healthiePackageMapper';

export type MigrationPreview = {
  patientId: string;
  patientName: string;
  email?: string;
  phone?: string;
  qbCustomerId?: string;
  qbCustomerName?: string;
  recurringTransactions: Array<{
    id: string;
    name: string;
    amount: number;
    frequency: string;
    nextChargeDate?: string;
  }>;
  existingHealthieClient?: {
    id: string;
    email?: string;
    phone?: string;
  };
  conflicts: string[];
};

export type MigrationResult = {
  success: boolean;
  patientId: string;
  patientName: string;
  healthieClientId?: string;
  subscriptionsCreated: number;
  errors: string[];
};

export type BatchMigrationResult = {
  success: boolean;
  totalProcessed: number;
  successful: number;
  failed: number;
  results: MigrationResult[];
  errors: string[];
};

/**
 * Export QuickBooks patients with recurring transactions
 */
export async function exportQuickBooksPatients(): Promise<MigrationPreview[]> {
  const qbClient = await createQuickBooksClient();
  if (!qbClient) {
    throw new Error('QuickBooks client not configured');
  }

  const healthieClient = createHealthieClient();
  if (!healthieClient) {
    throw new Error('Healthie client not configured');
  }

  // Get all QuickBooks customers
  const qbCustomers = await qbClient.getCustomers();
  
  // Get all active recurring transactions
  const recurringTransactions = await qbClient.getActiveRecurringTransactions();
  
  // Group recurring transactions by customer
  const recurringByCustomer = new Map<string, QuickBooksRecurringTransaction[]>();
  for (const recurring of recurringTransactions) {
    if (recurring.CustomerRef?.value) {
      const customerId = recurring.CustomerRef.value;
      if (!recurringByCustomer.has(customerId)) {
        recurringByCustomer.set(customerId, []);
      }
      recurringByCustomer.get(customerId)!.push(recurring);
    }
  }

  // Get patient mappings
  const patientMappings = await query<{
    patient_id: string;
    qb_customer_id: string;
  }>(
    `SELECT patient_id, qb_customer_id 
     FROM patient_qb_mapping 
     WHERE is_active = TRUE`
  );

  const patientMap = new Map<string, string>();
  for (const mapping of patientMappings) {
    patientMap.set(mapping.qb_customer_id, mapping.patient_id);
  }

  const previews: MigrationPreview[] = [];

  // Process each customer with recurring transactions
  for (const [customerId, recurrings] of recurringByCustomer.entries()) {
    const patientId = patientMap.get(customerId);
    if (!patientId) {
      // Skip customers without patient mapping
      continue;
    }

    const patient = await fetchPatientById(patientId);
    if (!patient) {
      continue;
    }

    const qbCustomer = qbCustomers.find(c => c.Id === customerId);
    const conflicts: string[] = [];

    // Check for existing Healthie client
    let existingHealthieClient;
    if (patient.email) {
      const existing = await healthieClient.findClientByEmail(patient.email);
      if (existing) {
        existingHealthieClient = {
          id: existing.id,
          email: existing.email,
          phone: existing.phone_number,
        };
        conflicts.push('Client already exists in Healthie (matched by email)');
      }
    }

    if (!existingHealthieClient && patient.phone_number) {
      const existing = await healthieClient.findClientByPhone(patient.phone_number);
      if (existing) {
        existingHealthieClient = {
          id: existing.id,
          email: existing.email,
          phone: existing.phone_number,
        };
        conflicts.push('Client already exists in Healthie (matched by phone)');
      }
    }

    const recurringData = recurrings.map(r => ({
      id: r.Id,
      name: r.Name || 'Unnamed',
      amount: r.TotalAmt || 0,
      frequency: r.ScheduleInfo?.IntervalType || 'Monthly',
      nextChargeDate: r.ScheduleInfo?.NextDueDate || undefined,
    }));

    previews.push({
      patientId,
      patientName: patient.patient_name,
      email: patient.email || undefined,
      phone: patient.phone_number || undefined,
      qbCustomerId: customerId,
      qbCustomerName: qbCustomer?.DisplayName,
      recurringTransactions: recurringData,
      existingHealthieClient,
      conflicts,
    });
  }

  return previews;
}

/**
 * Migrate a single patient to Healthie
 */
export async function migratePatientToHealthie(
  patientId: string,
  options?: {
    skipExisting?: boolean;
    createPackages?: boolean;
  }
): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: false,
    patientId,
    patientName: '',
    subscriptionsCreated: 0,
    errors: [],
  };

  const healthieClient = createHealthieClient();
  if (!healthieClient) {
    result.errors.push('Healthie client not configured');
    return result;
  }

  const qbClient = await createQuickBooksClient();
  if (!qbClient) {
    result.errors.push('QuickBooks client not configured');
    return result;
  }

  try {
    // Get patient data
    const patient = await fetchPatientById(patientId);
    if (!patient) {
      result.errors.push('Patient not found');
      return result;
    }

    result.patientName = patient.patient_name;

    // Check for existing Healthie client
    const existingMapping = await query<{ healthie_client_id: string }>(
      `SELECT healthie_client_id 
       FROM healthie_clients 
       WHERE patient_id = $1 AND is_active = TRUE
       LIMIT 1`,
      [patientId]
    );

    let healthieClientId: string;

    if (existingMapping.length > 0) {
      healthieClientId = existingMapping[0].healthie_client_id;
      
      if (options?.skipExisting) {
        result.success = true;
        result.healthieClientId = healthieClientId;
        return result;
      }
    } else {
      // Check for existing client by email/phone
      let existingClient;
      if (patient.email) {
        existingClient = await healthieClient.findClientByEmail(patient.email);
      }
      if (!existingClient && patient.phone_number) {
        existingClient = await healthieClient.findClientByPhone(patient.phone_number);
      }

      if (existingClient) {
        healthieClientId = existingClient.id;
        
        // Store mapping
        await query(
          `INSERT INTO healthie_clients (patient_id, healthie_client_id, match_method)
           VALUES ($1, $2, 'existing')
           ON CONFLICT (patient_id, healthie_client_id) DO UPDATE SET is_active = TRUE`,
          [patientId, healthieClientId]
        );
      } else {
        // Create new client
        const nameParts = patient.patient_name.split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';

        const clientInput: CreateClientInput = {
          first_name: firstName,
          last_name: lastName,
          email: patient.email || undefined,
          phone_number: patient.phone_number || undefined,
          dob: patient.date_of_birth || undefined,
          address: patient.address_line1 || undefined,
          city: patient.city || undefined,
          state: patient.state || undefined,
          zip: patient.postal_code || undefined,
        };

        const newClient = await healthieClient.createClient(clientInput);
        healthieClientId = newClient.id;

        // Store mapping
        await query(
          `INSERT INTO healthie_clients (patient_id, healthie_client_id, match_method)
           VALUES ($1, $2, 'migration')`,
          [patientId, healthieClientId]
        );

        // Log migration
        await query(
          `INSERT INTO healthie_migration_log (migration_type, patient_id, operation, status, healthie_id)
           VALUES ('client_creation', $1, 'create_client', 'success', $2)`,
          [patientId, healthieClientId]
        );
      }
    }

    result.healthieClientId = healthieClientId;

    // Get QuickBooks customer ID
    const qbMapping = await query<{ qb_customer_id: string }>(
      `SELECT qb_customer_id 
       FROM patient_qb_mapping 
       WHERE patient_id = $1 AND is_active = TRUE
       LIMIT 1`,
      [patientId]
    );

    if (qbMapping.length > 0) {
      const qbCustomerId = qbMapping[0].qb_customer_id;

      // Get recurring transactions for this customer
      const recurringTransactions = await qbClient.getRecurringTransactionsForCustomer(qbCustomerId);
      const activeRecurring = recurringTransactions.filter(r => r.Active);

      // Create packages and subscriptions
      for (const recurring of activeRecurring) {
        try {
          const packageMapping = createPackageMapping(recurring);

          // Get or create package
          const packageId = await getOrCreateHealthiePackage(packageMapping, healthieClient);

          // Check if subscription already exists
          const existingSubscription = await query<{ healthie_subscription_id: string }>(
            `SELECT healthie_subscription_id 
             FROM healthie_subscriptions 
             WHERE patient_id = $1 
               AND healthie_package_id = $2 
               AND is_active = TRUE
             LIMIT 1`,
            [patientId, packageId]
          );

          if (existingSubscription.length === 0) {
            // Assign package to client
            const subscription = await healthieClient.assignPackageToClient({
              client_id: healthieClientId,
              package_id: packageId,
              start_date: packageMapping.nextChargeDate?.toISOString().split('T')[0],
            });

            // Store subscription
            await query(
              `INSERT INTO healthie_subscriptions (
                healthie_subscription_id, patient_id, healthie_client_id, healthie_package_id,
                status, start_date, next_charge_date, amount, qb_recurring_transaction_id
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                subscription.id,
                patientId,
                healthieClientId,
                packageId,
                subscription.status || 'active',
                subscription.start_date || null,
                subscription.next_charge_date || null,
                subscription.amount || packageMapping.amount,
                recurring.Id,
              ]
            );

            // Store package mapping
            await query(
              `INSERT INTO healthie_package_mapping (
                qb_recurring_transaction_id, qb_customer_id, healthie_package_id,
                amount, frequency, next_charge_date
              ) VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (qb_recurring_transaction_id, healthie_package_id) DO UPDATE SET
                is_active = TRUE, updated_at = NOW()`,
              [
                recurring.Id,
                qbCustomerId,
                packageId,
                packageMapping.amount,
                packageMapping.frequency,
                packageMapping.nextChargeDate || null,
              ]
            );

            result.subscriptionsCreated++;

            // Log migration
            await query(
              `INSERT INTO healthie_migration_log (
                migration_type, patient_id, operation, status, healthie_id, metadata
              ) VALUES ('subscription_creation', $1, 'assign_package', 'success', $2, $3)`,
              [
                patientId,
                subscription.id,
                JSON.stringify({ package_id: packageId, recurring_id: recurring.Id }),
              ]
            );
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          result.errors.push(`Failed to create subscription for recurring ${recurring.Id}: ${errorMsg}`);
          
          // Log error
          await query(
            `INSERT INTO healthie_migration_log (
              migration_type, patient_id, operation, status, error_message, metadata
            ) VALUES ('subscription_creation', $1, 'assign_package', 'failed', $2, $3)`,
            [patientId, errorMsg, JSON.stringify({ recurring_id: recurring.Id })]
          );
        }
      }
    }

    result.success = result.errors.length === 0;
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    
    // Log error
    await query(
      `INSERT INTO healthie_migration_log (
        migration_type, patient_id, operation, status, error_message
      ) VALUES ('migration', $1, 'migrate_patient', 'failed', $2)`,
      [patientId, result.errors.join('; ')]
    );
  }

  return result;
}

/**
 * Migrate multiple patients in batch
 */
export async function migrateBatch(
  patientIds: string[],
  options?: {
    skipExisting?: boolean;
    createPackages?: boolean;
  }
): Promise<BatchMigrationResult> {
  const result: BatchMigrationResult = {
    success: true,
    totalProcessed: patientIds.length,
    successful: 0,
    failed: 0,
    results: [],
    errors: [],
  };

  for (const patientId of patientIds) {
    try {
      const migrationResult = await migratePatientToHealthie(patientId, options);
      result.results.push(migrationResult);

      if (migrationResult.success) {
        result.successful++;
      } else {
        result.failed++;
        result.errors.push(...migrationResult.errors);
      }
    } catch (error) {
      result.failed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push(`Patient ${patientId}: ${errorMsg}`);
      
      result.results.push({
        success: false,
        patientId,
        patientName: 'Unknown',
        errors: [errorMsg],
        subscriptionsCreated: 0,
      });
    }
  }

  result.success = result.failed === 0;
  return result;
}

/**
 * Validate migration success
 */
export async function validateMigration(patientId: string): Promise<{
  valid: boolean;
  issues: string[];
}> {
  const issues: string[] = [];

  // Check if client exists
  const clientMapping = await query<{ healthie_client_id: string }>(
    `SELECT healthie_client_id 
     FROM healthie_clients 
     WHERE patient_id = $1 AND is_active = TRUE`,
    [patientId]
  );

  if (clientMapping.length === 0) {
    issues.push('No Healthie client mapping found');
    return { valid: false, issues };
  }

  // Check if subscriptions exist
  const subscriptions = await query<{ count: number }>(
    `SELECT COUNT(*) as count 
     FROM healthie_subscriptions 
     WHERE patient_id = $1 AND is_active = TRUE`,
    [patientId]
  );

  if (subscriptions.length === 0 || subscriptions[0].count === 0) {
    issues.push('No active subscriptions found');
  }

  // Check for migration errors
  const errors = await query<{ count: number }>(
    `SELECT COUNT(*) as count 
     FROM healthie_migration_log 
     WHERE patient_id = $1 AND status = 'failed'`,
    [patientId]
  );

  if (errors.length > 0 && errors[0].count > 0) {
    issues.push(`${errors[0].count} migration errors found`);
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

