import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized - Admin access required' },
        { status: 403 }
      );
    }

    // Check if we have valid OAuth tokens
    const tokens = await query<{
      expires_at: Date;
    }>(`
      SELECT expires_at
      FROM quickbooks_oauth_tokens
      WHERE realm_id IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 1
    `);

    if (tokens.length === 0) {
      return NextResponse.json({ connected: false });
    }

    const token = tokens[0];
    const now = new Date();
    const expiresAt = new Date(token.expires_at);
    const connected = expiresAt > now;

    return NextResponse.json({ connected });
  } catch (error) {
    console.error('Error checking QuickBooks connection:', error);
    return NextResponse.json(
      { error: 'Failed to check connection status' },
      { status: 500 }
    );
  }
}
