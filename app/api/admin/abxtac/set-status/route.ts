/**
 * POST /api/admin/abxtac/set-status
 *
 * Admin-only. Sets the `membership_status` column on abxtac_customer_access.
 * Per policy §8.6.9 and Core Principle #8 (app lockout is ABXTAC-only).
 *
 * Body: { healthie_id: string, status: 'active' | 'payment_hold' | 'inactive', reason?: string }
 *
 * All transitions are staff-reviewed per policy — no automated state changes.
 * 'payment_hold' triggers the mobile app lockout (when ABXTAC_LOCKOUT_ENABLED=true).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

const VALID_STATUSES = new Set(['active', 'payment_hold', 'inactive']);

export async function POST(request: NextRequest) {
  let user;
  try {
    user = await requireApiUser(request, 'admin');
  } catch (authError: any) {
    if (authError?.status === 401 || authError?.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    throw authError;
  }

  try {
    const body = await request.json();
    const { healthie_id, status, reason } = body as { healthie_id?: string; status?: string; reason?: string };

    if (!healthie_id || typeof healthie_id !== 'string') {
      return NextResponse.json({ error: 'healthie_id is required' }, { status: 400 });
    }
    if (!status || !VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: `status must be one of: ${[...VALID_STATUSES].join(', ')}` }, { status: 400 });
    }

    // Verify this patient has an ABXTAC row to begin with
    const [existing] = await query<{ email: string | null; tier: string | null; membership_status: string | null }>(
      `SELECT email, tier, membership_status FROM abxtac_customer_access WHERE healthie_patient_id = $1 LIMIT 1`,
      [healthie_id]
    );

    if (!existing) {
      return NextResponse.json({
        error: 'No ABXTAC membership on file for this patient. Use the Healthie subscription flow to enroll them first.',
        code: 'NO_ABXTAC_ROW'
      }, { status: 404 });
    }

    const previousStatus = existing.membership_status || 'active';

    // Update
    await query(
      `UPDATE abxtac_customer_access
       SET membership_status = $1
       WHERE healthie_patient_id = $2`,
      [status, healthie_id]
    );

    console.log(`[ABXTAC set-status] ${user.email}: healthie=${healthie_id} ${previousStatus} → ${status}${reason ? ' | reason: ' + reason : ''}`);

    return NextResponse.json({
      success: true,
      healthie_id,
      previous_status: previousStatus,
      new_status: status,
      tier: existing.tier,
      locked_out_from_app: status === 'payment_hold' && process.env.ABXTAC_LOCKOUT_ENABLED === 'true',
      lockout_feature_enabled: process.env.ABXTAC_LOCKOUT_ENABLED === 'true',
    });
  } catch (error: any) {
    if (error?.status === 401) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[ABXTAC set-status] Failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
