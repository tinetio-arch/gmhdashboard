import { query } from './db';

const HEALTHIE_PAYMENT_METHOD_KEY = 'healthie';
const HEALTHIE_PAYMENT_METHOD_LABEL = 'Healthie';

const NOW_PRIMARY_CLIENT_KEY = 'nowprimary_care';
const NOW_PRIMARY_CLIENT_LABEL = 'NowPrimary.Care';

const NOW_MENS_CLIENT_KEY = 'nowmenshealth_care';
const NOW_MENS_CLIENT_LABEL = 'NowMensHealth.Care';

const PAID_STATUSES = new Set(['paid', 'complete', 'completed', 'succeeded', 'success', 'processed']);
const FAILED_STATUSES = new Set(['declined', 'failed', 'card_declined', 'error', 'voided']);

type PaymentWebhookResult = {
  handled: boolean;
  patientId?: string;
  invoiceId?: string;
  status?: string;
};

type InvoiceUpsertInput = {
  invoiceId: string;
  patientId: string;
  healthieClientId: string | null;
  amount: number;
  status: string;
  paidAt?: string | null;
};

type ClientTypeTarget = {
  key: string;
  label: string;
};

function normalizeString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function normalizeStatus(value: unknown): string | null {
  const text = normalizeString(value);
  return text ? text.toLowerCase() : null;
}

function parseTimestamp(input: unknown): string | null {
  if (!input) return null;
  const numeric = typeof input === 'number' ? input : Number.parseInt(String(input), 10);
  if (!Number.isNaN(numeric) && String(input).length >= 10) {
    const fromEpoch = new Date(
      String(input).length === 10 ? numeric * 1000 : numeric
    );
    if (!Number.isNaN(fromEpoch.getTime())) {
      return fromEpoch.toISOString();
    }
  }
  const parsed = new Date(String(input));
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function parseAmount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number(value.toFixed(2));
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.-]/g, '');
    if (!cleaned) return 0;
    const parsed = Number.parseFloat(cleaned);
    return Number.isNaN(parsed) ? 0 : Number(parsed.toFixed(2));
  }
  return 0;
}

function extractAmountFromPayment(payment: any): number {
  if (!payment || typeof payment !== 'object') {
    return 0;
  }
  const directCandidates = [
    payment.amount,
    payment.amount_due,
    payment.amount_paid,
    payment.total,
    payment.amount_requested,
    payment.amount_remaining,
  ];
  for (const candidate of directCandidates) {
    const parsed = parseAmount(candidate);
    if (parsed > 0) {
      return parsed;
    }
  }
  const centCandidates = [payment.amount_in_cents, payment.amount_cents, payment.amount_due_cents];
  for (const cent of centCandidates) {
    const centsValue = parseAmount(cent);
    if (centsValue > 0) {
      return Number((centsValue / 100).toFixed(2));
    }
  }
  return 0;
}

function extractPaymentPayload(payload: any): any | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const candidates = [
    payload.requested_payment,
    payload.requestedPayment,
    payload.invoice,
    payload.payment,
    payload.data?.requested_payment,
    payload.data?.requestedPayment,
    payload.data?.invoice,
    payload.payload?.requested_payment,
    payload.payload?.invoice,
    payload.object?.requested_payment,
    payload.object?.invoice,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object') {
      return candidate;
    }
  }
  return null;
}

function extractInvoiceId(payment: any): string | null {
  if (!payment || typeof payment !== 'object') {
    return null;
  }
  return (
    normalizeString(payment.id) ||
    normalizeString(payment.requested_payment_id) ||
    normalizeString(payment.invoice_id) ||
    normalizeString(payment.healthie_invoice_id) ||
    normalizeString(payment.uuid)
  );
}

