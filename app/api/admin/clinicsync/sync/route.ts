import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { upsertClinicSyncPatient, normalizePayload } from '@/lib/clinicsync';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Jane API endpoints for fetching membership/package data
const JANE_API_BASE = 'https://jane-api.clinikoconnect.com';
const JANE_API_ENDPOINTS = [
  `${JANE_API_BASE}/api/purchases`, // Primary endpoint for package/membership data
  `${JANE_API_BASE}/api/patients`,
  `${JANE_API_BASE}/api/memberships`, 
  `${JANE_API_BASE}/api/packages`,
  `${JANE_API_BASE}/api/passes`
];

// Helper to check if request is from internal cron job
async function isInternalRequest(): Promise<boolean> {
  const headersList = headers();
  const internalAuth = headersList.get('x-internal-auth');
  return internalAuth === process.env.INTERNAL_AUTH_SECRET;
}

export async function POST(req: NextRequest) {
  try {
    // Allow internal cron requests to bypass auth
    let user;
    if (await isInternalRequest()) {
      // Get the first admin user from database for cron jobs
      const adminUsers = await query<{ user_id: string; email: string; role: string; display_name: string | null; created_at: string; updated_at: string; is_active: boolean; is_provider: boolean; can_sign: boolean }>(
        `SELECT user_id, email, role, display_name, created_at, updated_at, is_active, is_provider, can_sign 
         FROM users 
         WHERE role = 'admin' AND is_active = TRUE 
         LIMIT 1`
      );
      if (adminUsers.length > 0) {
        user = adminUsers[0];
      } else {
        // Fallback: use requireApiUser if no admin found
        user = await requireApiUser(req, 'admin');
      }
    } else {
      user = await requireApiUser(req, 'admin');
    }
    const apiKey = process.env.CLINICSYNC_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json(
        { error: 'CLINICSYNC_API_KEY not configured' },
        { status: 500 }
      );
    }

    // Start sync log - using 'clinicsync' as sync_type
    const createdBy =
      typeof user?.user_id === 'string' && UUID_REGEX.test(user.user_id) ? user.user_id : null;

    if (!createdBy && user?.user_id) {
      console.warn(`[ClinicSync Sync] Ignoring non-UUID user_id for created_by: ${user.user_id}`);
    }

    const syncLog = await query<{ sync_id: string }>(`
      INSERT INTO payment_sync_log (sync_type, sync_status, created_by)
      VALUES ('clinicsync', 'running', $1)
      RETURNING sync_id
    `, [createdBy]);

    const syncId = syncLog[0].sync_id;
    
    try {
      let totalProcessed = 0;
      let totalUpdated = 0;
      let totalFailed = 0;
      let successfulEndpoint = null;

      // Try different endpoints to find the correct one
      for (const endpoint of JANE_API_ENDPOINTS) {
        console.log(`[ClinicSync] Trying endpoint: ${endpoint}`);
        
        try {
          const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
              'x-api-key': apiKey,
              'Content-Type': 'application/json'
            }
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.log(`[ClinicSync] Endpoint ${endpoint} returned ${response.status}: ${errorText.substring(0, 200)}`);
            continue;
          }

          const data = await response.json();
          
          // Check if we got patient/membership/purchase data
          if (data && (Array.isArray(data) || data.patients || data.memberships || data.purchases)) {
            successfulEndpoint = endpoint;
            console.log(`[ClinicSync] Success with endpoint: ${endpoint}`);
            
            // Handle different response formats
            let itemsToProcess = [];
            
            if (endpoint.includes('/purchases')) {
              // Handle purchases endpoint - transform to patient-centric format
              const purchases = Array.isArray(data) ? data : (data.purchases || []);
              const patientMap = new Map();
              
              for (const purchase of purchases) {
                const patientId = purchase.patient_id || purchase.patient?.id;
                if (!patientId) continue;
                
                if (!patientMap.has(patientId)) {
                  patientMap.set(patientId, {
                    id: patientId,
                    name: purchase.patient?.name || purchase.patient_name,
                    passes: [],
                    appointmentsObject: []
                  });
                }
                
                // Add purchase as a pass
                const patient = patientMap.get(patientId);
                patient.passes.push({
                  id: purchase.purchase_id,
                  name: purchase.product_name,
                  package_type: purchase.package_type,
                  purchase_date: purchase.purchase_date,
                  expiry_date: purchase.expiry_date,
                  purchase_state: purchase.purchase_state || 'active',
                  sessions_redeemed: purchase.sessions_redeemed,
                  sale_id: purchase.sale_id
                });
              }
              
              itemsToProcess = Array.from(patientMap.values());
            } else {
              // Handle other endpoints
              itemsToProcess = Array.isArray(data) ? data : (data.patients || data.memberships || []);
            }
            
            // Process each patient/item
            for (const item of itemsToProcess) {
              try {
                totalProcessed++;
                
                // Normalize the payload to match our webhook format
                const normalized = normalizePayload({
                  ...item,
                  // Ensure passes array exists
                  passes: item.passes || item.memberships || [],
                  // Include appointments if available
                  appointmentsObject: item.appointments || item.appointmentsObject || []
                });

                // Process through our existing ClinicSync logic
                const result = await upsertClinicSyncPatient(normalized);
                
                if (result.patientId) {
                  totalUpdated++;
                }
                
                console.log(`[ClinicSync] Processed patient ${item.id}: ${item.name || item.full_name}`);
              } catch (error) {
                console.error(`[ClinicSync] Error processing patient ${item.id}:`, error);
                totalFailed++;
              }
            }
            
            break; // Found working endpoint, stop trying others
          }
        } catch (error) {
          console.error(`[ClinicSync] Error with endpoint ${endpoint}:`, error);
        }
      }

      // If no endpoint worked, return an error with helpful information
      if (!successfulEndpoint) {
        console.log('[ClinicSync] No working endpoint found');
        
        // Return error with instructions
        await query(`
          UPDATE payment_sync_log SET
            sync_status = 'failed',
            error_message = 'No working Jane API endpoint found. Please contact ClinicSync support for the correct endpoint.',
            completed_at = NOW()
          WHERE sync_id = $1
        `, [syncId]);

        return NextResponse.json({
          success: false,
          message: 'Failed to find working Jane API endpoint',
          error: 'Please contact ClinicSync support and ask for the API endpoint to pull patient membership/package data',
          triedEndpoints: JANE_API_ENDPOINTS,
          apiKeyConfigured: !!apiKey
        }, { status: 400 });
      }

      // Update sync log
      await query(`
        UPDATE payment_sync_log SET
          sync_status = 'completed',
          records_processed = $1,
          records_updated = $2,
          records_failed = $3,
          completed_at = NOW()
        WHERE sync_id = $4
      `, [totalProcessed, totalUpdated, totalFailed, syncId]);

      return NextResponse.json({
        success: true,
        message: `Sync completed. Processed: ${totalProcessed}, Updated: ${totalUpdated}, Failed: ${totalFailed}`,
        endpoint: successfulEndpoint
      });
      
    } catch (error) {
      // Update sync log as failed
      await query(`
        UPDATE payment_sync_log SET
          sync_status = 'failed',
          error_message = $1,
          completed_at = NOW()
        WHERE sync_id = $2
      `, [error instanceof Error ? error.message : 'Unknown error', syncId]);

      throw error;
    }
  } catch (error) {
    console.error('[ClinicSync] Sync error:', error);
    return NextResponse.json(
      { error: 'Failed to sync ClinicSync data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
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
