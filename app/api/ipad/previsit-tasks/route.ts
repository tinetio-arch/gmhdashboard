import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ipad/previsit-tasks?date=YYYY-MM-DD
 * Returns all previsit task completions for a given date (defaults to today Phoenix time)
 */
export async function GET(request: NextRequest) {
    try {
        await requireApiUser(request, 'read');
        const { searchParams } = new URL(request.url);
        const date = searchParams.get('date') || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });

        const tasks = await query<any>(
            'SELECT appointment_id, task_key, completed, completed_by, completed_at FROM previsit_tasks WHERE visit_date = $1 AND completed = TRUE',
            [date]
        );

        // Group by appointment_id
        const byAppt: Record<string, any[]> = {};
        for (const t of tasks) {
            if (!byAppt[t.appointment_id]) byAppt[t.appointment_id] = [];
            byAppt[t.appointment_id].push({
                key: t.task_key,
                completed_by: t.completed_by,
                completed_at: t.completed_at,
            });
        }

        return NextResponse.json({ success: true, tasks: byAppt });
    } catch (error: any) {
        if (error?.name === 'UnauthorizedError') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        return NextResponse.json({ error: 'Failed to load tasks' }, { status: 500 });
    }
}

/**
 * POST /api/ipad/previsit-tasks
 * Toggle a previsit task completion
 * Body: { appointment_id, task_key, completed, completed_by }
 */
export async function POST(request: NextRequest) {
    try {
        const user = await requireApiUser(request, 'write');
        const body = await request.json();
        const { appointment_id, task_key, completed, completed_by } = body;

        if (!appointment_id || !task_key) {
            return NextResponse.json({ error: 'appointment_id and task_key required' }, { status: 400 });
        }

        const date = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });
        const who = completed_by || user.display_name || user.email?.split('@')[0] || 'Staff';

        if (completed) {
            await query(
                `INSERT INTO previsit_tasks (appointment_id, task_key, completed, completed_by, completed_at, visit_date)
                 VALUES ($1, $2, TRUE, $3, NOW(), $4)
                 ON CONFLICT (appointment_id, task_key, visit_date)
                 DO UPDATE SET completed = TRUE, completed_by = EXCLUDED.completed_by, completed_at = NOW()`,
                [appointment_id, task_key, who, date]
            );
        } else {
            await query(
                'DELETE FROM previsit_tasks WHERE appointment_id = $1 AND task_key = $2 AND visit_date = $3',
                [appointment_id, task_key, date]
            );
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        if (error?.name === 'UnauthorizedError') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        console.error('[previsit-tasks]', error);
        return NextResponse.json({ error: 'Failed to save task' }, { status: 500 });
    }
}
