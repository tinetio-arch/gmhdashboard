/**
 * Check what financial data ClinicSync Pro webhooks contain
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { analyzeClinicSyncFinancialData } from '@/lib/checkClinicSyncFinancialData';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser('read');
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const analysis = await analyzeClinicSyncFinancialData(limit);

    return NextResponse.json({
      success: true,
      data: {
        ...analysis,
        financialFieldsFound: Array.from(analysis.financialFieldsFound).sort()
      },
      insights: {
        percentageWithFinancialData: analysis.totalWebhooks > 0
          ? ((analysis.webhooksWithFinancialData / analysis.totalWebhooks) * 100).toFixed(1) + '%'
          : '0%',
        mostCommonFields: Object.entries(analysis.fieldFrequency)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([field, count]) => ({ field, count })),
        recommendation: analysis.webhooksWithFinancialData > 0
          ? 'ClinicSync Pro webhooks contain financial data. Check if these fields are synced to GHL.'
          : 'No financial data found in ClinicSync Pro webhooks.'
      }
    });

  } catch (error) {
    console.error('ClinicSync financial analysis error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}



