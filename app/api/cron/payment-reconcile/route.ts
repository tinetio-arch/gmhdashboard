import { NextRequest, NextResponse } from 'next/server';
import { sweepReconcile } from '@/lib/payment-reconcile';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/payment-reconcile
 *
 * Safety-net sweep that auto-resolves stale Unpaid alerts on the iPad CEO panel.
 * Runs every 30 minutes via crontab; also called inline from billing routes for
 * instant clearing when we know a charge just succeeded.
 */
export async function GET(request: NextRequest) {
    if (request.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const startedAt = Date.now();
    const result = await sweepReconcile(90);
    const elapsedMs = Date.now() - startedAt;
    console.log('[payment-reconcile] sweep done', { elapsedMs, ...result });
    return NextResponse.json({ success: true, elapsedMs, ...result });
}

export const POST = GET;