function extractClientId(payment: any): string | null {
  if (!payment || typeof payment !== 'object') {
    return null;
  }
  return (
    normalizeString(payment.client_id) ||
    normalizeString(payment.client?.id) ||
    normalizeString(payment.user_id) ||
    normalizeString(payment.patient_id)
  );
}

async function ensureLookupValues(): Promise<void> {
  await query(
    `
      INSERT INTO payment_method_lookup (method_key, display_name, hex_color, is_active)
      VALUES ($1, $2, '#c084fc', TRUE)
      ON CONFLICT (method_key) DO UPDATE
        SET display_name = EXCLUDED.display_name,
            hex_color = EXCLUDED.hex_color,
            is_active = TRUE
    `,
    [HEALTHIE_PAYMENT_METHOD_KEY, HEALTHIE_PAYMENT_METHOD_LABEL]
  );

  await query(
    `
      INSERT INTO client_type_lookup (type_key, display_name, hex_color, is_primary_care, is_active)
      VALUES
        ($1, $2, '#bfdbfe', TRUE, TRUE),
        ($3, $4, '#fed7aa', FALSE, TRUE)
      ON CONFLICT (type_key) DO UPDATE
        SET display_name = EXCLUDED.display_name,
            hex_color = EXCLUDED.hex_color,
            is_primary_care = EXCLUDED.is_primary_care,
            is_active = TRUE
    `,
    [NOW_PRIMARY_CLIENT_KEY, NOW_PRIMARY_CLIENT_LABEL, NOW_MENS_CLIENT_KEY, NOW_MENS_CLIENT_LABEL]
  );
}

async function determineClientGroup(patientId: string): Promise<ClientTypeTarget> {
  const rows = await query<{ client_type_key: string | null; type_of_client: string | null }>(
    `
      SELECT client_type_key, type_of_client
      FROM patient_data_entry_v
      WHERE patient_id = $1
      LIMIT 1
    `,
    [patientId]
  );
  const record = rows[0];
  const combined = `${record?.client_type_key ?? ''} ${record?.type_of_client ?? ''}`.toLowerCase();
  if (combined.includes('primecare') || combined.includes('primary')) {
    return {
      key: NOW_PRIMARY_CLIENT_KEY,
      label: NOW_PRIMARY_CLIENT_LABEL,
    };
  }
  if (combined.includes('nowprimary')) {
    return {
      key: NOW_PRIMARY_CLIENT_KEY,
      label: NOW_PRIMARY_CLIENT_LABEL,
    };
  }
  if (combined.includes('nowmens')) {
    return {
      key: NOW_MENS_CLIENT_KEY,
      label: NOW_MENS_CLIENT_LABEL,
    };
  }
  return {
    key: NOW_MENS_CLIENT_KEY,
    label: NOW_MENS_CLIENT_LABEL,
  };
}

async function resolvePatientId(invoiceId: string | null, healthieClientId: string | null): Promise<string | null> {
  if (invoiceId) {
    const invoices = await query<{ patient_id: string | null }>(
      `
        SELECT patient_id
        FROM healthie_invoices
        WHERE healthie_invoice_id = $1
        LIMIT 1
      `,
      [invoiceId]
    );
    if (invoices[0]?.patient_id) {
      return invoices[0].patient_id;
    }
  }

  if (healthieClientId) {
    const clients = await query<{ patient_id: string | null }>(
      `
        SELECT patient_id
        FROM healthie_clients
        WHERE healthie_client_id = $1
        ORDER BY is_active DESC, updated_at DESC
        LIMIT 1
      `,
      [healthieClientId]
    );
    if (clients[0]?.patient_id) {
      return clients[0].patient_id;
    }
  }

  return null;
}

