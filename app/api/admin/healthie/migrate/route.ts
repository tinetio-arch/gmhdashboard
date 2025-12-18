import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { migratePatientToHealthie, migrateBatch } from '@/lib/healthieMigration';

export async function POST(request: NextRequest) {
  const user = await requireApiUser(request, 'write');
  
  try {
    const body = await request.json();
    const { patientIds, options } = body;

    if (!patientIds || !Array.isArray(patientIds) || patientIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'patientIds array is required' },
        { status: 400 }
      );
    }

    const migrationOptions = {
      skipExisting: options?.skipExisting ?? false,
      createPackages: options?.createPackages ?? true,
    };

    let result;
    if (patientIds.length === 1) {
      // Single patient migration
      result = await migratePatientToHealthie(patientIds[0], migrationOptions);
    } else {
      // Batch migration
      result = await migrateBatch(patientIds, migrationOptions);
    }

    return NextResponse.json({
      success: result.success,
      ...result,
    });
  } catch (error) {
    console.error('Healthie migration error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Migration failed' 
      },
      { status: 500 }
    );
  }
}


