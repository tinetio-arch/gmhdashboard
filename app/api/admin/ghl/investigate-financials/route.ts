/**
 * API endpoint to investigate financial data in GHL
 * This is a diagnostic tool to see what Jane financial data exists in GHL
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  investigateJanePatientsInGHL,
  investigateGHLContact,
  findJaneContactsInGHL,
  extractFinancialFieldsFromContacts,
  deepDiveJaneFinancialData
} from '@/lib/ghlFinancialExtraction';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser('read');
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action') || 'investigate';
    const contactId = searchParams.get('contactId');
    const limit = parseInt(searchParams.get('limit') || '10', 10);

    if (action === 'investigate' && contactId) {
      // Investigate a specific contact
      const result = await investigateGHLContact(contactId);
      return NextResponse.json({
        success: true,
        data: result
      });
    }

    if (action === 'investigate') {
      // Investigate sample of Jane patients
      const results = await investigateJanePatientsInGHL(limit);
      
      // Extract all unique custom field keys to see what Jane is sending
      const allFields = new Set<string>();
      results.forEach(r => {
        r.allCustomFields.forEach(f => allFields.add(f.key));
      });
      
      return NextResponse.json({
        success: true,
        data: {
          patientsInvestigated: results.length,
          results,
          allCustomFieldKeys: Array.from(allFields).sort(),
          summary: {
            patientsWithFinancialData: results.filter(r => 
              Object.keys(r.financialData).length > 0
            ).length,
            totalCustomFields: results.reduce((sum, r) => sum + r.allCustomFields.length, 0)
          }
        }
      });
    }

    if (action === 'find-contacts') {
      // Find all Jane contacts in GHL
      const contacts = await findJaneContactsInGHL();
      const fieldAnalysis = await extractFinancialFieldsFromContacts(contacts);
      
      return NextResponse.json({
        success: true,
        data: {
          totalContacts: contacts.length,
          contacts: contacts.slice(0, 50), // Limit response size
          fieldAnalysis: {
            allFieldKeys: Array.from(fieldAnalysis.allFieldKeys).sort(),
            fieldFrequency: Object.fromEntries(fieldAnalysis.fieldFrequency),
            sampleValues: Object.fromEntries(
              Array.from(fieldAnalysis.sampleValues.entries()).map(([key, values]) => [
                key,
                values.slice(0, 3) // Limit to 3 samples per field
              ])
            )
          }
        }
      });
    }

    if (action === 'deep-dive') {
      // Comprehensive deep dive into Jane financial data
      const deepDive = await deepDiveJaneFinancialData(limit);
      
      return NextResponse.json({
        success: true,
        data: deepDive,
        insights: {
          hasFinancialData: deepDive.summary.patientsWithFinancialData > 0,
          hasOpportunities: deepDive.summary.patientsWithOpportunities > 0,
          revenueFromOpportunities: deepDive.summary.totalRevenueFromOpportunities,
          financialFieldsFound: deepDive.customFieldsAnalysis.financialFieldKeys.length,
          recommendation: deepDive.summary.patientsWithOpportunities > 0
            ? 'Extract revenue from GHL Opportunities API'
            : deepDive.summary.patientsWithFinancialData > 0
            ? 'Extract revenue from GHL Custom Fields'
            : 'No financial data found in GHL - rely on webhooks'
        }
      });
    }

    return NextResponse.json({
      error: 'Invalid action. Use: investigate, find-contacts, deep-dive'
    }, { status: 400 });

  } catch (error) {
    console.error('GHL financial investigation error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

