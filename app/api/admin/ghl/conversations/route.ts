import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query, pgTimestampToUTCISO, pgTimestampToUTCMs } from '@/lib/db';
import {
  createGHLClientForMensHealth,
  createGHLClientForPrimaryCare,
  createGHLClientForABXTAC,
  createGHLClientForLongevity,
  GHLConversation,
} from '@/lib/ghl';

type SubAccountKey = 'mensHealth' | 'primaryCare' | 'abxtac' | 'longevity';

const VALID_ACCOUNTS: SubAccountKey[] = ['mensHealth', 'primaryCare', 'abxtac', 'longevity'];


const CLIENT_FACTORIES: Record<SubAccountKey, () => ReturnType<typeof createGHLClientForMensHealth>> = {
  mensHealth: createGHLClientForMensHealth,
  primaryCare: createGHLClientForPrimaryCare,
  abxtac: createGHLClientForABXTAC,
  longevity: createGHLClientForLongevity,
};

/**
 * GET /api/admin/ghl/conversations?account=mensHealth&limit=15
 * GET /api/admin/ghl/conversations?account=mensHealth&contactId=abc123  (thread view)
 *
 * Two modes:
 *   1. No contactId → returns recent conversations (GHL search + stored messages merged)
 *   2. With contactId → returns full message thread from stored messages
 */