async function upsertInvoiceRecord(input: InvoiceUpsertInput): Promise<void> {
  await query(
    `
      INSERT INTO healthie_invoices (
        healthie_invoice_id,
        patient_id,
        healthie_client_id,
        amount,
        status,
        paid_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (healthie_invoice_id) DO UPDATE
        SET patient_id = COALESCE(EXCLUDED.patient_id, healthie_invoices.patient_id),
            healthie_client_id = COALESCE(EXCLUDED.healthie_client_id, healthie_invoices.healthie_client_id),
            amount = CASE WHEN EXCLUDED.amount > 0 THEN EXCLUDED.amount ELSE healthie_invoices.amount END,
            status = EXCLUDED.status,
            paid_at = COALESCE(EXCLUDED.paid_at, healthie_invoices.paid_at),
            updated_at = NOW()
    `,
    [
      input.invoiceId,
      input.patientId,
      input.healthieClientId,
      input.amount,
      input.status,
      input.paidAt ?? null,
    ]
  );
}

async function activatePatientBilling(patientId: string, clientType: ClientTypeTarget): Promise<void> {
  await ensureLookupValues();
  await query(
    `
      UPDATE patients
         SET payment_method_key = $2,
             payment_method = $3,
             client_type_key = $4,
             client_type = $5,
             status_key = 'active',
             alert_status = 'Active',
             updated_at = NOW()
       WHERE patient_id = $1
    `,
    [patientId, HEALTHIE_PAYMENT_METHOD_KEY, HEALTHIE_PAYMENT_METHOD_LABEL, clientType.key, clientType.label]
  );
}

async function deactivatePatientBilling(patientId: string, status: string): Promise<void> {
  await query(
    `
      UPDATE patients
         SET status_key = 'hold_payment_research',
             alert_status = 'Payment Failed',
             updated_at = NOW()
       WHERE patient_id = $1
    `,
    [patientId]
  );
}

export async function handleHealthiePaymentWebhook(payload: any): Promise<PaymentWebhookResult> {
  const payment = extractPaymentPayload(payload);
  if (!payment) {
    return { handled: false };
  }

  const invoiceId = extractInvoiceId(payment);
  const healthieClientId = extractClientId(payment);

  if (!invoiceId && !healthieClientId) {
    return { handled: false };
  }

  const status = normalizeStatus(
    payment.status ??
    payment.state ??
    payload.status ??
    payload.state ??
    payload.event_status
  );

  const amount = extractAmountFromPayment(payment);
  const paidAt = parseTimestamp(payment.paid_at ?? payment.completed_at ?? payment.updated_at ?? payment.timestamp);

  const patientId = await resolvePatientId(invoiceId, healthieClientId);
  if (!patientId) {
    console.warn('[healthie-webhook] Payment received but patient mapping not found', {
      invoiceId,
      healthieClientId,
    });
    return { handled: true };
  }

  if (invoiceId) {
    await upsertInvoiceRecord({
      invoiceId,
      patientId,
      healthieClientId,
      amount,
      status: status ?? 'unknown',
      paidAt: status && PAID_STATUSES.has(status) ? paidAt ?? new Date().toISOString() : null,
    });
  }

  const normalizedInvoiceId: string | undefined = invoiceId ?? undefined;
  const normalizedStatus: string | undefined = status ?? undefined;

  if (status && PAID_STATUSES.has(status)) {
    const clientType = await determineClientGroup(patientId);
    await activatePatientBilling(patientId, clientType);
    console.log('[healthie-webhook] Activated billing for paid invoice', {
      patientId,
      invoiceId,
      healthieClientId,
    });
    return { handled: true, patientId, invoiceId: normalizedInvoiceId, status: normalizedStatus };
  }

  if (status && FAILED_STATUSES.has(status)) {
    await deactivatePatientBilling(patientId, status);
    console.warn('[healthie-webhook] Deactivated billing for FAILED invoice', {
      patientId,
      invoiceId,
      healthieClientId,
      status
    });
    return { handled: true, patientId, invoiceId: normalizedInvoiceId, status: normalizedStatus };
  }

  return { handled: true, patientId, invoiceId: normalizedInvoiceId, status: normalizedStatus };
}


