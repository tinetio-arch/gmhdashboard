/**
 * Staff Task Manager API
 *
 * GET    — List tasks (filter by assigned_to, status, created_by)
 * POST   — Create a new task
 * PATCH  — Update task (status, notes, assignment)
 * DELETE — Cancel a task
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';

/**
 * Additive: surface dispatch task attachments on the iPad to-do.
 * The /agents inbox (dispatch JSON store) links to a staff_tasks row via
 * row.staff_task_id. We scan the inbox once and build a map from
 * staff_task_id -> { row_uuid, attachments } for rows that carry attachments,
 * so the iPad can render openable links. Best-effort: any failure leaves the
 * existing staff_tasks response untouched.
 */
function dispatchAttachmentsByStaffTaskId(): Map<number, { row_uuid: string; attachments: any[] }> {
  const map = new Map<number, { row_uuid: string; attachments: any[] }>();
  try {
    const inboxDir = path.join(os.homedir(), '.claude', 'coord', 'inbox');
    for (const f of fs.readdirSync(inboxDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const r = JSON.parse(fs.readFileSync(path.join(inboxDir, f), 'utf8'));
        const sid = Number(r?.staff_task_id);
        const atts = Array.isArray(r?.attachments) ? r.attachments : [];
        if (sid && atts.length) map.set(sid, { row_uuid: r.task_id, attachments: atts });
      } catch { /* skip unparseable row */ }
    }
  } catch { /* inbox dir unreadable — leave map empty */ }
  return map;
}

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request, 'read');
    const assignedTo = request.nextUrl.searchParams.get('assigned_to');
    const status = request.nextUrl.searchParams.get('status');
    const createdBy = request.nextUrl.searchParams.get('created_by');
    const showHistory = request.nextUrl.searchParams.get('history') === 'true';

    let sql = 'SELECT * FROM staff_tasks WHERE 1=1';
    const params: any[] = [];
    let idx = 1;

    if (assignedTo) { sql += ` AND assigned_to = $${idx++}`; params.push(assignedTo); }
    if (createdBy) { sql += ` AND created_by = $${idx++}`; params.push(createdBy); }

    if (showHistory) {
      sql += ` AND status IN ('completed', 'cancelled')`;
    } else if (status) {
      sql += ` AND status = $${idx++}`; params.push(status);
    } else {
      sql += ` AND status IN ('pending', 'in_progress')`;
    }

    sql += ` ORDER BY
      CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      due_date ASC NULLS LAST,
      created_at DESC
    LIMIT 100`;

    const tasks = await query<any>(sql, params);
    // Attach dispatch file-attachments (additive; never breaks the response).
    try {
      const attMap = dispatchAttachmentsByStaffTaskId();
      if (attMap.size) {
        for (const t of tasks as any[]) {
          const link = attMap.get(Number(t.id));
          if (link) { t.dispatch_row_uuid = link.row_uuid; t.attachments = link.attachments; }
        }
      }
    } catch { /* leave tasks unmodified */ }
    return NextResponse.json({ success: true, tasks });
  } catch (error: any) {
    if (error?.status === 401) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Staff Tasks] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request, 'write');
    const body = await request.json();
    const { title, description, priority, assigned_to, assigned_to_name, due_date } = body;

    if (!title || !assigned_to) {
      return NextResponse.json({ error: 'title and assigned_to are required' }, { status: 400 });
    }

    const [task] = await query<any>(
      `INSERT INTO staff_tasks (title, description, priority, assigned_to, assigned_to_name, created_by, created_by_name, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [title, description || null, priority || 'medium', assigned_to, assigned_to_name || assigned_to,
       (user as any).email, (user as any).display_name || (user as any).email, due_date || null]
    );

    console.log(`[Staff Tasks] Created task #${task.id}: "${title}" assigned to ${assigned_to}`);
    return NextResponse.json({ success: true, task });
  } catch (error: any) {
    if (error?.status === 401) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Staff Tasks] POST error:', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireApiUser(request, 'write');
    const body = await request.json();
    const { task_id, status, staff_notes, priority, assigned_to, assigned_to_name, title, description, due_date } = body;

    if (!task_id) {
      return NextResponse.json({ error: 'task_id required' }, { status: 400 });
    }

    const updates: string[] = ['updated_at = NOW()'];
    const params: any[] = [];
    let idx = 1;

    if (status) {
      updates.push(`status = $${idx++}`); params.push(status);
      if (status === 'completed') {
        updates.push(`completed_at = NOW()`);
        updates.push(`completed_by = $${idx++}`); params.push((user as any).email);
      }
    }
    if (staff_notes !== undefined) { updates.push(`staff_notes = $${idx++}`); params.push(staff_notes); }
    if (priority) { updates.push(`priority = $${idx++}`); params.push(priority); }
    if (assigned_to) {
      updates.push(`assigned_to = $${idx++}`); params.push(assigned_to);
      if (assigned_to_name) { updates.push(`assigned_to_name = $${idx++}`); params.push(assigned_to_name); }
    }
    if (title !== undefined) { updates.push(`title = $${idx++}`); params.push(title); }
    if (description !== undefined) { updates.push(`description = $${idx++}`); params.push(description); }
    if (due_date !== undefined) { updates.push(`due_date = $${idx++}`); params.push(due_date || null); }

    params.push(task_id);
    await query(`UPDATE staff_tasks SET ${updates.join(', ')} WHERE id = $${idx}`, params);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.status === 401) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Staff Tasks] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireApiUser(request, 'write');
    const taskId = request.nextUrl.searchParams.get('id');
    if (!taskId) return NextResponse.json({ error: 'id required' }, { status: 400 });

    await query(`UPDATE staff_tasks SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [taskId]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.status === 401) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: 'Failed to cancel task' }, { status: 500 });
  }
}
