import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/**
 * Google Chat inbound webhook — wave3a chat-thread backend.
 *
 * Flow:
 *   1. Google Chat POSTs an event { type, user, space, message, ... }
 *   2. We extract user.name → google_chat_id → staff slug (via staff.json).
 *   3. We extract a [Task: <uuid>] tag from message.text, OR fall back to
 *      a recent space→row mapping in chat-task-routing.json.
 *   4. We fire-and-forget a POST to dispatch-mcp /api/call inbox_chat_append.
 *   5. No-task or no-staff events go to chat-orphan-messages.log for review.
 *
 * We always return 200 (Google Chat retries on non-2xx and we don't want
 * dispatch-mcp downtime to block patient-facing replies).
 *
 * Security TODO (wave3b):
 *   Google Chat signs requests with a Bearer JWT issued by Workspace. We
 *   should verify the JWT's audience matches our project_id, the iss is
 *   `chat@system.gserviceaccount.com`, and the email_verified flag is set.
 *   For now we accept any POST and rely on the fact that the URL is
 *   non-guessable + only Google's IPs can reach the endpoint behind nginx.
 */

const COORD_HOME = path.join(os.homedir(), '.claude', 'coord');
const STAFF_FILE = path.join(COORD_HOME, 'staff.json');
const ROUTING_FILE = path.join(COORD_HOME, 'chat-task-routing.json');
const ORPHAN_LOG = path.join(COORD_HOME, 'chat-orphan-messages.log');
const DISPATCH_URL = 'http://127.0.0.1:3010/api/call';

type StaffRecord = { google_chat_id?: string | null };
type StaffMap = Record<string, StaffRecord>;

async function loadStaffMap(): Promise<StaffMap> {
  try {
    const raw = await fs.readFile(STAFF_FILE, 'utf8');
    const obj = JSON.parse(raw);
    const out: StaffMap = {};
    for (const [k, v] of Object.entries(obj)) {
      // Drop meta keys (_schema_version, _schema_changelog).
      if (k.startsWith('_')) continue;
      if (v && typeof v === 'object') {
        out[k] = v as StaffRecord;
      }
    }
    return out;
  } catch {
    return {};
  }
}

async function loadRoutingMap(): Promise<Record<string, { row_uuid?: string; at?: string }>> {
  try {
    const raw = await fs.readFile(ROUTING_FILE, 'utf8');
    return JSON.parse(raw) ?? {};
  } catch {
    return {};
  }
}

function findStaffSlug(staff: StaffMap, googleChatId: string): string | null {
  for (const [slug, rec] of Object.entries(staff)) {
    if (rec?.google_chat_id && String(rec.google_chat_id) === String(googleChatId)) {
      return slug;
    }
  }
  return null;
}

function extractTaskUuid(text: string | undefined): string | null {
  if (!text) return null;
  // [Task: <uuid>] — uuid is any non-]] sequence, trimmed.
  const m = text.match(/\[Task:\s*([^\]]+?)\s*\]/i);
  return m ? m[1].trim() : null;
}

async function appendOrphan(event: unknown, reason: string): Promise<void> {
  try {
    await fs.mkdir(COORD_HOME, { recursive: true });
    const line = JSON.stringify({
      at: new Date().toISOString(),
      reason,
      event,
    }) + '\n';
    await fs.appendFile(ORPHAN_LOG, line, 'utf8');
  } catch (err) {
    console.error('[chat-webhook] orphan log write failed:', err);
  }
}

function fireDispatch(tool: string, args: Record<string, unknown>): void {
  // Fire-and-forget. We don't await — Google Chat retries on slow responses.
  const token = process.env.DISPATCH_TOKEN || '';
  if (!token) {
    console.error('[chat-webhook] DISPATCH_TOKEN not set — cannot call dispatch-mcp');
    return;
  }
  // Use the global fetch (Node 18+). Swallow all errors.
  fetch(DISPATCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Token': token,
    },
    body: JSON.stringify({ tool, args }),
  })
    .then(async (resp) => {
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        console.error(`[chat-webhook] dispatch-mcp ${tool} non-2xx: ${resp.status} ${txt.slice(0, 200)}`);
      }
    })
    .catch((err) => {
      console.error(`[chat-webhook] dispatch-mcp ${tool} fetch failed:`, err?.message || err);
    });
}

type ChatEvent = {
  type?: string;
  user?: { name?: string; displayName?: string };
  space?: { name?: string };
  message?: { name?: string; text?: string; createTime?: string };
};

export async function POST(request: Request) {
  let body: ChatEvent = {};
  try {
    body = (await request.json()) as ChatEvent;
  } catch {
    // Malformed body — still ack to avoid Google retries.
    return NextResponse.json({ ok: true, parsed: false });
  }

  const eventType = body?.type || 'unknown';
  console.log(`[chat-webhook] event type=${eventType}`);

  // Only MESSAGE events are meaningful for our chat-thread routing.
  // Other event types (ADDED_TO_SPACE, REMOVED_FROM_SPACE, CARD_CLICKED) ack silently.
  if (eventType !== 'MESSAGE') {
    return NextResponse.json({ ok: true, handled: false, reason: `event type ${eventType} ignored` });
  }

  const userName = body?.user?.name || '';
  const googleChatId = userName.startsWith('users/') ? userName.slice('users/'.length) : userName;
  const messageText = body?.message?.text || '';
  const messageId = body?.message?.name || '';
  const spaceName = body?.space?.name || '';

  if (!googleChatId) {
    await appendOrphan(body, 'no user.name in event');
    return NextResponse.json({ ok: true, handled: false, reason: 'no user' });
  }

  // Resolve staff slug.
  const staff = await loadStaffMap();
  const slug = findStaffSlug(staff, googleChatId);
  if (!slug) {
    await appendOrphan(body, `no staff slug for google_chat_id=${googleChatId}`);
    return NextResponse.json({ ok: true, handled: false, reason: 'unknown sender' });
  }

  // Resolve row_uuid: explicit [Task: ...] tag, else space-routing fallback.
  let rowUuid = extractTaskUuid(messageText);
  let routingSource: 'tag' | 'space-cache' | 'none' = rowUuid ? 'tag' : 'none';
  if (!rowUuid && spaceName) {
    const routing = await loadRoutingMap();
    const entry = routing[spaceName];
    if (entry?.row_uuid) {
      rowUuid = entry.row_uuid;
      routingSource = 'space-cache';
    }
  }

  if (!rowUuid) {
    await appendOrphan(body, `no [Task:] tag and no space-cache hit for space=${spaceName}`);
    return NextResponse.json({ ok: true, handled: false, reason: 'no task routing' });
  }

  // Strip the [Task: <uuid>] prefix from the body so the stored thread shows
  // a clean human message. Keep original if no tag.
  const cleanedBody = routingSource === 'tag'
    ? messageText.replace(/^\s*\[Task:\s*[^\]]+\]\s*\n?/i, '').trim() || messageText
    : messageText;

  // Fire-and-forget — don't block the 200 ack.
  fireDispatch('inbox_chat_append', {
    row_uuid: rowUuid,
    from_slug: slug,
    from_surface: 'chat',
    body: cleanedBody,
    google_chat_message_id: messageId || undefined,
  });

  return NextResponse.json({
    ok: true,
    handled: true,
    row_uuid: rowUuid,
    from_slug: slug,
    routing_source: routingSource,
  });
}

export async function GET() {
  return NextResponse.json({
    service: 'dispatch-mcp-chat-webhook',
    status: 'ok',
    version: 'wave3a',
  });
}
