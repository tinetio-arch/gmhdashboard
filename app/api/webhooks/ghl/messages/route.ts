import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  createGHLClientForMensHealth,
  createGHLClientForPrimaryCare,
  createGHLClientForABXTAC,
  createGHLClientForLongevity,
} from '@/lib/ghl';
import { maybeSendBookingAutoReply, isAutoBookingEnabled } from '@/lib/ghl-auto-reply';

/**
 * Location ID → account key mapping.
 */
const LOCATION_MAP: Record<string, string> = {
  '0dpAFAovcFXbe0G5TUFr': 'mensHealth',
  'NyfcCiwUMdmXafnUMML8': 'primaryCare',
  'OyC2MESFDP3Pxm10tECz': 'abxtac',
};

const CLIENT_FACTORIES: Record<string, () => ReturnType<typeof createGHLClientForMensHealth>> = {
  mensHealth: createGHLClientForMensHealth,
  primaryCare: createGHLClientForPrimaryCare,
  abxtac: createGHLClientForABXTAC,
  longevity: createGHLClientForLongevity,
};

function normalizeMessageType(raw: string | undefined): string {
  if (!raw) return 'Other';
  const cleaned = raw.replace('TYPE_', '').trim();
  const map: Record<string, string> = {
    'sms': 'SMS', 'email': 'Email', 'call': 'Call', 'voicemail': 'Voicemail',
    'fb': 'FB', 'ig': 'IG', 'whatsapp': 'WhatsApp', 'gmb': 'GMB', 'live_chat': 'Live_Chat',
  };
  return map[cleaned.toLowerCase()] || 'Other';
}

