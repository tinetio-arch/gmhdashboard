/**
 * POST /api/push/send — Send push notifications to patients
 *
 * Admin-only endpoint for sending announcements and promotions from the CEO dashboard.
 * Respects patient opt-in preferences per category.
 *
 * Body: {
 *   title: string,
 *   body: string,
 *   category: 'announcements' | 'promotions',
 *   target: 'all' | 'group' | 'patient',
 *   groupId?: string,           // required when target='group'
 *   healthieClientId?: string,  // required when target='patient'
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { sendPushMessages, PushMessage, PushCategory } from '@/lib/expoPush';

export const dynamic = 'force-dynamic';

const VALID_CATEGORIES: PushCategory[] = ['announcements', 'promotions'];

interface TokenRow {
  expo_token: string;
  healthie_client_id: string;
  preferences: Record<string, boolean>;
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request, 'admin');

    const body = await request.json();
    const { title, body: msgBody, category, target, groupId, healthieClientId } = body;

    if (!title || !msgBody) {
      return NextResponse.json({ error: 'title and body are required' }, { status: 400 });
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` }, { status: 400 });
    }
    if (!['all', 'group', 'patient'].includes(target)) {
      return NextResponse.json({ error: 'target must be all, group, or patient' }, { status: 400 });
    }
    if (target === 'group' && !groupId) {
      return NextResponse.json({ error: 'groupId is required when target is group' }, { status: 400 });
    }
    if (target === 'patient' && !healthieClientId) {
      return NextResponse.json({ error: 'healthieClientId is required when target is patient' }, { status: 400 });
    }

    // Load eligible tokens based on target
    let tokens: TokenRow[];
    if (target === 'patient') {
      tokens = await query<TokenRow>(
        `SELECT expo_token, healthie_client_id, preferences
         FROM patient_push_tokens
         WHERE healthie_client_id = $1 AND active = TRUE`,
        [healthieClientId]
      );
    } else if (target === 'group') {
      tokens = await query<TokenRow>(
        `SELECT expo_token, healthie_client_id, preferences
         FROM patient_push_tokens
         WHERE user_group_id = $1 AND active = TRUE`,
        [groupId]
      );
    } else {
      tokens = await query<TokenRow>(
        `SELECT expo_token, healthie_client_id, preferences
         FROM patient_push_tokens
         WHERE active = TRUE`
      );
    }

    // Filter by preference opt-in
    const eligible = tokens.filter(t => {
      const prefs = t.preferences || {};
      // Default: announcements=true, promotions=false
      if (category === 'announcements') return prefs.announcements !== false;
      if (category === 'promotions') return prefs.promotions === true;
      return true;
    });

    if (eligible.length === 0) {
      return NextResponse.json({
        success: true,
        sent: 0,
        totalTokens: tokens.length,
        eligibleTokens: 0,
        message: tokens.length === 0
          ? 'No patients with push tokens found for this target.'
          : `${tokens.length} token(s) found but none opted into ${category}.`,
      });
    }

    // Build messages with unique dedupe key
    const dedupeBase = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const messages: PushMessage[] = eligible.map((t, i) => ({
      target: { expoToken: t.expo_token, healthieClientId: t.healthie_client_id },
      category: category as PushCategory,
      dedupeKey: `${dedupeBase}-${i}`,
      title,
      body: msgBody,
      data: { type: category, sentBy: 'ceo_dashboard' },
      channelId: category,
      sound: 'default',
    }));

    console.log(`[Push Send] ${user.email} sending "${category}" to ${eligible.length} token(s) — target: ${target}${groupId ? ` group:${groupId}` : ''}${healthieClientId ? ` patient:${healthieClientId}` : ''}`);

    const result = await sendPushMessages(messages);

    console.log(`[Push Send] Result: sent=${result.sent} failed=${result.failed} skipped=${result.skippedDuplicate} unregistered=${result.deviceNotRegistered}`);

    return NextResponse.json({
      success: true,
      ...result,
      totalTokens: tokens.length,
      eligibleTokens: eligible.length,
    });
  } catch (error: any) {
    console.error('[Push Send] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

/** GET /api/push/send — Get push stats for the CEO dashboard */
export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request, 'admin');

    const [tokenStats, recentSends] = await Promise.all([
      query<{ user_group_id: string | null; count: string }>(
        `SELECT user_group_id, COUNT(*)::text as count
         FROM patient_push_tokens WHERE active = TRUE
         GROUP BY user_group_id ORDER BY count DESC`
      ),
      query<{ category: string; title: string; sent_at: string; count: string }>(
        `SELECT category, title, MIN(sent_at) as sent_at, COUNT(*)::text as count
         FROM push_send_log
         WHERE sent_at > NOW() - INTERVAL '7 days'
         GROUP BY category, title, dedupe_key
         ORDER BY sent_at DESC
         LIMIT 10`
      ),
    ]);

    const totalActive = tokenStats.reduce((sum, r) => sum + parseInt(r.count), 0);

    return NextResponse.json({
      success: true,
      stats: {
        totalActiveTokens: totalActive,
        byGroup: tokenStats,
        recentSends,
      },
    });
  } catch (error: any) {
    console.error('[Push Stats] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
