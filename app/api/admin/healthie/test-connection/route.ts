import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { createHealthieClient } from '@/lib/healthie';

export async function GET(request: NextRequest) {
  await requireApiUser(request, 'read');
  
  try {
    const healthieClient = createHealthieClient();
    
    if (!healthieClient) {
      return NextResponse.json(
        { 
          connected: false, 
          error: 'Healthie API key not configured. Please set HEALTHIE_API_KEY environment variable.' 
        },
        { status: 400 }
      );
    }

    const isConnected = await healthieClient.testConnection();
    
    if (isConnected) {
      return NextResponse.json({ 
        connected: true,
        message: 'Successfully connected to Healthie API'
      });
    } else {
      return NextResponse.json(
        { 
          connected: false, 
          error: 'Failed to connect to Healthie API. Please check your API key.' 
        },
        { status: 401 }
      );
    }
  } catch (error) {
    console.error('Healthie connection test error:', error);
    return NextResponse.json(
      { 
        connected: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      },
      { status: 500 }
    );
  }
}

