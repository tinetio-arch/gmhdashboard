import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';

export async function POST(req: NextRequest) {
  console.warn(
    '[ClinicSync] Bulk sync endpoint is disabled. Use /api/admin/clinicsync/reprocess instead.'
  );
  return NextResponse.json(
    {
      success: false,
      message:
        'Bulk ClinicSync sync is temporarily disabled. Use /api/admin/clinicsync/reprocess with webhook data.',
    },
    { status: 503 }
  );
}

// GET endpoint to check Jane API configuration
export async function GET(req: NextRequest) {
  try {
    await requireApiUser(req, 'admin');
    
    const apiKey = process.env.CLINICSYNC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ 
        configured: false, 
        message: 'CLINICSYNC_API_KEY not set in environment' 
      });
    }

    // Test the API key with a simple request
    const testResponse = await fetch('https://jane-api.clinikoconnect.com/api-book-appointment', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ test: true })
    });

    return NextResponse.json({
      configured: true,
      apiKey: apiKey.substring(0, 8) + '...',
      testStatus: testResponse.status,
      webhookUrl: 'https://nowoptimal.com/ops/api/integrations/clinicsync/webhook',
      message: 'To find the correct API endpoint, contact ClinicSync support and ask for the patient/membership list endpoint'
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to check configuration' },
      { status: 500 }
    );
  }
}
