/**
 * Task Attachment download — streams a file attached to a dispatch inbox task.
 *
 * Authed for BOTH surfaces via the standard session cookie (requireApiUser):
 *   - iPad "My Tasks"  (gmh_session_v2 cookie)
 *   - /agents dashboard (same cookie, served on the same domain)
 *
 * GET /api/ipad/task-attachment?row=<row_uuid>&name=<filename>
 *
 * The attachment files live in the dispatch coord store on this box
 * (~/.claude/coord/task-attachments/<row_uuid>/<name>), recorded on the inbox
 * row's `attachments` array by the dispatch-mcp inbox_attach_file tool.
 * `name` is validated against that array (NO path traversal) before streaming.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COORD = path.join(os.homedir(), '.claude', 'coord');
const INBOX_DIR = path.join(COORD, 'inbox');
const ATTACH_DIR = path.join(COORD, 'task-attachments');

const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Read the inbox row JSON for a row_uuid (file is usually <task_id>.json;
 * fall back to scanning by the task_id field). Returns null if not found. */
function readRow(rowUuid: string): any | null {
  const direct = path.join(INBOX_DIR, `${rowUuid}.json`);
  try {
    if (fs.existsSync(direct)) return JSON.parse(fs.readFileSync(direct, 'utf8'));
  } catch { /* fall through to scan */ }
  try {
    for (const f of fs.readdirSync(INBOX_DIR)) {
      if (!f.endsWith('.json')) continue;
      try {
        const r = JSON.parse(fs.readFileSync(path.join(INBOX_DIR, f), 'utf8'));
        if (r && r.task_id === rowUuid) return r;
      } catch { /* skip unparseable */ }
    }
  } catch { /* inbox dir unreadable */ }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request, 'read');

    const rowUuid = (request.nextUrl.searchParams.get('row') || '').trim();
    const name = (request.nextUrl.searchParams.get('name') || '').trim();
    if (!rowUuid || !name) {
      return NextResponse.json({ error: 'row and name are required' }, { status: 400 });
    }

    const row = readRow(rowUuid);
    if (!row) return NextResponse.json({ error: 'task not found' }, { status: 404 });

    // Validate `name` against the row's attachment list — the only files we
    // will ever serve. This is the path-traversal guard: an arbitrary name
    // that isn't a recorded attachment is rejected here.
    const attachments = Array.isArray(row.attachments) ? row.attachments : [];
    const match = attachments.find((a: any) => a && a.name === name);
    if (!match) return NextResponse.json({ error: 'attachment not found' }, { status: 404 });

    // Resolve and confine to the row's attachment directory.
    const dir = path.join(ATTACH_DIR, rowUuid);
    const resolved = path.resolve(dir, name);
    if (path.dirname(resolved) !== path.resolve(dir) || !fs.existsSync(resolved)) {
      return NextResponse.json({ error: 'file missing' }, { status: 404 });
    }

    const data = fs.readFileSync(resolved);
    const ext = path.extname(name).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
    const safeName = name.replace(/["\r\n]/g, '');

    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${safeName}"`,
        'Content-Length': String(data.length),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error: any) {
    if (error?.status === 401) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Task Attachment] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
