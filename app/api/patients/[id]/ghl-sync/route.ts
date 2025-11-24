import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { query } from '@/lib/db';

/**
 * GET /api/patients/[id]/ghl-sync
 * Get GHL sync status and history for a specific patient
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    await requireUser('read');
    const patientId = params.id;

    // Get patient's GHL sync status from patients table
    const [patientSync] = await query<{
      ghl_contact_id: string | null;
      ghl_sync_status: string | null;
      ghl_last_synced_at: string | null;
      ghl_sync_error: string | null;
      ghl_tags: string | null;
    }>(
      `SELECT 
        ghl_contact_id,
        ghl_sync_status,
        ghl_last_synced_at,
        ghl_sync_error,
        ghl_tags
      FROM patients
      WHERE patient_id = $1`,
      [patientId]
    );

    // Get sync history for this patient
    const history = await query<{
      sync_id: string;
      sync_type: string;
      ghl_contact_id: string | null;
      sync_payload: string | null;
      sync_result: string | null;
      error_message: string | null;
      created_at: string;
      created_by: string | null;
    }>(
      `SELECT 
        sh.sync_id,
        sh.sync_type,
        sh.ghl_contact_id,
        sh.sync_payload,
        sh.sync_result,
        sh.error_message,
        sh.created_at,
        sh.created_by
      FROM ghl_sync_history sh
      WHERE sh.patient_id = $1
      ORDER BY sh.created_at DESC
      LIMIT 50`,
      [patientId]
    );

    // Parse tags from JSON - ensure it's always an array
    let tags: string[] = [];
    if (patientSync?.ghl_tags) {
      try {
        const parsed = JSON.parse(patientSync.ghl_tags);
        // Handle both array and string formats
        if (Array.isArray(parsed)) {
          tags = parsed;
        } else if (typeof parsed === 'string') {
          tags = [parsed];
        } else {
          tags = [];
        }
      } catch (e) {
        console.error('Error parsing ghl_tags:', e, 'Raw value:', patientSync.ghl_tags);
        tags = [];
      }
    }

    // Get location ID from environment for GHL profile links
    const ghlLocationId = process.env.GHL_LOCATION_ID || '';

    return NextResponse.json({
      success: true,
      syncStatus: {
        ghlContactId: patientSync?.ghl_contact_id || null,
        syncStatus: patientSync?.ghl_sync_status || 'pending',
        lastSyncedAt: patientSync?.ghl_last_synced_at || null,
        syncError: patientSync?.ghl_sync_error || null,
        tags: tags,
        ghlLocationId: ghlLocationId, // Include location ID for profile links
      },
      history: history.map((h) => {
        let syncPayload = null;
        let syncResult = null;
        
        try {
          syncPayload = h.sync_payload ? JSON.parse(h.sync_payload) : null;
        } catch (e) {
          console.error('Error parsing sync_payload:', e);
        }
        
        try {
          syncResult = h.sync_result ? JSON.parse(h.sync_result) : null;
        } catch (e) {
          console.error('Error parsing sync_result:', e);
        }
        
        return {
          syncId: h.sync_id,
          syncType: h.sync_type,
          ghlContactId: h.ghl_contact_id,
          syncPayload,
          syncResult,
          errorMessage: h.error_message,
          createdAt: h.created_at,
          createdBy: h.created_by,
        };
      }),
    });
  } catch (error) {
    console.error('GHL sync status error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