/**
 * POST /api/webhooks/ghl/messages
 *
 * Receives message webhooks from GHL Workflows.
 * Enriches missing data (body, contact name) via GHL API when merge fields don't resolve.
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const secretParam = searchParams.get('secret');
    const secretHeader = request.headers.get('x-ghl-webhook-secret');
    const expectedSecret = process.env.GHL_WEBHOOK_SECRET;

    if (expectedSecret && secretParam !== expectedSecret && secretHeader !== expectedSecret) {
      console.warn('[GHL-WH] Unauthorized webhook attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await request.json();

    // Extract fields from webhook payload
    const contactId = payload.contactId || payload.contact_id || payload.id || '';
    const locationId = payload.locationId || payload.location_id || '';
    const conversationId = payload.conversationId || payload.conversation_id || '';
    const messageId = payload.messageId || payload.message_id || null;
    let body = payload.body || payload.message || payload.messageBody || payload.sms_body || '';
    const direction = (payload.direction || 'inbound').toLowerCase();
    const messageType = normalizeMessageType(payload.messageType || payload.type || payload.message_type);
    const dateAdded = payload.dateAdded || payload.date_added || payload.timestamp || null;

    let contactName =
      payload.contactName || payload.contact_name || payload.full_name || payload.fullName ||
      [payload.firstName || payload.first_name, payload.lastName || payload.last_name].filter(Boolean).join(' ') ||
      null;
    let contactPhone = payload.phone || payload.contactPhone || payload.contact_phone || null;
    const contactEmail = payload.email || payload.contactEmail || payload.contact_email || null;

    // Sending staff member (outbound only). Populated once the GHL Workflow sends user
    // merge fields ({{user.name}} / {{user.email}}) on outbound-message triggers. We
    // accept a range of key spellings a workflow might use.
    const sentByName =
      payload.userName || payload.user_name || payload.user?.name ||
      payload.sentByName || payload.sent_by_name || payload.staffName || null;
    const sentByEmail =
      payload.userEmail || payload.user_email || payload.user?.email ||
      payload.sentByEmail || payload.sent_by_email || payload.staffEmail || null;

    if (!contactId) {
      console.warn('[GHL-WH] Missing contactId in payload:', JSON.stringify(payload).substring(0, 200));
      return NextResponse.json({ error: 'contactId is required' }, { status: 400 });
    }

    // Determine account key
    let accountKey = LOCATION_MAP[locationId];
    if (!accountKey) {
      accountKey = payload.account || payload.accountKey || 'mensHealth';
      console.warn(`[GHL-WH] Unknown locationId "${locationId}", defaulting to ${accountKey}`);
    }

    // ── ENRICHMENT: Fill missing data from GHL API ──
    // GHL Workflow merge fields often don't resolve, leaving body/name empty.
    // We call the GHL API to fill in the gaps.
    const needsEnrichment = !body || !contactName || contactName.trim() === '';
    if (needsEnrichment) {
      const factory = CLIENT_FACTORIES[accountKey];
      const client = factory ? factory() : null;

      if (client) {
        try {
          // Fetch contact details (name, phone, email)
          if (!contactName || contactName.trim() === '') {
            const contact = await client.getContact(contactId);
            const firstName = contact.firstName || (contact as any).first_name || '';
            const lastName = contact.lastName || (contact as any).last_name || '';
            contactName = [firstName, lastName].filter(Boolean).join(' ') || contact.name || null;
            if (!contactPhone) {
              contactPhone = contact.phone || null;
            }
          }

          // Fetch latest message body from conversation search
          if (!body) {
            const convos = await client.getRecentConversations({ limit: 5 });
            // Find the conversation for this contact
            const match = convos.find(c => c.contactId === contactId);
            if (match && match.lastMessageBody) {
              body = match.lastMessageBody;
            }
          }
        } catch (enrichErr) {
          // Don't fail the webhook if enrichment fails — store what we have
          console.warn(`[GHL-WH] Enrichment failed for ${contactId}:`, enrichErr instanceof Error ? enrichErr.message : enrichErr);
        }
      }
    }

    // Parse GHL timestamp
    let ghlTimestamp: Date | null = null;
    if (dateAdded) {
      const parsed = new Date(dateAdded);
      if (!isNaN(parsed.getTime())) ghlTimestamp = parsed;
    }

    // Deduplicate by messageId
    const normalizedDirection = direction === 'outbound' ? 'outbound' : 'inbound';
    if (messageId) {
      const existing = await query('SELECT id FROM ghl_messages WHERE message_id = $1 LIMIT 1', [messageId]);
      if (existing.length > 0) {
        return NextResponse.json({ success: true, duplicate: true });
      }
    }

    await query(
      `INSERT INTO ghl_messages (
        message_id, conversation_id, contact_id, location_id, account_key,
        direction, message_type, body,
        contact_name, contact_phone, contact_email,
        ghl_timestamp, raw_payload,
        sent_by_name, sent_by_email
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        messageId || null, conversationId, contactId, locationId, accountKey,
        normalizedDirection, messageType, body,
        contactName, contactPhone, contactEmail,
        ghlTimestamp, JSON.stringify(payload),
        normalizedDirection === 'outbound' ? sentByName : null,
        normalizedDirection === 'outbound' ? sentByEmail : null,
      ]
    );

    console.log(`[GHL-WH] Stored ${normalizedDirection} ${messageType} for ${contactName || contactPhone || contactId} (${accountKey})${body ? ' body=' + body.substring(0, 40) : ' (no body)'}`);

    // Appointment-booking auto-responder. Only fires for inbound SMS with a body
    // on a supported account, when GHL_AUTO_BOOKING_ENABLED=true. All other
    // cases short-circuit inside the helper. Wrapped so a classifier or send
    // failure can never poison the webhook response.
    if (
      isAutoBookingEnabled() &&
      normalizedDirection === 'inbound' &&
      messageType === 'SMS' &&
      body &&
      body.trim().length > 0
    ) {
      try {
        const result = await maybeSendBookingAutoReply({
          accountKey,
          locationId,
          contactId,
          conversationId,
          body,
          contactName,
        });
        console.log(`[GHL-WH] Auto-reply ${result.status}${result.status === 'skipped' ? `: ${result.reason}` : ` msg=${result.messageId}`}`);
      } catch (autoErr) {
        console.error('[GHL-WH] Auto-reply pipeline crashed:', autoErr instanceof Error ? autoErr.message : autoErr);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[GHL-WH] Failed to process webhook:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok', endpoint: 'ghl-messages-webhook' });
}
