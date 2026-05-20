import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { verifyGoogleChatRequest } from '@/lib/googleChatAuth';

/**
 * Google Chat inbound webhook — wave3a chat-thread backend.
 *
 * Flow:
 *   0. Verify the Google-signed Bearer JWT (see lib/googleChatAuth.ts).
 *      Unauthenticated / unverifiable requests are rejected before any work.
 *   1. Google Chat POSTs an event { type, user, space, message, ... }
 *   2. We extract user.name → google_chat_id → staff slug (via staff.json).
 *   3. We extract a [Task: <uuid>] tag from message.text, OR fall back to
 *      a recent space→row mapping in chat-task-routing.json. The row_uuid
 *      must match the safe task_id charset or the event is treated as orphan.
 *   4. We fire-and-forget a POST to dispatch-mcp /api/call inbox_chat_append.
 *   5. No-task or no-staff events go to chat-orphan-messages.log for review.
 *      Message bodies are NEVER written to that log (PHI-at-rest); we record
 *      only metadata + a redaction marker.
 *
 * Once a request is authenticated we return 200 for handled/ignored/orphan
 * outcomes (Google Chat retries on non-2xx and we don't want dispatch-mcp
 * downtime to block patient-facing replies). Authentication failures, by
 * contrast, return 401/503 — Google's legitimately-signed retries will pass.
 *
 * FIX(2026-05-20): wave3b — implemented Google JWT verification (was an
 *   unauthenticated public write endpoint), added UUID validation on the
 *   task tag, and stopped logging PHI message bodies to the orphan log.
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

// Validate the [Task:] target before forwarding it to dispatch-mcp as a
// row_uuid. dispatch-mcp task_ids are NOT canonical UUIDs — they look like
// "20260519-224757-1a7b" (YYYYMMDD-HHMMSS-<hex>) or the on-disk underscore
// form "1_20260519_133846_781123". So we use a conservative character
// allowlist that admits every legitimate task_id while blocking the real
// injection vector (path traversal / metacharacters). dispatch-mcp's own
// _row_path() additionally rejects "/" and ".." server-side — this is
// defense-in-depth at the trust boundary.
const TASK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function isValidTaskId(s: string | null | undefined): s is string {
  return typeof s === 'string' && TASK_ID_RE.test(s);
}

function extractTaskUuid(text: string | undefined): string | null {
  if (!text) return null;
  // [Task: <task_id>] — must match the safe task_id charset, else rejected.
  const m = text.match(/\[Task:\s*([^\]]+?)\s*\]/i);
  if (!m) return null;
  const candidate = m[1].trim();
  return isValidTaskId(candidate) ? candidate : null;
}

// Redact a Chat event for orphan logging. We keep routing/diagnostic metadata
// but NEVER persist the message body (potential PHI) to disk.
function redactEvent(event: ChatEvent): Record<string, unknown> {
  const text = event?.message?.text;
  return {
    type: event?.type ?? null,
    user: event?.user?.name ?? null,
    space: event?.space?.name ?? null,
    message_id: event?.message?.name ?? null,
    message_createTime: event?.message?.createTime ?? null,
    body_redacted: true,
    body_len: typeof text === 'string' ? text.length : 0,
  };
}

async function appendOrphan(event: ChatEvent, reason: string): Promise<void> {
  try {
    await fs.mkdir(COORD_HOME, { recursive: true });
    const line = JSON.stringify({
      at: new Date().toISOString(),
      reason,
      event: redactEvent(event),
    }) + '\n';
    await fs.appendFile(ORPHAN_LOG, line, { encoding: 'utf8', mode: 0o600 });
    // Best-effort: tighten perms in case the file pre-existed with looser mode.
    await fs.chmod(ORPHAN_LOG, 0o600).catch(() => {});
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
  // Security gate (wave3b): verify the Google-signed Bearer JWT before any
  // parsing, identity resolution, or dispatch write. Reject on failure.
  const auth = await verifyGoogleChatRequest(request);
  if (!auth.ok) {
    console.error(`[chat-webhook] rejected request: ${auth.reason}`);
    return NextResponse.json({ error: 'unauthorized' }, { status: auth.status });
  }

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
    const cached = routing[spaceName]?.row_uuid;
    // Only trust a space-cache hit if it carries a valid task_id.
    if (isValidTaskId(cached)) {
      rowUuid = cached;
      routingSource = 'space-cache';
    }
  }

  if (!rowUuid) {
    await appendOrphan(body, `no valid [Task:] uuid and no space-cache hit for space=${spaceName}`);
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
