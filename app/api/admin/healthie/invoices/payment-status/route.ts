import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { checkPaymentMethodStatus } from '@/lib/healthieInvoiceService';

export async function GET(request: NextRequest) {
  await requireApiUser(request, 'read');
  
  try {
    const status = await checkPaymentMethodStatus();
    
    const summary = {
      total: status.length,
      withPaymentMethod: status.filter(s => s.hasPaymentMethod).length,
      withoutPaymentMethod: status.filter(s => !s.hasPaymentMethod).length,
      withInvoices: status.filter(s => s.invoiceCount > 0).length,
      withPaidInvoices: status.filter(s => s.paidInvoiceCount > 0).length,
    };

    return NextResponse.json({
      success: true,
      summary,
      details: status,
    });
  } catch (error) {
    console.error('Healthie payment status check error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check payment status' 
      },
      { status: 500 }
    );
  }
}

