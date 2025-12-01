import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { detectAndUpdateMixedPaymentPatients, getMixedPaymentPatientStats } from '@/lib/mixedPaymentDetection';

export async function POST(req: NextRequest) {
  try {
    await requireApiUser(req, 'admin');
    
    // Run the detection and update
    const updatedCount = await detectAndUpdateMixedPaymentPatients();
    
    // Get updated stats
    const stats = await getMixedPaymentPatientStats();
    
    return NextResponse.json({
      success: true,
      message: `Updated ${updatedCount} patients to mixed payment method`,
      stats
    });
  } catch (error) {
    console.error('Error updating mixed payment patients:', error);
    return NextResponse.json(
      { error: 'Failed to update mixed payment patients' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireApiUser(req, 'admin');
    
    // Just get current stats without updating
    const stats = await getMixedPaymentPatientStats();
    
    return NextResponse.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error fetching mixed payment stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch mixed payment stats' },
      { status: 500 }
    );
  }
}









