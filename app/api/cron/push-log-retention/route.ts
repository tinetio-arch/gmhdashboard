/**
 * Push Send Log Retention
 *
 * Nightly purge of push_send_log rows older than 90 days. Keeps the table small
 * and honors the retention policy disclosed in the Privacy Policy (Section 6).
 *
 * The UNIQUE (category, dedupe_key, expo_token) index is only needed for
 * short-term deduplication windows — appointment reminders dedupe within 25h,
 * not 90 days — so there's no correctness risk in deleting old rows.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
    const cronSecret = request.headers.get('x-cron-secret');
    if (cronSecret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const started = Date.now();

    try {
        const result = await query<{ count: string }>(
            `WITH deleted AS (
                DELETE FROM push_send_log
                WHERE sent_at < NOW() - INTERVAL '90 days'
                RETURNING id
            )
            SELECT COUNT(*)::text AS count FROM deleted`
        );
        const deleted = parseInt(result[0]?.count || '0', 10);

        return NextResponse.json({
            success: true,
            duration_ms: Date.now() - started,
            deleted,
        });
    } catch (error) {
        console.error('[push-log-retention] Fatal:', error);
        return NextResponse.json(
            { error: 'Cron failed', details: String(error) },
            { status: 500 }
        );
    }
}
