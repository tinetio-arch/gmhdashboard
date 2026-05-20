/**
 * iPad Per-Task Chat Proxy (Wave 3a UI hook)
 *
 * Cookie-authed wrapper around the dispatch-mcp `inbox_chat_*` tools so the
 * iPad's Today page can render + post to a row's chat_thread without exposing
 * the basic-auth `/agents/api/call` gateway.
 *
 * GET  /api/ipad/chat?staff_task_id=N
 *   → { success, row_uuid|null, thread:[entry,...], task_title }
 *   Resolves the inbox row JSON by scanning ~/.claude/coord/inbox/*.json for
 *   one with `staff_task_id == N`. Returns chat_thread newest-first (limit 50).
 *
 * POST /api/ipad/chat   body: { staff_task_id, body }
 *   → { success, entry, thread_length, dm_status }
 *   Derives from_slug from the authenticated user's email, then calls
 *   dispatch-mcp HTTP on 127.0.0.1:3010 with `inbox_chat_send`.
 *
 * Cache: 30s in-memory staff_task_id → row_uuid map (re-scan on miss).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const INBOX_DIR = process.env.DISPATCH_INBOX_DIR || '/home/ec2-user/.claude/coord/inbox';
const MCP_URL = process.env.DISPATCH_MCP_URL || 'http://127.0.0.1:3010/api/call';

// staff email → dispatch-mcp staff slug (matches ~/.claude/coord/staff.json).
const EMAIL_TO_SLUG: Record<string, string> = {
  'admin@nowoptimal.com': 'phil',
  'hannah@nowoptimal.com': 'hannah',
  'michele@nowoptimal.com': 'michelle',          // spelled 'Michele' in DB; slug = 'michelle'
  'drwhitten@tricitymenshealth.com': 'whitten',
  'audrey@nowoptimal.com': 'audrey',
};

interface InboxRowSummary {
  task_id: string;
  staff_task_id?: number | null;
  task?: string;
  title?: string;
  chat_thread?: any[];
}

let _scanCache: { at: number; byStaffTaskId: Map<number, InboxRowSummary> } | null = null;
const CACHE_TTL_MS = 30 * 1000;

async function scanInbox(): Promise<Map<number, InboxRowSummary>> {
  const now = Date.now();
  if (_scanCache && now - _scanCache.at < CACHE_TTL_MS) return _scanCache.byStaffTaskId;
  const out = new Map<number, InboxRowSummary>();
  let files: string[] = [];
  try { files = await fs.readdir(INBOX_DIR); }
  catch (e) {
    console.warn('[/api/ipad/chat] inbox dir not readable:', INBOX_DIR, e);
    _scanCache = { at: now, byStaffTaskId: out };
    return out;
  }
  await Promise.all(files.filter(f => f.endsWith('.json')).map(async (f) => {
    try {
      const raw = await fs.readFile(path.join(INBOX_DIR, f), 'utf8');
      const row = JSON.parse(raw) as InboxRowSummary;
      if (row && typeof row.staff_task_id === 'number') out.set(row.staff_task_id, row);
    } catch { /* skip malformed/partial-write */ }
  }));
  _scanCache = { at: now, byStaffTaskId: out };
  return out;
}

async function resolveRowByStaffTaskId(staffTaskId: number): Promise<InboxRowSummary | null> {
  const map = await scanInbox();
  if (map.has(staffTaskId)) return map.get(staffTaskId)!;
  // Bust cache + retry once in case the inbox was just synced.
  _scanCache = null;
  const fresh = await scanInbox();
  return fresh.get(staffTaskId) ?? null;
}

async function readRowFresh(rowUuid: string): Promise<InboxRowSummary | null> {
  if (!rowUuid || rowUuid.includes('/') || rowUuid.includes('..')) return null;
  try {
    const raw = await fs.readFile(path.join(INBOX_DIR, rowUuid + '.json'), 'utf8');
    return JSON.parse(raw) as InboxRowSummary;
  } catch { return null; }
}

