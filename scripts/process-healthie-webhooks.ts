import dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/.env' });
dotenv.config({ path: '.env.local' });

// NOTE: Snowflake import removed — Node.js snowflake-sdk hangs indefinitely.
// Billing item sync is now handled by Python: /home/ec2-user/scripts/sync-all-to-snowflake.py
import { processPendingEvents, type WebhookEventRow } from '@/lib/healthie/processor';
import { sendChatMessage } from '@/lib/notifications/chat';
import fetch from 'node-fetch';

// Environment variables
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ALERT_CHAT_ID = process.env.TELEGRAM_APPROVAL_CHAT_ID;

// Send Telegram alert for critical events (declined cards, failed payments)
async function sendTelegramAlert(message: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ALERT_CHAT_ID) {
    console.log('[Healthie Webhooks] Telegram not configured, skipping alert');
    return;
  }

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_ALERT_CHAT_ID,
        text: message,
        parse_mode: 'HTML'
      })
    });
    console.log('[Healthie Webhooks] Telegram alert sent');
  } catch (err) {
    console.error('[Healthie Webhooks] Failed to send Telegram alert:', err);
  }
}

// Check if a status indicates a declined/failed payment
function isDeclinedPayment(status: string | undefined | null): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s.includes('failed') || s.includes('declined') || s.includes('error') ||
    s.includes('rejected') || s.includes('cancelled') || s === 'card_error';
}

// Check if payment succeeded
function isSuccessfulPayment(status: string | undefined | null): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s === 'succeeded' || s === 'paid' || s === 'completed';
}

// Fetch patient details from Healthie including phone and group
async function fetchHealthiePatient(patientId: string) {
  const { HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql', HEALTHIE_API_KEY } = process.env;
  if (!HEALTHIE_API_KEY || !patientId) return null;

  const query = `
    query GetPatient($id: ID!) {
      user(id: $id) {
        id
        first_name
        last_name
        email
        phone_number
        dietitian_id
        active
        active_group_membership {
          id
          group {
            id
            name
          }
        }
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
      body: JSON.stringify({ query, variables: { id: patientId } }),
    });
    const json: any = await res.json();
    return json?.data?.user || null;
  } catch (err) {
    console.error('[Healthie Webhooks] Error fetching patient:', err);
    return null;
  }
}

// Fetch recurring payment details from Healthie API
// Webhook payloads for recurring_payment events only contain resource_id,
// so we need to query the API to get patient info and payment status.
async function fetchRecurringPayment(paymentId: string) {
  const { HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql', HEALTHIE_API_KEY } = process.env;
  if (!HEALTHIE_API_KEY || !paymentId) return null;

  const query = `
    query GetRecurringPayment($id: ID!) {
      recurringPayment(id: $id) {
        id
        amount_paid_in_cents
        status
        start_date
        end_date
        payment_type
        notes
        sender {
          id
          first_name
          last_name
          email
        }
        recipient {
          id
          first_name
          last_name
        }
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
      body: JSON.stringify({ query, variables: { id: paymentId } }),
    });
    const json: any = await res.json();
    const payment = json?.data?.recurringPayment;
    if (!payment) {
      console.log('[Healthie Webhooks] No recurring payment found for ID:', paymentId);
      return null;
    }
    return payment;
  } catch (err) {
    console.error('[Healthie Webhooks] Error fetching recurring payment:', err);
    return null;
  }
}

