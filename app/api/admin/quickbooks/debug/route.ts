import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { createQuickBooksClient } from '@/lib/quickbooks';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request, 'admin');
    
    const qbClient = await createQuickBooksClient();
    if (!qbClient) {
      return NextResponse.json({ error: 'QuickBooks not connected' }, { status: 400 });
    }

    const debugInfo: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      tests: {}
    };

    // Test 1: Get all customers
    try {
      const customers = await qbClient.getCustomers();
      debugInfo.tests = {
        ...debugInfo.tests as object,
        customers: {
          count: customers.length,
          sample: customers.slice(0, 3).map(c => ({
            id: c.Id,
            name: c.DisplayName,
            balance: c.Balance
          }))
        }
      };
    } catch (error) {
      debugInfo.tests = {
        ...debugInfo.tests as object,
        customers: { error: (error as Error).message }
      };
    }

    // Test 2: Query RecurringTransaction directly
    try {
      const recurringResponse = await qbClient['request']<{
        QueryResponse: {
          RecurringTransaction?: unknown[];
          maxResults?: number;
        };
      }>('GET', '/query?query=SELECT * FROM RecurringTransaction MAXRESULTS 10', { minorVersion: 65 });
      
      debugInfo.tests = {
        ...debugInfo.tests as object,
        recurringTransaction: {
          rawResponse: recurringResponse,
          count: recurringResponse.QueryResponse?.RecurringTransaction?.length ?? 0
        }
      };
    } catch (error) {
      debugInfo.tests = {
        ...debugInfo.tests as object,
        recurringTransaction: { error: (error as Error).message }
      };
    }

    // Test 3: Query SalesReceipt with RecurringTxnId
    try {
      const salesReceiptResponse = await qbClient['request']<{
        QueryResponse: {
          SalesReceipt?: unknown[];
          maxResults?: number;
        };
      }>('GET', '/query?query=SELECT * FROM SalesReceipt MAXRESULTS 10', { minorVersion: 65 });
      
      debugInfo.tests = {
        ...debugInfo.tests as object,
        salesReceipts: {
          count: salesReceiptResponse.QueryResponse?.SalesReceipt?.length ?? 0,
          sample: salesReceiptResponse.QueryResponse?.SalesReceipt?.slice(0, 2)
        }
      };
    } catch (error) {
      debugInfo.tests = {
        ...debugInfo.tests as object,
        salesReceipts: { error: (error as Error).message }
      };
    }

    // Test 4: Query Invoice
    try {
      const invoiceResponse = await qbClient['request']<{
        QueryResponse: {
          Invoice?: unknown[];
          maxResults?: number;
        };
      }>('GET', '/query?query=SELECT * FROM Invoice MAXRESULTS 10');
      
      debugInfo.tests = {
        ...debugInfo.tests as object,
        invoices: {
          count: invoiceResponse.QueryResponse?.Invoice?.length ?? 0,
          sample: invoiceResponse.QueryResponse?.Invoice?.slice(0, 2)
        }
      };
    } catch (error) {
      debugInfo.tests = {
        ...debugInfo.tests as object,
        invoices: { error: (error as Error).message }
      };
    }

    return NextResponse.json(debugInfo);
  } catch (error) {
    console.error('QuickBooks debug error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch debug info', details: (error as Error).message },
      { status: 500 }
    );
  }
}

