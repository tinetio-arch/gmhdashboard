import { query } from './db';
import { healthieGraphQL } from './healthieApi';
import { transitionStatus } from './status-transitions';

const HEALTHIE_PAYMENT_METHOD_KEY = 'healthie';
const HEALTHIE_PAYMENT_METHOD_LABEL = 'Healthie';

const NOW_PRIMARY_CLIENT_KEY = 'nowprimary_care';
const NOW_PRIMARY_CLIENT_LABEL = 'NowPrimary.Care';

const NOW_MENS_CLIENT_KEY = 'nowmenshealth_care';
const NOW_MENS_CLIENT_LABEL = 'NowMensHealth.Care';

const PAID_STATUSES = new Set(['paid', 'complete', 'completed', 'succeeded', 'success', 'processed']);
const FAILED_STATUSES = new Set(['declined', 'failed', 'card_declined', 'error', 'voided']);
// FIX(2026-03-19): "Not Yet Paid" from Healthie means the recurring charge failed (card declined, expired, etc.)
const UNPAID_STATUSES = new Set(['not yet paid', 'unpaid', 'overdue', 'past_due']);

// Webhook event types that contain payment resource IDs requiring hydration from Healthie API
const PAYMENT_EVENT_TYPES = new Set([
  'requested_payment.created',
  'requested_payment.updated',
  'recurring_payment.updated',
  'recurring_payment.created',
]);

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

// FIX(2026-04-06): Only activate patients currently on hold_payment_research.
// Never reactivate discharged, inactive, paused, or hold_contract_renewal patients.
const ACTIVATABLE_STATUSES = ['hold_payment_research'];

async function activatePatientBilling(patientId: string, clientType: ClientTypeTarget): Promise<void> {
  await ensureLookupValues();

  // Preserve atomic guard: only activate if currently on hold_payment_research
  const current = await query<{ status_key: string }>(
    'SELECT status_key FROM patients WHERE patient_id = $1',
    [patientId]
  );
  if (current.length === 0 || !ACTIVATABLE_STATUSES.includes(current[0].status_key)) {
    console.warn('[healthie-webhook] Skipped activation — patient status not activatable', {
      patientId, currentStatus: current[0]?.status_key ?? 'not_found',
      activatableStatuses: ACTIVATABLE_STATUSES,
    });
    return;
  }

  const t = await transitionStatus({
    patientId,
    toStatus: 'active',
    source: 'webhook_processor',
    actor: 'healthie_payment_automation',
    reason: 'Payment marked paid — auto-activated',
    metadata: { fn: 'activatePatientBilling', clientType: clientType.key },
  });
  if (!t.applied) {
    console.warn('[healthie-webhook] activation blocked', { patientId, blockReason: t.blockReason });
    return;
  }

  await query(
    `
      UPDATE patients
         SET payment_method_key = $2,
             payment_method = $3,
             client_type_key = $4,
             client_type = $5,
             updated_at = NOW()
       WHERE patient_id = $1::uuid
    `,
    [patientId, HEALTHIE_PAYMENT_METHOD_KEY, HEALTHIE_PAYMENT_METHOD_LABEL, clientType.key, clientType.label]
  );

  try {
    await query(
      `INSERT INTO patient_status_activity_log
       (patient_id, previous_status, new_status, change_source, change_reason)
       VALUES ($1, 'hold_payment_research', 'active', 'healthie_payment_automation', 'Payment marked paid — auto-activated')`,
      [patientId]
    );
  } catch (e) {
    console.warn('[healthie-webhook] Failed to write audit log', e);
  }
}

// FIX(2026-04-06): Only put active patients on hold. Never touch discharged/paused/inactive.
const DEACTIVATABLE_STATUSES = ['active'];

async function deactivatePatientBilling(patientId: string, status: string): Promise<void> {
  // Preserve atomic guard: only deactivate if currently active
  const current = await query<{ status_key: string }>(
    'SELECT status_key FROM patients WHERE patient_id = $1',
    [patientId]
  );
  if (current.length === 0 || !DEACTIVATABLE_STATUSES.includes(current[0].status_key)) {
    console.warn('[healthie-webhook] Skipped deactivation — patient not in deactivatable status', {
      patientId, currentStatus: current[0]?.status_key ?? 'not_found',
    });
    return;
  }

  const t = await transitionStatus({
    patientId,
    toStatus: 'hold_payment_research',
    source: 'webhook_processor',
    actor: 'healthie_payment_automation',
    reason: `Payment failed — Healthie status: ${status}`,
    metadata: { fn: 'deactivatePatientBilling', healthieStatus: status },
  });
  if (!t.applied) {
    console.warn('[healthie-webhook] deactivation blocked', { patientId, blockReason: t.blockReason });
    return;
  }

  // Custom alert_status override + updated_at (helper sets default 'Hold - Payment Research'
  // from lookup, but this function intentionally uses 'Payment Failed' for visibility)
  await query(
    `
      UPDATE patients
         SET alert_status = 'Payment Failed',
             updated_at = NOW()
       WHERE patient_id = $1::uuid
    `,
    [patientId]
  );

  try {
    await query(
      `INSERT INTO patient_status_activity_log
       (patient_id, previous_status, new_status, change_source, change_reason)
       VALUES ($1, 'active', 'hold_payment_research', 'healthie_payment_automation', $2)`,
      [patientId, `Payment failed — Healthie status: ${status}`]
    );
  } catch (e) {
    console.warn('[healthie-webhook] Failed to write audit log', e);
  }
}

/**
 * FIX(2026-03-19): Healthie webhooks only send { eventType, resource_id, resource_id_type }.
 * They do NOT include the payment object. We must fetch it from Healthie's API.
 */
