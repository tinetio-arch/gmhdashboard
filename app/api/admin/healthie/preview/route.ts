import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { exportQuickBooksPatients } from '@/lib/healthieMigration';

export async function GET(request: NextRequest) {
  await requireApiUser(request, 'read');
  
  try {
    const previews = await exportQuickBooksPatients();
    
    return NextResponse.json({
      success: true,
      count: previews.length,
      previews,
    });
  } catch (error) {
    console.error('Healthie migration preview error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate migration preview' 
      },
      { status: 500 }
    );
  }
}