export async function GET(request: NextRequest) {
  let userEmail = '';
  try {
    const user = await requireApiUser(request, 'read');
    userEmail = (user as any).email || '';
  } catch (error) {
    if (error instanceof UnauthorizedError)
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    throw error;
  }

  const staffTaskIdRaw = request.nextUrl.searchParams.get('staff_task_id');
  const staffTaskId = staffTaskIdRaw ? parseInt(staffTaskIdRaw, 10) : NaN;
  if (!Number.isFinite(staffTaskId)) {
    return NextResponse.json({ success: false, error: 'staff_task_id required' }, { status: 400 });
  }

  try {
    const row = await resolveRowByStaffTaskId(staffTaskId);
    if (!row) {
      return NextResponse.json({
        success: true,
        row_uuid: null,
        thread: [],
        task_title: null,
        current_user_slug: EMAIL_TO_SLUG[userEmail] || null,
        note: 'No synced inbox row yet — chat will appear after next sync_staff_tasks tick',
      });
    }
    // Always re-read the file so we see in-flight chat writes that occurred
    // after the cache populated.
    const fresh = await readRowFresh(row.task_id) || row;
    const thread = Array.isArray(fresh.chat_thread) ? [...fresh.chat_thread].reverse().slice(0, 50) : [];
    return NextResponse.json({
      success: true,
      row_uuid: fresh.task_id,
      thread,
      task_title: fresh.title || fresh.task || null,
      current_user_slug: EMAIL_TO_SLUG[userEmail] || null,
    });
  } catch (e: any) {
    console.error('[/api/ipad/chat GET] error:', e);
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let userEmail = '';
  try {
    const user = await requireApiUser(request, 'write');
    userEmail = (user as any).email || '';
  } catch (error) {
    if (error instanceof UnauthorizedError)
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    throw error;
  }

  let body: any;
  try { body = await request.json(); } catch { body = {}; }
  const staffTaskId = parseInt(String(body.staff_task_id ?? ''), 10);
  const message = String(body.body ?? '').trim();
  if (!Number.isFinite(staffTaskId)) {
    return NextResponse.json({ success: false, error: 'staff_task_id required' }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ success: false, error: 'body required' }, { status: 400 });
  }
  if (message.length > 8000) {
    return NextResponse.json({ success: false, error: 'message too long (8000 max)' }, { status: 400 });
  }

  const fromSlug = EMAIL_TO_SLUG[userEmail];
  if (!fromSlug) {
    return NextResponse.json({ success: false, error: `No staff slug mapped for ${userEmail}` }, { status: 403 });
  }

  const row = await resolveRowByStaffTaskId(staffTaskId);
  if (!row) {
    return NextResponse.json({ success: false, error: 'No inbox row synced for this task yet — try again in a minute' }, { status: 404 });
  }

  // Call dispatch-mcp on localhost (no basic auth needed inside the box).
  try {
    const mcpRes = await fetch(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'inbox_chat_send',
        args: { row_uuid: row.task_id, body: message, from_slug: fromSlug },
      }),
      // 10s timeout via AbortSignal
      signal: (AbortSignal as any).timeout ? (AbortSignal as any).timeout(10000) : undefined,
    });
    const txt = await mcpRes.text();
    let data: any = {};
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    if (!mcpRes.ok || data.ok === false) {
      console.error('[/api/ipad/chat POST] MCP error', mcpRes.status, txt);
      return NextResponse.json({ success: false, error: data.error || `MCP HTTP ${mcpRes.status}` }, { status: 502 });
    }
    // Bust cache so the next GET pulls a fresh chat_thread.
    _scanCache = null;
    const result = data.result || {};
    return NextResponse.json({
      success: true,
      entry: result.entry,
      thread_length: result.thread_length,
      dm_status: result.chat_dm?.status,
      from_slug: fromSlug,
      row_uuid: row.task_id,
    });
  } catch (e: any) {
    console.error('[/api/ipad/chat POST] dispatch-mcp call failed:', e);
    return NextResponse.json({ success: false, error: 'Failed to reach dispatch-mcp' }, { status: 502 });
  }
}
