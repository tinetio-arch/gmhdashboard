/**
 * GHL Inbound SMS Auto-Reply — appointment-booking intent.
 *
 * When a patient texts an inbound SMS into a clinic GHL sub-account, classify
 * whether they're asking to book an appointment. If yes (and guards pass),
 * reply with the brand-appropriate Healthie booking link.
 *
 * Feature is gated by env `GHL_AUTO_BOOKING_ENABLED=true`. Default OFF so
 * deploying the code does not immediately start auto-texting patients.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { query } from '@/lib/db';
import {
  createGHLClientForMensHealth,
  createGHLClientForPrimaryCare,
  createGHLClientForABXTAC,
} from '@/lib/ghl';

const bedrock = new BedrockRuntimeClient({ region: 'us-east-2' });
const HAIKU_MODEL = 'us.anthropic.claude-3-5-haiku-20241022-v1:0';

export const AUTO_REPLY_SENDER_NAME = 'Auto-Booking Assistant';
export const AUTO_REPLY_SENDER_EMAIL = 'auto-booking@gmh.local';

const BOOKING_URLS: Record<string, string> = {
  mensHealth: 'https://nowmenshealth.care/book',
  primaryCare: 'https://nowprimary.care/book',
  abxtac: 'https://abxtac.com/booking',
};

const CLIENT_FACTORIES: Record<string, () => ReturnType<typeof createGHLClientForMensHealth>> = {
  mensHealth: createGHLClientForMensHealth,
  primaryCare: createGHLClientForPrimaryCare,
  abxtac: createGHLClientForABXTAC,
};

const BRAND_LABEL: Record<string, string> = {
  mensHealth: 'NOW Men’s Health',
  primaryCare: 'NOW Primary Care',
  abxtac: 'ABX TAC',
};

// Guard windows (ms)
const AUTO_REPLY_COOLDOWN_MS = 24 * 60 * 60 * 1000;   // 24h: don't auto-reply twice in same convo
const STAFF_REPLY_BACKOFF_MS = 30 * 60 * 1000;        // 30m: skip if staff replied recently

export function isAutoBookingEnabled(): boolean {
  return process.env.GHL_AUTO_BOOKING_ENABLED === 'true';
}

export function getBookingUrlForAccount(accountKey: string): string | null {
  return BOOKING_URLS[accountKey] || null;
}

/**
 * Ask Claude Haiku whether the message is the patient asking to book an
 * appointment. Returns true only on a confident yes — false on ambiguity,
 * model error, or "I already have an appointment tomorrow" style content.
 */
