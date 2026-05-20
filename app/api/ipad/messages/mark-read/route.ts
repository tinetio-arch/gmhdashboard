import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ipad/messages/mark-read
 * Marks a Healthie conversation as read for the current staff member (per-user
 * read tracking; see migrations/20260519_conversation_reads.sql). Called when a
 * staff member opens a conversation. Idempotent upsert.
 *
 * Body: { conversation_id: string }
 */
export async function POST(request: NextRequest) {
    let user;
    try {
        user = await requireApiUser(request, 'read');
    } catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        if (!user?.user_id || user.user_id === 'api-internal') {
            return NextResponse.json({ success: true, skipped: true });
        }
        const body = await request.json();
        const conversationId = String(body?.conversation_id || '').trim();
        if (!conversationId) {
            return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 });
        }

        await query(
            `INSERT INTO conversation_reads (user_id, conversation_id, last_read_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (user_id, conversation_id)
             DO UPDATE SET last_read_at = NOW()`,
            [user.user_id, conversationId]
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[iPad Messages mark-read] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
