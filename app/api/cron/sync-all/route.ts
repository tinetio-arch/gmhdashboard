import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';

// This endpoint can be called by a cron job to sync both QuickBooks and ClinicSync data
export async function GET(req: NextRequest) {
  try {
    // Verify the request is from a trusted source (e.g., cron job with secret)
    const headersList = headers();
    const cronSecret = headersList.get('x-cron-secret');
    
    if (cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const results: {
      quickbooks: any;
      clinicsync: any;
      paymentCheck?: any;
      timestamp: string;
    } = {
      quickbooks: null,
      clinicsync: {
        skipped: true,
        message:
          'Bulk ClinicSync sync disabled. Use /api/admin/clinicsync/reprocess to refresh webhook data.',
      },
      timestamp: new Date().toISOString()
    };

    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3400/ops';

    // Sync QuickBooks data
    try {
      const qbResponse = await fetch(`${baseUrl}/api/admin/quickbooks/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Use internal auth bypass for cron jobs
          'x-internal-auth': process.env.INTERNAL_AUTH_SECRET || ''
        }
      });
      
      if (qbResponse.ok) {
        results.quickbooks = await qbResponse.json();
      } else {
        results.quickbooks = { error: `QuickBooks sync failed: ${qbResponse.status}` };
      }
    } catch (error) {
      results.quickbooks = { error: `QuickBooks sync error: ${error}` };
    }

    // Check for payment issues and update statuses
    try {
      const checkResponse = await fetch(`${baseUrl}/api/admin/quickbooks/check-payment-failures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-auth': process.env.INTERNAL_AUTH_SECRET || ''
        }
      });
      
      if (checkResponse.ok) {
        results.paymentCheck = await checkResponse.json();
      }
    } catch (error) {
      results.paymentCheck = { error: `Payment check error: ${error}` };
    }

    return NextResponse.json({
      success: true,
      results
    });
  } catch (error) {
    console.error('[Cron] Sync all error:', error);
    return NextResponse.json(
      { error: 'Failed to run sync', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
