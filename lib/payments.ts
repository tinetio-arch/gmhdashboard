import { createHealthieClient } from './healthie';
import {
  checkPaymentMethodStatus,
  createInvoiceForPatient,
  createInvoicesForAllPatients,
} from './healthieInvoiceService';
import { patientsService } from './patients';

/**
 * Payments domain module
 * ----------------------
 * Coordinates Healthie invoices, subscriptions, and payment-method status with
 * our internal tracking tables.
 */

export type InvoiceInput = {
  patientId: string;
  amount: number;
  description?: string;
  dueDate?: string;
  sendEmail?: boolean;
};

export type InvoiceRecord = {
  invoiceId: string;
  patientId: string;
  amount: number;
  status: string;
  dueDate?: string | null;
  createdAt: string;
};

export type PaymentMethodStatus = {
  hasPaymentMethod: boolean;
  methods: Array<{
    id: string;
    type: string;
    lastFour?: string;
    expiresAt?: string;
    isDefault?: boolean;
  }>;
};

export interface PaymentsService {
  ensurePaymentMethod(patientId: string): Promise<PaymentMethodStatus>;
  createInvoice(input: InvoiceInput): Promise<InvoiceRecord>;
  createBulkInvoices(criteria: { patients?: string[]; defaultAmount?: number }): Promise<{ created: InvoiceRecord[] }>;
  refreshPaymentStatuses(patientIds?: string[]): Promise<Record<string, PaymentMethodStatus>>;
}

function mapInvoiceRecord(input: {
  invoiceId: string;
  patientId: string;
  amount: number;
  status: string;
  dueDate?: string | null;
  createdAt?: string;
}): InvoiceRecord {
  return {
    invoiceId: input.invoiceId,
    patientId: input.patientId,
    amount: input.amount,
    status: input.status,
    dueDate: input.dueDate ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export const paymentsService: PaymentsService = {
  async ensurePaymentMethod(patientId) {
    const healthieClient = createHealthieClient();
    if (!healthieClient) {
      throw new Error('Healthie client not configured.');
    }

    const healthieClientId = await patientsService.ensureHealthieClient(patientId);
    const methods = await healthieClient.getPaymentMethods(healthieClientId);

    return {
      hasPaymentMethod: methods.length > 0,
      methods: methods.map((method) => ({
        id: method.id,
        type: method.type,
        lastFour: method.last_four ?? undefined,
        expiresAt: method.expires_at ?? undefined,
        isDefault: method.is_default ?? undefined,
      })),
    };
  },

  async createInvoice(invoice) {
    const result = await createInvoiceForPatient(invoice.patientId, invoice.amount, {
      description: invoice.description,
      dueDate: invoice.dueDate ? new Date(invoice.dueDate) : undefined,
      sendEmail: invoice.sendEmail,
    });

    if (!result.success || !result.invoiceId) {
      throw new Error(result.error || 'Failed to create invoice.');
    }

    return mapInvoiceRecord({
      invoiceId: result.invoiceId,
      patientId: invoice.patientId,
      amount: invoice.amount,
      status: 'sent',
      dueDate: invoice.dueDate ?? null,
    });
  },

  async createBulkInvoices(criteria) {
    const created: InvoiceRecord[] = [];

    if (criteria.patients && criteria.patients.length > 0) {
      const defaultAmount = criteria.defaultAmount;
      if (!defaultAmount || defaultAmount <= 0) {
        throw new Error('defaultAmount must be provided when specifying patient IDs.');
      }

      for (const patientId of criteria.patients) {
        try {
          const record = await this.createInvoice({
            patientId,
            amount: defaultAmount,
          });
          created.push(record);
        } catch (error) {
          console.error(`[payments] Failed to create invoice for ${patientId}:`, error);
        }
      }
      return { created };
    }

    const batch = await createInvoicesForAllPatients();
    for (const entry of batch.results) {
      if (entry.success && entry.invoiceId) {
        created.push(
          mapInvoiceRecord({
            invoiceId: entry.invoiceId,
            patientId: entry.patientId,
            amount: entry.amount,
            status: 'sent',
          })
        );
      }
    }

    return { created };
  },

  async refreshPaymentStatuses(patientIds) {
    const statuses = await checkPaymentMethodStatus();
    const filtered = patientIds?.length
      ? statuses.filter((status) => patientIds.includes(status.patientId))
      : statuses;

    return filtered.reduce<Record<string, PaymentMethodStatus>>((acc, status) => {
      acc[status.patientId] = {
        hasPaymentMethod: status.hasPaymentMethod,
        methods: status.hasPaymentMethod
          ? [
              {
                id: 'primary',
                type: 'card',
                isDefault: true,
              },
            ]
          : [],
      };
      return acc;
    }, {});
  },
};