// Send in-app CHAT message via Healthie (uses createConversation + createNote)
// This appears in the patient's Healthie messaging/chat - NOT SMS
async function sendHealthieChat(patientId: string, message: string): Promise<boolean> {
  const { HEALTHIE_API_KEY, HEALTHIE_API_URL } = process.env;
  if (!HEALTHIE_API_KEY || !patientId) {
    console.log('[Healthie Webhooks] Healthie Chat: Missing API key or patient ID');
    return false;
  }

  const apiUrl = HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';

  try {
    // Step 1: Create conversation with patient (or get existing)
    const createConvMutation = `
      mutation CreateConversation($input: createConversationInput!) {
        createConversation(input: $input) {
          conversation { id }
          messages { field message }
        }
      }
    `;

    const convResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${HEALTHIE_API_KEY}`,
        'AuthorizationSource': 'API',
      },
      body: JSON.stringify({
        query: createConvMutation,
        variables: { input: { simple_added_users: patientId } },
      }),
    });

    const convResult: any = await convResponse.json();
    const conversationId = convResult.data?.createConversation?.conversation?.id;

    if (!conversationId) {
      console.error('[Healthie Webhooks] Failed to create conversation:', convResult.errors || convResult.data?.createConversation?.messages);
      return false;
    }

    // Step 2: Send message to the conversation
    const createNoteMutation = `
      mutation CreateNote($input: createNoteInput!) {
        createNote(input: $input) {
          note { id content created_at }
          messages { field message }
        }
      }
    `;

    const noteResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${HEALTHIE_API_KEY}`,
        'AuthorizationSource': 'API',
      },
      body: JSON.stringify({
        query: createNoteMutation,
        variables: { input: { conversation_id: conversationId, content: message } },
      }),
    });

    const noteResult: any = await noteResponse.json();
    const noteId = noteResult.data?.createNote?.note?.id;

    if (noteId) {
      console.log(`[Healthie Webhooks] ✅ Healthie Chat sent (Note ID: ${noteId})`);
      return true;
    }

    console.error('[Healthie Webhooks] Failed to send message:', noteResult.errors || noteResult.data?.createNote?.messages);
    return false;
  } catch (err) {
    console.error('[Healthie Webhooks] Healthie Chat exception:', err);
    return false;
  }
}

// DEPRECATED: sendHealthieSms - Direct messaging not enabled in Healthie
// Use sendHealthieChat instead for in-app messaging

// Send SMS via GHL (DEPRECATED - use sendHealthieSms instead)
async function sendGHLSms(phone: string, message: string) {
  const { GHL_V2_API_KEY, GHL_LOCATION_ID } = process.env;
  if (!GHL_V2_API_KEY || !phone) {
    console.log('[Healthie Webhooks] GHL not configured or no phone, skipping SMS');
    return false;
  }

  // Format phone for GHL (ensure +1)
  const formattedPhone = phone.replace(/\D/g, '');
  const fullPhone = formattedPhone.startsWith('1') ? `+${formattedPhone}` : `+1${formattedPhone}`;

  try {
    // First find contact by phone
    const searchRes = await fetch(`https://services.leadconnectorhq.com/contacts/search?query=${encodeURIComponent(fullPhone)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${GHL_V2_API_KEY}`,
        'Version': '2021-07-28',
      },
    });
    const searchJson: any = await searchRes.json();
    const contactId = searchJson?.contacts?.[0]?.id;

    if (!contactId) {
      console.log('[Healthie Webhooks] Contact not found in GHL for phone:', fullPhone);
      return false;
    }

    // Send SMS
    const smsRes = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GHL_V2_API_KEY}`,
        'Version': '2021-07-28',
      },
      body: JSON.stringify({
        type: 'SMS',
        contactId,
        message,
      }),
    });

    if (smsRes.ok) {
      console.log('[Healthie Webhooks] ✅ SMS sent to:', fullPhone);
      return true;
    } else {
      const errText = await smsRes.text();
      console.error('[Healthie Webhooks] Failed to send SMS:', errText);
      return false;
    }
  } catch (err) {
    console.error('[Healthie Webhooks] SMS error:', err);
    return false;
  }
}

// Reactivate patient when payment succeeds
async function reactivatePatient(patientName: string, timestamp: string) {
  try {
    const { Pool } = await import('pg');
    const pool = new Pool({
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT || 5432),
      database: process.env.DATABASE_NAME,
      user: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      ssl: { rejectUnauthorized: false }
    });

    const noteEntry = `[${timestamp}] PAYMENT RECEIVED - Auto-reactivated from Hold - Payment Research.`;

    const result = await pool.query(`
      UPDATE patients 
      SET 
        alert_status = 'Active',
        status_key = 'active',
        notes = CASE 
          WHEN notes IS NULL OR notes = '' THEN $1
          ELSE notes || E'\\n' || $1
        END,
        last_modified = NOW()
      WHERE LOWER(full_name) = LOWER($2)
        AND status_key = 'hold_payment_research'
      RETURNING patient_id, full_name as patient_name
    `, [noteEntry, patientName]);

    await pool.end();

    if (result.rows.length > 0) {
      console.log('[Healthie Webhooks] ✅ Patient reactivated:', result.rows[0].patient_name);
      return true;
    }
    return false;
  } catch (err) {
    console.error('[Healthie Webhooks] Failed to reactivate patient:', err);
    return false;
  }
}

async function handleBillingItems() {
  // Snowflake billing sync removed — handled by Python sync-all-to-snowflake.py every 4h
  console.log('[Healthie Webhooks] Billing item sync handled by Python cron — skipping Node.js Snowflake path');
  return 'processed' as const;
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
            { key: 'Changed Fields', value: Array.isArray(event.changed_fields) ? event.changed_fields.join(', ') : String(event.changed_fields ?? 'n/a') },
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

    // 🚨 DECLINED/FAILED PAYMENT DETECTION - Alert immediately!
    if (isDeclinedPayment(status)) {
      const now = new Date();
      const timestamp = now.toLocaleString('en-US', {
        month: '2-digit', day: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      });

      const alertMessage = `🚨 <b>PAYMENT DECLINED</b>

