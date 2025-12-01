/**
 * Debug endpoint to see raw GHL contact structure
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { debugGHLContact, debugJanePatientsGHL } from '@/lib/ghlDebug';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser('read');
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const contactId = searchParams.get('contactId');
    const action = searchParams.get('action') || 'single';
    const limit = parseInt(searchParams.get('limit') || '5', 10);

    if (action === 'single' && contactId) {
      const debug = await debugGHLContact(contactId);
      return NextResponse.json({
        success: true,
        data: debug
      });
    }

    if (action === 'jane-patients') {
      const debug = await debugJanePatientsGHL(limit);
      return NextResponse.json({
        success: true,
        data: debug,
        summary: {
          totalPatients: debug.length,
          patientsWithContacts: debug.filter(d => d.ghlContactId).length,
          patientsWithCustomFields: debug.filter(d => d.debug?.hasCustomFields).length,
          allResponseKeys: [...new Set(debug.flatMap(d => d.debug?.allKeys || []))],
          errors: debug.filter(d => d.error).length
        }
      });
    }

    return NextResponse.json({
      error: 'Invalid action. Use: single (with contactId) or jane-patients'
    }, { status: 400 });

  } catch (error) {
    console.error('GHL debug error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}



