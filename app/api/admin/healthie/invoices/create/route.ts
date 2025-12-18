import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { createInvoiceForPatient, createInvoicesForAllPatients } from '@/lib/healthieInvoiceService';

export async function POST(request: NextRequest) {
  const user = await requireApiUser(request, 'write');
  
  try {
    const body = await request.json();
    const { patientIds, amount, options, createForAll } = body;

    if (createForAll) {
      // Create invoices for all migrated patients
      const result = await createInvoicesForAllPatients({
        usePackageAmount: options?.usePackageAmount ?? true,
        defaultAmount: options?.defaultAmount,
        description: options?.description,
        dueDate: options?.dueDate ? new Date(options.dueDate) : undefined,
        sendEmail: options?.sendEmail ?? true,
      });

      return NextResponse.json(result);
    } else {
      // Create invoices for specific patients
      if (!patientIds || !Array.isArray(patientIds) || patientIds.length === 0) {
        return NextResponse.json(
          { success: false, error: 'patientIds array is required' },
          { status: 400 }
        );
      }

      if (!amount || amount <= 0) {
        return NextResponse.json(
          { success: false, error: 'amount is required and must be greater than 0' },
          { status: 400 }
        );
      }

      const results = [];
      const errors = [];

      for (const patientId of patientIds) {
        try {
          const result = await createInvoiceForPatient(patientId, amount, {
            description: options?.description,
            dueDate: options?.dueDate ? new Date(options.dueDate) : undefined,
            sendEmail: options?.sendEmail ?? true,
          });
          results.push(result);
          if (!result.success && result.error) {
            errors.push(`${result.patientName}: ${result.error}`);
          }
        } catch (error) {
          errors.push(`Patient ${patientId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      return NextResponse.json({
        success: failed === 0,
        totalProcessed: results.length,
        successful,
        failed,
        results,
        errors,
      });
    }
  } catch (error) {
    console.error('Healthie invoice creation error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create invoices' 
      },
      { status: 500 }
    );
  }
}


