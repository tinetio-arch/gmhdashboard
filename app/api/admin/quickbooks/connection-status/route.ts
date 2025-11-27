import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { getQuickBooksHealthStatus } from '@/lib/quickbooksHealth';

export async function GET(req: NextRequest) {
  try {
    const user = await requireApiUser(req, 'read');

    // Get comprehensive health status (includes actual API test)
    const health = await getQuickBooksHealthStatus();

    return NextResponse.json({
      connected: health.connected,
      lastChecked: health.lastChecked.toISOString(),
      lastSuccessfulCheck: health.lastSuccessfulCheck?.toISOString() || null,
      error: health.error,
      tokenExpiresAt: health.tokenExpiresAt?.toISOString() || null,
      canRefresh: health.canRefresh,
      healthScore: health.healthScore,
    });
  } catch (error) {
    console.error('Error checking QuickBooks connection:', error);
    return NextResponse.json(
      { 
        connected: false,
        error: error instanceof Error ? error.message : 'Failed to check connection status',
        healthScore: 0
      },
      { status: 500 }
    );
  }
}
