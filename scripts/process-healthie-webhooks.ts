import 'dotenv/config';
import { connectSnowflake, fetchBillingItems, getSnowflakeConnection, upsertBillingItems } from '@/lib/healthie/financials';
import { processPendingEvents, type WebhookEventRow } from '@/lib/healthie/processor';
import { sendChatMessage } from '@/lib/notifications/chat';
import fetch from 'node-fetch';

async function handleBillingItems() {
  const conn = getSnowflakeConnection();
  await connectSnowflake(conn);
  try {
    const billingItems = await fetchBillingItems();
    await upsertBillingItems(conn, billingItems);
    return 'processed' as const;
  } finally {
    conn.destroy((err) => {
      if (err) {
        // eslint-disable-next-line no-console
        console.error('Error closing Snowflake connection', err);
      }
    });
  }
}

async function fetchRequestedPayment(id: string) {
  const { HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql', HEALTHIE_API_KEY } = process.env;
  if (!HEALTHIE_API_KEY) return null;

  const query = `
    query RequestedPayment($id: ID!) {
      requestedPayment(id: $id) {
        id
        status
        amount_cents
        amount_dollars
        amount
        currency
        created_at
        updated_at
        paid_at
        patient { id full_name email }
        client { id full_name email }
        requested_by { id full_name email }
      }
    }
  `;

  try {
    const res = await fetch(HEALTHIE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Basic ${HEALTHIE_API_KEY}`,
        authorizationsource: 'API',
      },
      body: JSON.stringify({ query, variables: { id } }),
    });

  const json: any = await res.json();
  const data = json?.data?.requestedPayment;
    if (!res.ok || !data) return null;
    return data;
  } catch (err) {
    console.error('Error fetching requested payment', err);
    return null;
  }
}

async function handler(event: WebhookEventRow) {
  // For now, only billing_item.* events trigger a sync of billing items; others are acknowledged.
  if (event.event_type?.startsWith('billing_item.')) {
    console.log('Syncing billing items due to webhook event', {
      id: event.id,
      event_type: event.event_type,
      resource_id: event.resource_id,
      changed_fields: event.changed_fields,
    });
    const result = await handleBillingItems();

    // Notify ops-billing space if configured
    await sendChatMessage(process.env.GOOGLE_CHAT_WEBHOOK_OPS_BILLING, {
      text: `Healthie billing item event: ${event.event_type}`,
      cardSections: [
        {
          header: 'Billing Item Event',
          items: [
            { key: 'Event Type', value: event.event_type },
            { key: 'Resource ID', value: event.resource_id },
            { key: 'Changed Fields', value: (event.changed_fields || []).join(', ') || 'n/a' },
            { key: 'Status', value: result },
          ],
        },
      ],
    });

    return result;
  }

  if (event.event_type?.startsWith('requested_payment.')) {
    const payload = (event.raw_payload ?? {}) as Record<string, any>;
    const rp = (await fetchRequestedPayment(event.resource_id)) || {};

    const patient = rp.patient || payload.patient || payload.client || payload.user || {};
    const patientName = patient.full_name || patient.name || patient.display_name || 'Unknown patient';
    const patientId = patient.id || rp.patient_id || payload.patient_id || payload.client_id;

    const amount = rp.amount_dollars ?? rp.amount ?? rp.amount_cents ?? payload.amount ?? payload.amount_dollars ?? payload.amount_cents;
    const currency = rp.currency || payload.currency || 'USD';

    const requester = rp.requested_by || payload.requested_by || payload.requester || {};
    const requesterName = requester.full_name || requester.name || 'Unknown requester';
    const requesterId = requester.id || payload.requester_id;

    const status = rp.status || payload.status || payload.state || 'unknown';
    const sentAt = rp.created_at || rp.updated_at || payload.created_at || payload.sent_at;
    const paidAt = rp.paid_at || payload.paid_at || payload.completed_at;

    await sendChatMessage(process.env.GOOGLE_CHAT_WEBHOOK_OPS_BILLING, {
      text: `Healthie requested payment event: ${event.event_type}`,
      cardSections: [
        {
          header: 'Requested Payment',
          items: [
            { key: 'Event Type', value: event.event_type },
            { key: 'Resource ID', value: event.resource_id },
            { key: 'Patient', value: patientName },
            { key: 'Patient ID', value: patientId },
            { key: 'Amount', value: amount },
            { key: 'Currency', value: currency },
            { key: 'Requester', value: requesterName },
            { key: 'Requester ID', value: requesterId },
            { key: 'Status', value: status },
            { key: 'Sent At', value: sentAt },
            { key: 'Paid At', value: paidAt },
            { key: 'Changed Fields', value: (event.changed_fields || []).join(', ') || 'n/a' },
          ],
        },
      ],
    });

    await sendChatMessage(process.env.GOOGLE_CHAT_WEBHOOK_OPS_BILLING, {
      text: `Healthie requested payment event: ${event.event_type}`,
      cardSections: [
        {
          header: 'Requested Payment',
          items: [
            { key: 'Event Type', value: event.event_type },
            { key: 'Resource ID', value: event.resource_id },
            { key: 'Patient', value: patientName },
            { key: 'Amount', value: amount },
            { key: 'Requester', value: requesterName },
            { key: 'Status', value: status },
            { key: 'Sent At', value: sentAt },
            { key: 'Paid At', value: paidAt },
            { key: 'Changed Fields', value: (event.changed_fields || []).join(', ') || 'n/a' },
          ],
        },
      ],
    });

    console.log('Requested payment event acknowledged', {
      id: event.id,
      event_type: event.event_type,
      resource_id: event.resource_id,
      patient: patientName,
      amount,
      status,
    });

    return 'processed' as const;
  }

  console.log('Skipping (ack) unsupported Healthie webhook event', {
    id: event.id,
    event_type: event.event_type,
    resource_id: event.resource_id,
  });
  return 'skipped' as const;
}

async function main() {
  const { processed, skipped, errors } = await processPendingEvents(handler);
  console.log('Healthie webhook processing complete', { processed, skipped, errors });
  if (errors > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Healthie webhook processor failed', err);
  process.exitCode = 1;
});