export async function classifyAppointmentIntent(messageBody: string): Promise<boolean> {
  const trimmed = (messageBody || '').trim();
  if (trimmed.length < 4) return false;

  const prompt = `You classify inbound SMS messages from patients to a medical clinic.

Decide if the patient is ASKING TO SCHEDULE OR BOOK A NEW APPOINTMENT right now.

Reply YES only when the message is a clear request to book, schedule, or come in. Examples of YES:
- "Can I get an appointment?"
- "I'd like to schedule a visit"
- "When can I come in?"
- "Need to book a TRT consult"
- "Want to set up a time"

Reply NO for everything else, including:
- Confirming, canceling, or rescheduling an EXISTING appointment ("I'll be there Tuesday", "need to cancel my appt")
- Asking about hours, pricing, services, lab results, prescriptions, refills, side effects
- Greetings, thank-yous, complaints, or general questions

Message: """${trimmed.substring(0, 2000)}"""

Respond with one word only: YES or NO.`;

  try {
    const command = new InvokeModelCommand({
      modelId: HAIKU_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const resp = await bedrock.send(command);
    const parsed = JSON.parse(new TextDecoder().decode(resp.body));
    const text = (parsed?.content?.[0]?.text || '').trim().toUpperCase();
    return text.startsWith('YES');
  } catch (err) {
    console.warn('[GHL-AUTO] Haiku classify failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Guards against double-replies and stepping on a live staff conversation.
 * Returns the reason to skip, or null if it's safe to auto-reply.
 */
export async function autoReplySkipReason(
  conversationId: string,
  contactId: string
): Promise<string | null> {
  if (!contactId) return 'missing_contact_id';

  // 1. Did we (the assistant) already auto-reply in the last 24h in this conversation?
  const recentAuto = await query<{ id: number }>(
    `SELECT id FROM ghl_messages
       WHERE contact_id = $1
         AND direction = 'outbound'
         AND sent_by_email = $2
         AND received_at > NOW() - ($3::int * INTERVAL '1 millisecond')
       LIMIT 1`,
    [contactId, AUTO_REPLY_SENDER_EMAIL, AUTO_REPLY_COOLDOWN_MS]
  );
  if (recentAuto.length > 0) return 'recent_auto_reply';

  // 2. Did a human staff member reply outbound in the last 30 min?
  //    (Outbound rows with a non-auto sender, OR with no sender attribution at all,
  //    are treated as staff — auto-reply backs off either way to avoid stepping on a live thread.)
  const recentStaff = await query<{ id: number }>(
    `SELECT id FROM ghl_messages
       WHERE contact_id = $1
         AND direction = 'outbound'
         AND (sent_by_email IS NULL OR sent_by_email <> $2)
         AND received_at > NOW() - ($3::int * INTERVAL '1 millisecond')
       LIMIT 1`,
    [contactId, AUTO_REPLY_SENDER_EMAIL, STAFF_REPLY_BACKOFF_MS]
  );
  if (recentStaff.length > 0) return 'recent_staff_reply';

  return null;
}

function buildBookingReply(accountKey: string, contactName: string | null): string | null {
  const url = BOOKING_URLS[accountKey];
  const brand = BRAND_LABEL[accountKey];
  if (!url || !brand) return null;
  const firstName = (contactName || '').trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName} — ` : '';
  return `${greeting}thanks for reaching out to ${brand}. You can book an appointment directly here: ${url}. If you need help picking a time or service, just reply and a team member will jump in.`;
}

export type AutoReplyResult =
  | { status: 'sent'; messageId: string; body: string }
  | { status: 'skipped'; reason: string };

/**
 * Top-level orchestration: classify → guard → send → log.
 * Caller passes the already-stored inbound message context.
 *
 * Never throws — failures are returned as skipped with a reason.
 */
export async function maybeSendBookingAutoReply(params: {
  accountKey: string;
  locationId: string;
  contactId: string;
  conversationId: string;
  body: string;
  contactName: string | null;
}): Promise<AutoReplyResult> {
  const { accountKey, locationId, contactId, conversationId, body, contactName } = params;

  if (!isAutoBookingEnabled()) return { status: 'skipped', reason: 'disabled' };

  const factory = CLIENT_FACTORIES[accountKey];
  if (!factory) return { status: 'skipped', reason: 'unsupported_account' };
  if (!BOOKING_URLS[accountKey]) return { status: 'skipped', reason: 'no_booking_url' };

  const guardReason = await autoReplySkipReason(conversationId, contactId);
  if (guardReason) return { status: 'skipped', reason: guardReason };

  const intent = await classifyAppointmentIntent(body);
  if (!intent) return { status: 'skipped', reason: 'no_intent' };

  const reply = buildBookingReply(accountKey, contactName);
  if (!reply) return { status: 'skipped', reason: 'no_reply_payload' };

  const client = factory();
  if (!client) return { status: 'skipped', reason: 'no_ghl_client' };

  try {
    const sent = await client.sendSms(contactId, reply);
    // Persist for audit + future cooldown checks. Account_key reuses the same
    // CHECK constraint; if the inbound passed it, the outbound will too.
    await query(
      `INSERT INTO ghl_messages (
        message_id, conversation_id, contact_id, location_id, account_key,
        direction, message_type, body,
        contact_name, contact_phone, contact_email,
        ghl_timestamp, raw_payload,
        sent_by_name, sent_by_email
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
      [
        sent.id || null,
        conversationId,
        contactId,
        locationId || '',
        accountKey,
        'outbound',
        'SMS',
        reply,
        contactName,
        null,
        null,
        new Date(),
        JSON.stringify({ source: 'ghl-auto-reply', intent: 'appointment' }),
        AUTO_REPLY_SENDER_NAME,
        AUTO_REPLY_SENDER_EMAIL,
      ]
    );
    return { status: 'sent', messageId: sent.id, body: reply };
  } catch (err) {
    console.error('[GHL-AUTO] Send failed:', err instanceof Error ? err.message : err);
    return { status: 'skipped', reason: 'send_error' };
  }
}