async function hydratePaymentFromHealthie(resourceId: string, resourceType: string): Promise<any | null> {
  try {
    if (resourceType === 'RequestedPayment') {
      const data = await healthieGraphQL<{
        requestedPayment: {
          id: string;
          status: string;
          price: string;
          invoice_id: string;
          recipient_id: string;
          recipient: { id: string; first_name: string; last_name: string } | null;
          sender_id: string;
          created_at: string;
          paid_at: string | null;
        } | null;
      }>(`
        query GetRequestedPayment($id: ID) {
          requestedPayment(id: $id) {
            id status price invoice_id
            recipient_id recipient { id first_name last_name }
            sender_id created_at paid_at
          }
        }
      `, { id: resourceId });

      const rp = data.requestedPayment;
      if (!rp) return null;
      return {
        id: rp.id,
        invoice_id: rp.invoice_id,
        status: rp.status,
        amount: rp.price,
        client_id: rp.recipient_id,
        paid_at: rp.paid_at,
        created_at: rp.created_at,
        _patient_name: rp.recipient ? `${rp.recipient.first_name} ${rp.recipient.last_name}` : null,
      };
    }

    if (resourceType === 'RecurringPayment') {
      // For recurring payments, fetch recipient + last billing item to find the latest requested payment
      const data = await healthieGraphQL<{
        recurringPayment: {
          id: string;
          recipient_id: string;
          amount_to_pay: string;
          last_billing_item: { id: string; requested_payment_id: string | null } | null;
        } | null;
      }>(`
        query GetRecurringPayment($id: ID) {
          recurringPayment(id: $id) {
            id recipient_id amount_to_pay
            last_billing_item { id requested_payment_id }
          }
        }
      `, { id: resourceId });

      const rp = data.recurringPayment;
      if (!rp) return null;

      // If there's a linked requested payment, hydrate that for accurate status
      const rpId = rp.last_billing_item?.requested_payment_id;
      if (rpId) {
        return hydratePaymentFromHealthie(rpId, 'RequestedPayment');
      }

      // Fallback: return what we have (no status available without a requested payment)
      return {
        id: rp.id,
        amount: rp.amount_to_pay,
        client_id: rp.recipient_id,
        status: 'unknown',
      };
    }

    return null;
  } catch (error) {
    console.error('[healthie-webhook] Failed to hydrate payment from Healthie API:', error);
    return null;
  }
}

export async function handleHealthiePaymentWebhook(payload: any): Promise<PaymentWebhookResult> {
  let payment = extractPaymentPayload(payload);

  // FIX(2026-03-19): If no payment object in body, hydrate from Healthie API using resource_id
  // Healthie webhooks only send { eventType, resource_id, resource_id_type }
  if (!payment) {
    const eventType = payload?.eventType || payload?.event_type || '';
    const resourceId = String(payload?.resource_id || '');
    const resourceType = payload?.resource_id_type || '';

    if (PAYMENT_EVENT_TYPES.has(eventType) && resourceId) {
      console.log('[healthie-webhook] Hydrating payment from Healthie API', { eventType, resourceId, resourceType });
      payment = await hydratePaymentFromHealthie(resourceId, resourceType);
      if (!payment) {
        console.warn('[healthie-webhook] Could not hydrate payment', { eventType, resourceId });
        return { handled: false };
      }
    } else {
      return { handled: false };
    }
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
    // FIX(2026-03-19): Try resolving by healthieClientId from hydrated payment
    // The recipient_id from Healthie maps to healthie_client_id in our patients table
    if (healthieClientId) {
      const directMatch = await query<{ patient_id: string }>(
        `SELECT patient_id FROM patients WHERE healthie_client_id = $1 LIMIT 1`,
        [healthieClientId]
      );
      if (directMatch[0]?.patient_id) {
        const directPatientId = directMatch[0].patient_id;
        console.log('[healthie-webhook] Resolved patient via patients.healthie_client_id', {
          healthieClientId, patientId: directPatientId, status, amount,
          patientName: payment._patient_name,
        });
        return await processPaymentForPatient(directPatientId, invoiceId, healthieClientId, status, amount, paidAt, payment);
      }
    }

    console.warn('[healthie-webhook] Payment received but patient mapping not found', {
      invoiceId, healthieClientId, status, amount,
      patientName: payment._patient_name,
    });
    return { handled: true };
  }

  return await processPaymentForPatient(patientId, invoiceId, healthieClientId, status, amount, paidAt, payment);
}

async function processPaymentForPatient(
  patientId: string,
  invoiceId: string | null,
  healthieClientId: string | null,
  status: string | null,
  amount: number,
  paidAt: string | null,
  payment: any,
): Promise<PaymentWebhookResult> {
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
      patientId, invoiceId, healthieClientId, amount,
      patientName: payment._patient_name,
    });
    return { handled: true, patientId, invoiceId: normalizedInvoiceId, status: normalizedStatus };
  }

  if (status && (FAILED_STATUSES.has(status) || UNPAID_STATUSES.has(status))) {
    await deactivatePatientBilling(patientId, status);
    console.warn('[healthie-webhook] ⚠️ PAYMENT FAILURE — Deactivated billing', {
      patientId, invoiceId, healthieClientId, status, amount,
      patientName: payment._patient_name,
    });
    return { handled: true, patientId, invoiceId: normalizedInvoiceId, status: normalizedStatus };
  }

  console.log('[healthie-webhook] Payment event processed (status not actionable)', {
    patientId, invoiceId, status, amount,
    patientName: payment._patient_name,
  });
  return { handled: true, patientId, invoiceId: normalizedInvoiceId, status: normalizedStatus };
}