<b>Patient:</b> ${patientName}
<b>Amount:</b> $${amount || 'unknown'} ${currency}
<b>Status:</b> ${status}
<b>Event:</b> ${event.event_type}
<b>Resource ID:</b> ${event.resource_id}

⚠️ Patient Status changed to Hold - Payment Research.`;


      // Send to Telegram
      await sendTelegramAlert(alertMessage);

      // Send urgent alert to Google Spaces (ops-billing)
      await sendChatMessage(process.env.GOOGLE_CHAT_WEBHOOK_OPS_BILLING, {
        text: `🚨 PAYMENT DECLINED - ${patientName} - $${amount}`,
        cardSections: [
          {
            header: '⚠️ Payment Failed - Action Required',
            items: [
              { key: 'Patient', value: patientName },
              { key: 'Amount', value: `$${amount} ${currency}` },
              { key: 'Status', value: status },
              { key: 'Event Type', value: event.event_type },
              { key: 'Resource ID', value: event.resource_id },
            ],
          },
        ],
      });

      // 🔄 UPDATE PATIENT STATUS IN DATABASE
      // Find patient and set to "Inactive - Payment Research" with note
      try {
        const { Pool } = await import('pg');
        const pool = new Pool({
          host: process.env.DATABASE_HOST,
          port: Number(process.env.DATABASE_PORT || 5432),
          database: process.env.DATABASE_NAME,
          user: process.env.DATABASE_USER,
          password: process.env.DATABASE_PASSWORD,
          ssl: { rejectUnauthorized: false }
        });

        // Build note text
        const paymentDueDate = sentAt ? new Date(sentAt).toLocaleDateString('en-US') : 'Unknown';
        const noteEntry = `[${timestamp}] PAYMENT DECLINED - Amount: $${amount || '?'}, Due: ${paymentDueDate}. Status auto-set to Hold - Payment Research.`;


        // Update patient by matching name in the 'patients' table
        // Use "Hold - Payment Research" status (existing) - staff will manually set to Inactive if needed
        const updateQuery = `
          UPDATE patients 
          SET 
            alert_status = 'Hold - Payment Research',
            status_key = 'hold_payment_research',
            notes = CASE 
              WHEN notes IS NULL OR notes = '' THEN $1
              ELSE notes || E'\\n' || $1
            END,
            last_modified = NOW()
          WHERE LOWER(full_name) = LOWER($2)
          RETURNING patient_id, full_name as patient_name`;


        const result = await pool.query(updateQuery, [noteEntry, patientName]);


        if (result.rows.length > 0) {
          console.log('[Healthie Webhooks] ✅ Patient status updated to Hold - Payment Research:', {

            patientId: result.rows[0].patient_id,
            patientName: result.rows[0].patient_name
          });
        } else {
          console.log('[Healthie Webhooks] ⚠️ Could not find patient to update:', { patientId, patientName });
        }

        await pool.end();
      } catch (dbError) {
        console.error('[Healthie Webhooks] ❌ Failed to update patient status:', dbError);
      }

      // 📱 SEND CHAT TO PATIENT with payment update info
      try {
        const healthiePatient = await fetchHealthiePatient(patientId);

        // CRITICAL: Only message ACTIVE patients (not archived)
        if (healthiePatient && healthiePatient.active === false) {
          console.log('[Healthie Webhooks] ⚠️ Patient is ARCHIVED in Healthie - skipping chat:', patientName);
        } else if (healthiePatient) {
          const firstName = healthiePatient.first_name || patientName.split(' ')[0];
          const groupName = healthiePatient.active_group_membership?.group?.name || '';

          // Determine clinic based on group
          let clinicName = 'NOW Optimal';
          let clinicPhone = '928-277-0001';  // Default phone
          if (groupName.toLowerCase().includes('men')) {
            clinicName = 'NOW Mens Health';
            clinicPhone = '928-212-2772';  // Men's Health phone
          } else if (groupName.toLowerCase().includes('primary')) {
            clinicName = 'NOW Primary Care';
          }

          // Healthie patient portal for updating payment card
          const paymentPortalUrl = 'https://secureclient.gethealthie.com/users/sign_in';

          const chatMessage = `Hi ${firstName}, we noticed your ${clinicName} payment didn't go through. Please update your card here: ${paymentPortalUrl} (Log in → Settings ⚙️ → Update Payment Cards). Questions? Call ${clinicPhone}. Thank you!`;

          // Use Healthie Chat (in-app messaging) instead of SMS
          await sendHealthieChat(patientId, chatMessage);
          console.log('[Healthie Webhooks] 💬 Payment update chat sent via Healthie to:', firstName);
        } else {
          console.log('[Healthie Webhooks] ⚠️ Patient not found in Healthie:', patientId);
        }
      } catch (smsError) {
        console.error('[Healthie Webhooks] ❌ Failed to send SMS:', smsError);
      }

      console.log('[Healthie Webhooks] ⚠️ DECLINED PAYMENT ALERT SENT:', { patientName, amount, status });
    }

    // ✅ SUCCESSFUL PAYMENT - Reactivate patient if they were on hold
    if (isSuccessfulPayment(status)) {
      const now = new Date();
      const timestamp = now.toLocaleString('en-US', {
        month: '2-digit', day: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      });

      const reactivated = await reactivatePatient(patientName, timestamp);
      if (reactivated) {
        // Send Telegram notification about reactivation
        await sendTelegramAlert(`✅ <b>PAYMENT RECEIVED</b>\n\n<b>Patient:</b> ${patientName}\n<b>Amount:</b> $${amount} ${currency}\n\n✅ Patient auto-reactivated from Hold - Payment Research.`);

        // 📱 SEND THANK YOU SMS TO PATIENT (only on reactivation)
        try {
          const healthiePatient = await fetchHealthiePatient(patientId);

          // CRITICAL: Only message ACTIVE patients (not archived)
          if (healthiePatient && healthiePatient.active === false) {
            console.log('[Healthie Webhooks] ⚠️ Patient is ARCHIVED in Healthie - skipping thank you chat:', patientName);
          } else if (healthiePatient) {
            const firstName = healthiePatient.first_name || patientName.split(' ')[0];
            const groupName = healthiePatient.active_group_membership?.group?.name || '';

            let clinicName = 'NOW Optimal';
            if (groupName.toLowerCase().includes('men')) {
              clinicName = 'NOW Mens Health';
            } else if (groupName.toLowerCase().includes('primary')) {
              clinicName = 'NOW Primary Care';
            }

            const thankYouMsg = `Hi ${firstName}, thank you! Your ${clinicName} payment has been received. We appreciate you! - NOW Optimal`;

            // Use Healthie Chat (in-app messaging) instead of SMS
            await sendHealthieChat(patientId, thankYouMsg);
            console.log('[Healthie Webhooks] 💬 Thank you chat sent via Healthie to:', firstName);
          }
        } catch (smsError) {
          console.error('[Healthie Webhooks] ❌ Failed to send thank you SMS:', smsError);
        }
      }
    }



    // Regular Google Chat notification for all payment events
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
            { key: 'Changed Fields', value: Array.isArray(event.changed_fields) ? event.changed_fields.join(', ') : String(event.changed_fields ?? 'n/a') },
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

  // 🔔 SCHEDULED PAYMENT EVENTS (recurring subscription failures) - THIS WAS MISSING!
  if (event.event_type?.startsWith('scheduled_payment.') ||
    event.event_type?.includes('subscription') ||
    event.event_type?.includes('recurring')) {

    const payload = (event.raw_payload ?? {}) as Record<string, any>;
    const resource = payload.resource || payload;

    // Healthie recurring_payment webhooks often have EMPTY payloads (only resource_id).
    // We MUST fetch the full payment details from the API.
    let patientName = 'Unknown patient';
    let patientId: string | undefined;
    let failureReason = 'Unknown reason';
    let amount: string | number = 'unknown';
    let status = event.event_type?.split('.')[1] || 'unknown';

    // Try to get data from webhook payload first
    const client = resource.client || resource.user || resource.patient || payload.client || payload.user || {};
    if (client.full_name || client.first_name) {
      patientName = client.full_name || client.name ||
        `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Unknown patient';
      patientId = client.id || resource.client_id || resource.user_id || payload.client_id;
      failureReason = resource.failure_reason || resource.error_message ||
        payload.failure_reason || payload.error || 'Unknown reason';
      amount = resource.amount || resource.amount_cents || payload.amount || 'unknown';
      status = resource.status || resource.state || payload.status || status;
    }

    // If payload is empty (typical for recurring_payment events), fetch from API
    if (patientName === 'Unknown patient' && event.resource_id) {
      console.log('[Healthie Webhooks] 🔍 Fetching recurring payment details from API for:', event.resource_id);
      const paymentDetails = await fetchRecurringPayment(event.resource_id);
      if (paymentDetails) {
        const sender = paymentDetails.sender;
        if (sender) {
          patientName = `${sender.first_name || ''} ${sender.last_name || ''}`.trim() || 'Unknown patient';
          patientId = sender.id;
        }
        status = paymentDetails.status || status;
        amount = paymentDetails.amount_paid_in_cents
          ? (Number(paymentDetails.amount_paid_in_cents) / 100).toFixed(2)
          : 'unknown';
        failureReason = paymentDetails.notes || status;
        console.log('[Healthie Webhooks] 📋 Payment details:', { patientName, patientId, status, amount });
      } else {
        console.log('[Healthie Webhooks] ⚠️ Could not fetch payment details from API');
      }
    }

    // SKIP PROVIDERS - these are not patients
    const PROVIDER_HEALTHIE_IDS = [
      '12093125', // Aaron Whitten, DO (Men's Health provider)
      '12088269', // Phil Schafer, NP (Primary Care provider)
    ];
    if (patientId && PROVIDER_HEALTHIE_IDS.includes(String(patientId))) {
      console.log(`[Webhook] ⏭️ Skipping provider payment event: ${patientName} (${patientId})`);
      return 'skipped_provider' as const;
    }

    // Check if this is a failure event
    const isFailure = event.event_type?.includes('failed') ||
      event.event_type?.includes('declined') ||
      isDeclinedPayment(status) ||
      failureReason.toLowerCase().includes('insufficient') ||
      failureReason.toLowerCase().includes('declined');

    if (isFailure) {
      const now = new Date();
      const timestamp = now.toLocaleString('en-US', {
        month: '2-digit', day: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      });

      // CHECK FOR RECENT SUCCESSFUL PAYMENT before alerting/updating
      // If patient has paid recently (after this failure), don't alert
      let hasRecentPayment = false;
      try {
        const apiKey = process.env.HEALTHIE_API_KEY;
        const apiUrl = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';

        // Check for recent successful payments from this patient
        const checkQuery = `
          query CheckRecentPayments {
            billingItems(page_size: 5) {
              state sender { id } created_at
            }
          }
        `;

        const checkResp = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + apiKey,
            'AuthorizationSource': 'API'
          },
          body: JSON.stringify({ query: checkQuery })
        });

        const checkResult = await checkResp.json();
        const recentItems = checkResult.data?.billingItems || [];

        // Find most recent payment from this patient
        const patientPayments = recentItems
          .filter((item: any) => item.sender?.id === patientId)
          .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        if (patientPayments.length > 0) {
          const latest = patientPayments[0];
          const latestState = (latest.state || '').toLowerCase();
          if (latestState === 'paid' || latestState === 'succeeded' || latestState === 'completed') {
            hasRecentPayment = true;
            console.log(`[Healthie Webhooks] ⏭️ Patient ${patientName} has recent successful payment - skipping alert`);
          }
        }
      } catch (checkErr) {
        console.error('[Healthie Webhooks] ⚠️ Error checking recent payments:', checkErr);
        // Continue with alert on error (fail safe to alert)
      }

      // ONLY ALERT AND UPDATE IF NO RECENT PAYMENT
      if (!hasRecentPayment) {
        const alertMessage = `🚨 <b>SCHEDULED PAYMENT FAILED</b>

<b>Patient:</b> ${patientName}
<b>Patient ID:</b> ${patientId || 'unknown'}
<b>Failure Reason:</b> ${failureReason}
<b>Amount:</b> $${amount}
<b>Event:</b> ${event.event_type}
<b>Resource ID:</b> ${event.resource_id}

⚠️ Patient Status changed to Hold - Payment Research.`;

        // Send to Telegram
        await sendTelegramAlert(alertMessage);

        // Send to Google Spaces
        await sendChatMessage(process.env.GOOGLE_CHAT_WEBHOOK_OPS_BILLING, {
          text: `🚨 SCHEDULED PAYMENT FAILED - ${patientName}`,
          cardSections: [
            {
              header: '⚠️ Recurring Payment Failed - Action Required',
              items: [
                { key: 'Patient', value: patientName },
                { key: 'Patient ID', value: patientId || 'unknown' },
                { key: 'Failure Reason', value: failureReason },
                { key: 'Amount', value: `$${amount}` },
                { key: 'Event Type', value: event.event_type },
                { key: 'Resource ID', value: event.resource_id },
              ],
            },
          ],
        });

        // Update patient status in database - USE healthie_clients TABLE (canonical)
        try {
          const { Pool } = await import('pg');
          const pool = new Pool({
            host: process.env.DATABASE_HOST,
            port: Number(process.env.DATABASE_PORT || 5432),
            database: process.env.DATABASE_NAME,
            user: process.env.DATABASE_USER,
            password: process.env.DATABASE_PASSWORD,
            ssl: { rejectUnauthorized: false }
          });

          const noteEntry = `[${timestamp}] SCHEDULED PAYMENT FAILED - ${failureReason}. Auto-set to Hold - Payment Research.`;

          // Use healthie_clients table (canonical source) for matching
          const result = await pool.query(`
            UPDATE patients p
            SET 
              alert_status = 'Hold - Payment Research',
              status_key = 'hold_payment_research',
              notes = CASE 
                WHEN p.notes IS NULL OR p.notes = '' THEN $1
                ELSE p.notes || E'\n' || $1
              END,
              last_modified = NOW()
            FROM healthie_clients hc
            WHERE hc.patient_id::text = p.patient_id::text
              AND hc.healthie_client_id = $2
              AND hc.is_active = TRUE
              AND p.status_key NOT IN ('hold_payment_research', 'inactive')
            RETURNING p.patient_id, p.full_name as patient_name
          `, [noteEntry, patientId]);

          // Fallback to name match if no healthie_clients match
          if (result.rowCount === 0 && patientName !== 'Unknown patient') {
            await pool.query(`
              UPDATE patients 
              SET 
                alert_status = 'Hold - Payment Research',
                status_key = 'hold_payment_research',
                notes = CASE 
                  WHEN notes IS NULL OR notes = '' THEN $1
                  ELSE notes || E'\n' || $1
                END,
                last_modified = NOW()
              WHERE LOWER(full_name) = LOWER($2)
                AND status_key NOT IN ('hold_payment_research', 'inactive')
            `, [noteEntry, patientName]);
          }

          await pool.end();
          console.log('[Healthie Webhooks] ✅ Patient status updated to Hold - Payment Research');
        } catch (dbError) {
          console.error('[Healthie Webhooks] ❌ Failed to update patient status:', dbError);
        }

        // Send SMS to patient via Healthie (appears from their provider)
        if (patientId) {
          try {
            const healthiePatient = await fetchHealthiePatient(patientId);

            // CRITICAL: Only message ACTIVE patients (not archived)
            if (healthiePatient && healthiePatient.active === false) {
              console.log('[Healthie Webhooks] ⚠️ Patient is ARCHIVED in Healthie - skipping scheduled payment chat:', patientName);
            } else if (healthiePatient) {
              const firstName = healthiePatient.first_name || patientName.split(' ')[0];
              const groupName = healthiePatient.active_group_membership?.group?.name || '';

              let clinicName = 'NOW Optimal';
              let clinicPhone = '928-277-0001';  // Default phone
              if (groupName.toLowerCase().includes('men')) {
                clinicName = 'NOW Mens Health';
                clinicPhone = '928-212-2772';  // Men's Health phone
              } else if (groupName.toLowerCase().includes('primary')) {
                clinicName = 'NOW Primary Care';
              }

              // Healthie patient portal for updating payment card
              const paymentPortalUrl = 'https://secureclient.gethealthie.com/users/sign_in';

              const chatMessage = `Hi ${firstName}, we noticed your ${clinicName} subscription payment didn't go through. Please update your card here: ${paymentPortalUrl} (Log in → Settings ⚙️ → Update Payment Cards). Questions? Call ${clinicPhone}. Thank you!`;

              // Use Healthie Chat (in-app messaging)
              const chatSent = await sendHealthieChat(patientId, chatMessage);
              if (chatSent) {
                console.log('[Healthie Webhooks] 💬 Payment chat sent via Healthie to:', firstName);
              } else {
                console.log('[Healthie Webhooks] ⚠️ Healthie chat failed to:', firstName);
              }
            }
          } catch (smsError) {
            console.error('[Healthie Webhooks] ❌ Failed to send SMS:', smsError);
          }
        }

        console.log('[Healthie Webhooks] ⚠️ SCHEDULED PAYMENT FAILED ALERT SENT:', { patientName, amount, failureReason });
      }

      console.log('Scheduled payment event processed', {
        id: event.id,
        event_type: event.event_type,
        resource_id: event.resource_id,
        patient: patientName,
        isFailure,
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

  // Catch-all: acknowledge unhandled event types
  console.log('Skipping (ack) unhandled Healthie webhook event type', {
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
