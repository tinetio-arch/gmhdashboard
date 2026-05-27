/**
 * PATCH /api/patients/[id]/stack/[stackId]/reminders
 *   Per-item reminder + schedule settings:
 *     reminder_enabled (bool)
 *     reminder_time    (HH:MM:SS — patient-local, Phoenix)
 *     reminder_method  ('push' | 'sms' | 'email')
 *     inject_days      (array of weekday slugs)
 *     anchor_date      (DATE)
 *     cadence_days     (numeric)
 *
 *   Available to the patient (mobile app) AND staff. Patient-app callers
 *   should authenticate via the existing patient-app auth path; today this
 *   route uses requireApiUser('write') — promote to a patient-app-aware
 *   guard if the mobile app wires up to it directly.
 *
 *   Records a 'reminder_update' / 'schedule_update' entry in dose_history.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { buildHistoryEntry, fetchStackItem } from '@/lib/patientStack';

export const dynamic = 'force-dynamic';

interface RemindersBody {
  reminder_enabled?: boolean;
  reminder_time?: string | null;            // 'HH:MM' or 'HH:MM:SS'
  reminder_method?: 'push' | 'sms' | 'email';
  inject_days?: string[] | null;            // e.g. ['mon','fri']
  anchor_date?: string | null;
  cadence_days?: number | null;
  note?: string | null;
}

const REMINDER_KEYS: (keyof RemindersBody)[] = [
  'reminder_enabled',
  'reminder_time',
  'reminder_method'
];

const SCHEDULE_KEYS: (keyof RemindersBody)[] = [
  'inject_days',
  'anchor_date',
  'cadence_days'
];

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; stackId: string } }
) {
  let user;
  try {
    user = await requireApiUser(request, 'write');
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    throw error;
  }

  try {
    const { id: patientId, stackId } = params;
    const body = (await request.json()) as RemindersBody;

    const existing = await fetchStackItem(stackId);
    if (!existing) {
      return NextResponse.json({ error: 'stack item not found' }, { status: 404 });
    }
    if (existing.patient_id !== patientId) {
      return NextResponse.json({ error: 'stack item does not belong to this patient' }, { status: 403 });
    }

    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;
    const prev: Record<string, unknown> = {};
    const next: Record<string, unknown> = {};
    let touchedReminders = false;
    let touchedSchedule = false;

    for (const key of REMINDER_KEYS) {
      if (!(key in body)) continue;
      touchedReminders = true;
      if (key === 'reminder_time') {
        updates.push(`reminder_time = $${i++}::time`);
        values.push(body.reminder_time ?? null);
      } else {
        updates.push(`${key} = $${i++}`);
        values.push((body as any)[key]);
      }
      prev[key] = (existing as any)[key];
      next[key] = (body as any)[key];
    }

    for (const key of SCHEDULE_KEYS) {
      if (!(key in body)) continue;
      touchedSchedule = true;
      if (key === 'inject_days') {
        updates.push(`inject_days = $${i++}::jsonb`);
        values.push(body.inject_days ? JSON.stringify(body.inject_days) : null);
      } else if (key === 'anchor_date') {
        updates.push(`anchor_date = $${i++}::date`);
        values.push(body.anchor_date ?? null);
      } else {
        updates.push(`${key} = $${i++}`);
        values.push((body as any)[key]);
      }
      prev[key] = (existing as any)[key];
      next[key] = (body as any)[key];
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'no reminder/schedule fields in body' }, { status: 400 });
    }

    const action =
      touchedReminders && touchedSchedule ? 'schedule_update' :
      touchedReminders ? 'reminder_update' :
      'schedule_update';

    const entry = buildHistoryEntry({
      action: action as 'reminder_update' | 'schedule_update',
      by: user.user_id,
      by_name: user.display_name || user.email,
      prev: Object.keys(prev).length ? prev : null,
      next: Object.keys(next).length ? next : null,
      note: body.note ?? null
    });

    updates.push(`dose_history = dose_history || jsonb_build_array($${i++}::jsonb)`);
    values.push(JSON.stringify(entry));

    values.push(stackId);
    const sql = `UPDATE patient_peptide_stack SET ${updates.join(', ')} WHERE stack_id = $${i}::uuid`;
    await query(sql, values);

    // Cadence change on a TRT item must also flow to patients.dose_frequency_days
    // (the trtEligibility engine reads from there).
    if (
      existing.item_type === 'testosterone' &&
      typeof body.cadence_days === 'number' &&
      body.cadence_days > 0
    ) {
      await query(
        `UPDATE patients SET dose_frequency_days = $1, updated_at = NOW() WHERE patient_id = $2::uuid`,
        [body.cadence_days, patientId]
      );
    }

    const refreshed = await fetchStackItem(stackId);
    return NextResponse.json({ success: true, item: refreshed });
  } catch (error) {
    console.error('[API stack reminders PATCH] Failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