export async function GET(request: NextRequest) {
  await requireApiUser(request, 'read');

  try {
    const { searchParams } = new URL(request.url);
    const account = (searchParams.get('account') || 'mensHealth') as SubAccountKey;
    const limit = Math.min(parseInt(searchParams.get('limit') || '15', 10), 50);
    const contactId = searchParams.get('contactId');

    if (!VALID_ACCOUNTS.includes(account)) {
      return NextResponse.json(
        { error: `Invalid account: ${account}. Must be mensHealth, primaryCare, or abxtac` },
        { status: 400 }
      );
    }

    // Mode 2: Thread view — return all stored messages for a specific contact
    if (contactId) {
      const messages = await query<{
        id: number;
        message_id: string | null;
        conversation_id: string | null;
        contact_id: string;
        direction: string;
        message_type: string;
        body: string | null;
        contact_name: string | null;
        contact_phone: string | null;
        received_at: string;
        ghl_timestamp: string | null;
        raw_payload: unknown;
        sent_by_name: string | null;
        sent_by_email: string | null;
      }>(
        `SELECT id, message_id, conversation_id, contact_id, direction, message_type, body,
                contact_name, contact_phone, received_at, ghl_timestamp, raw_payload,
                sent_by_name, sent_by_email
         FROM ghl_messages
         WHERE account_key = $1 AND contact_id = $2
         ORDER BY received_at DESC
         LIMIT $3`,
        [account, contactId, limit]
      );

      return NextResponse.json({
        account,
        contactId,
        total: messages.length,
        messages: messages.map(m => {
          // Extract attachments from raw payload if present
          const payload = m.raw_payload as Record<string, unknown> | null;
          const attachments = (payload?.attachments as string[]) || [];
          return {
            id: m.id,
            messageId: m.message_id,
            direction: m.direction,
            messageType: m.message_type,
            body: m.body,
            contactName: m.contact_name,
            contactPhone: m.contact_phone,
            // FIX(2026-04-15): ghl_messages.received_at is `timestamp without time zone`
            // storing UTC wall-clock. Naked string would be parsed by browser as local.
            // Force UTC interpretation so the iPad's toLocaleString({ timeZone: 'America/Phoenix' })
            // produces correct Arizona time.
            timestamp: pgTimestampToUTCISO(m.ghl_timestamp || m.received_at),
            attachments,
            sentByName: m.sent_by_name,
            sentByEmail: m.sent_by_email,
          };
        }),
      });
    }

    // Mode 1: Recent conversations — merge GHL search + stored messages

    // Fetch from GHL conversations search (last message per thread)
    let ghlConversations: GHLConversation[] = [];
    const client = CLIENT_FACTORIES[account]();
    if (client) {
      try {
        ghlConversations = await client.getRecentConversations({ limit });
      } catch (e) {
        console.warn(`[API] GHL conversation search failed for ${account}:`, e);
      }
    }

    // Fetch stored messages (recent, grouped by contact)
    const storedMessages = await query<{
      contact_id: string;
      contact_name: string | null;
      contact_phone: string | null;
      direction: string;
      message_type: string;
      body: string | null;
      received_at: string;
      ghl_timestamp: string | null;
      msg_count: string;
    }>(
      `SELECT DISTINCT ON (contact_id)
              contact_id, contact_name, contact_phone,
              direction, message_type, body, received_at, ghl_timestamp,
              (SELECT count(*) FROM ghl_messages g2 WHERE g2.contact_id = g1.contact_id AND g2.account_key = $1) as msg_count
       FROM ghl_messages g1
       WHERE account_key = $1
       ORDER BY contact_id, received_at DESC`,
      [account]
    );

    // Build a map of stored messages by contactId for enrichment
    const storedMap = new Map(storedMessages.map(m => [m.contact_id, m]));

    // Map GHL conversations, enriched with stored message count
    const conversations = ghlConversations.map((c: GHLConversation) => {
      const stored = storedMap.get(c.contactId);
      return {
        id: c.id,
        contactId: c.contactId,
        contactName: c.contactName || c.fullName || c.phone || 'Unknown',
        phone: c.phone,
        lastMessageDate: c.lastMessageDate,
        lastMessageType: c.lastMessageType,
        lastMessageBody: c.lastMessageBody || null,
        lastMessageDirection: c.lastMessageDirection,
        unreadCount: c.unreadCount || 0,
        tags: c.tags || [],
        storedMessageCount: stored ? parseInt(stored.msg_count, 10) : 0,
      };
    });

    // Add any stored contacts not in the GHL results
    const ghlContactIds = new Set(ghlConversations.map(c => c.contactId));
    for (const stored of storedMessages) {
      if (!ghlContactIds.has(stored.contact_id)) {
        const ts = stored.ghl_timestamp || stored.received_at;
        conversations.push({
          id: `stored-${stored.contact_id}`,
          contactId: stored.contact_id,
          contactName: stored.contact_name || stored.contact_phone || 'Unknown',
          phone: stored.contact_phone,
          lastMessageDate: pgTimestampToUTCMs(ts),
          lastMessageType: stored.message_type ? `TYPE_${stored.message_type.toUpperCase()}` : null,
          lastMessageBody: stored.body,
          lastMessageDirection: stored.direction as 'inbound' | 'outbound',
          unreadCount: 0,
          tags: [],
          storedMessageCount: parseInt(stored.msg_count, 10),
        });
      }
    }

    // Sort by most recent message
    conversations.sort((a, b) => (b.lastMessageDate || 0) - (a.lastMessageDate || 0));

    return NextResponse.json({
      account,
      total: conversations.length,
      conversations: conversations.slice(0, limit),
    });
  } catch (error) {
    console.error('[API] Failed to fetch GHL conversations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch conversations' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/ghl/conversations
 * Send an SMS reply to a contact from the specified sub-account.
 * Also stores the sent message in the database.
 * Body: { account: string, contactId: string, message: string }
 */
export async function POST(request: NextRequest) {
  const user = await requireApiUser(request, 'write');

  try {
    const body = await request.json();
    const { account, contactId, message, contactName, contactPhone, attachments } = body as {
      account?: SubAccountKey;
      contactId?: string;
      message?: string;
      contactName?: string;
      contactPhone?: string;
      attachments?: string[];
    };

    if (!account || !VALID_ACCOUNTS.includes(account)) {
      return NextResponse.json(
        { error: 'Invalid or missing account' },
        { status: 400 }
      );
    }
    if (!contactId) {
      return NextResponse.json({ error: 'contactId is required' }, { status: 400 });
    }
    if (!message?.trim() && (!attachments || attachments.length === 0)) {
      return NextResponse.json({ error: 'message or attachments required' }, { status: 400 });
    }

    const client = CLIENT_FACTORIES[account]();
    if (!client) {
      return NextResponse.json(
        { error: `GHL client not configured for ${account}` },
        { status: 503 }
      );
    }

    const result = await client.sendSms(contactId, (message || '').trim(), attachments);
    const locationId = client.getLocationId() || '';

    // Store the sent message in DB (include attachments in raw_payload).
    // Record WHICH staff member sent it (dashboard-originated replies know the user).
    const rawPayload = attachments?.length ? JSON.stringify({ attachments }) : null;
    await query(
      `INSERT INTO ghl_messages (
        message_id, contact_id, location_id, account_key,
        direction, message_type, body,
        contact_name, contact_phone, ghl_timestamp, raw_payload,
        sent_by_name, sent_by_email
      ) VALUES ($1, $2, $3, $4, 'outbound', $5, $6, $7, $8, NOW(), $9, $10, $11)`,
      [
        result.id || null, contactId, locationId, account,
        attachments?.length ? 'SMS' : 'SMS',
        (message || '').trim(), contactName || null, contactPhone || null,
        rawPayload,
        user?.display_name || null, user?.email || null,
      ]
    );

    console.log(`[GHL] ${attachments?.length ? 'MMS' : 'SMS'} sent from ${account} to contact ${contactId}`);

    return NextResponse.json({ success: true, messageId: result.id });
  } catch (error) {
    console.error('[API] Failed to send GHL SMS:', error);
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    );
  }
}
