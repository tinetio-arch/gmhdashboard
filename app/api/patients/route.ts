import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { createPatient, fetchPatientDataEntries } from '@/lib/patientQueries';
import { syncPatientToGHL } from '@/lib/patientGHLSync';
import { createPatientInHealthie } from '@/lib/patientHealthieSync';
import type { ClinicType } from '@/lib/patientHealthieSync';
import { fetchPatientById } from '@/lib/patientQueries';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  await requireApiUser(request, 'read');
  try {
    const patients = await fetchPatientDataEntries();
    return NextResponse.json({ data: patients });
  } catch (error) {
    console.error('Failed to fetch patients', error);
    return NextResponse.json({ error: 'Failed to fetch patients' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let user;
  try {
    user = await requireApiUser(request, 'write');
  } catch (authError) {
    console.error('[API] Authentication error:', authError);
    return NextResponse.json(
      { error: authError instanceof Error ? authError.message : 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const timestamp = new Date().toISOString();

    // ============================================
    // DUPLICATE PREVENTION: Check before creating
    // ============================================
    let duplicateWarnings: string[] = [];
    let existingHealthieId: string | null = null;

    // 1. Check Healthie for existing patient by email/name (for cases like "von Larson" already in Healthie)
    if (body.clinic && (body.clinic === 'nowprimary.care' || body.clinic === 'nowmenshealth.care')) {
      try {
        const { searchHealthiePatients } = await import('@/lib/patientHealthieSync');
        const healthieMatches = await searchHealthiePatients({
          name: body.patientName,
          email: body.email,
          phoneNumber: body.phoneNumber
        });

        if (healthieMatches.length > 0) {
          const bestMatch = healthieMatches[0];
          duplicateWarnings.push(`Found existing Healthie patient: ${bestMatch.full_name} (ID: ${bestMatch.id})`);
          existingHealthieId = bestMatch.id;
          console.log(`[API] ⚠️  Found existing Healthie patient: ${bestMatch.full_name} (${bestMatch.id})`);
        }
      } catch (healthieSearchError) {
        console.error('[API] Healthie search error (non-blocking):', healthieSearchError);
      }
    }

    // 2. Check GMH database for potential duplicates
    const gmhDuplicates = await query(`
      SELECT patient_id, full_name, email, phone_primary, healthie_client_id
      FROM patients 
      WHERE (
        LOWER(full_name) = LOWER($1::text)
        OR ($2::text IS NOT NULL AND LOWER(email) = LOWER($2::text))
        OR ($3::text IS NOT NULL AND phone_primary = $3::text)
      )
      AND status_key != 'inactive'
      LIMIT 5
    `, [body.patientName, body.email || null, body.phoneNumber || null]);

    if (gmhDuplicates.length > 0) {
      for (const dup of gmhDuplicates) {
        duplicateWarnings.push(`Potential GMH duplicate: ${dup.full_name} (Email: ${dup.email || 'N/A'}, Phone: ${dup.phone_primary || 'N/A'})`);
      }
      console.log(`[API] ⚠️  Found ${gmhDuplicates.length} potential GMH duplicates`);
    }

    // If duplicates found and NOT force-creating, return early with warnings
    if (duplicateWarnings.length > 0 && !body.forceCreate) {
      console.log(`[API] 🚫 Blocking patient creation due to potential duplicates. Use forceCreate: true to override.`);
      return NextResponse.json({
        error: 'Potential duplicate detected',
        duplicateWarnings,
        existingHealthieId,
        hint: 'Set forceCreate: true to create anyway, or link to existing patient'
      }, { status: 409 }); // 409 Conflict
    }

    // Create patient in GMH database
    const created = await createPatient({
      patientName: body.patientName,
      statusKey: body.statusKey ?? null,
      paymentMethodKey: body.paymentMethodKey ?? null,
      clientTypeKey: body.clientTypeKey ?? null,
      clinic: body.clinic ?? null,
      regimen: body.regimen ?? null,
      patientNotes: body.patientNotes ?? null,
      lastLab: body.lastLab ?? null,
      nextLab: body.nextLab ?? null,
      labStatus: body.labStatus ?? null,
      labNotes: null,
      serviceStartDate: body.serviceStartDate ?? null,
      contractEndDate: body.contractEndDate ?? null,
      dateOfBirth: body.dateOfBirth ?? null,
      address: body.address ?? null,
      phoneNumber: body.phoneNumber ?? null,
      addedBy: user.email,
      dateAdded: body.dateAdded ?? timestamp,
      lastModified: body.lastModified ?? timestamp,
      email: body.email ?? null,
      regularClient: body.regularClient ?? false,
      isVerified: body.isVerified ?? false,
      membershipOwes: body.membershipOwes ?? null,
      eligibleForNextSupply: body.eligibleForNextSupply ?? null,
      supplyStatus: body.supplyStatus ?? null,
      membershipProgram: body.membershipProgram ?? null,
      membershipStatus: body.membershipStatus ?? null,
      membershipBalance: body.membershipBalance ?? null,
      nextChargeDate: body.nextChargeDate ?? null,
      lastChargeDate: body.lastChargeDate ?? null,
      lastSupplyDate: body.lastSupplyDate ?? null,
      lastControlledDispenseAt: body.lastControlledDispenseAt ?? null,
      lastDeaDrug: body.lastDeaDrug ?? null
    });

    console.log(`[API] ✅ Created patient in GMH database: ${created.patient_name} (${created.patient_id})`);

    // If we found an existing Healthie patient, link it instead of creating new
    if (existingHealthieId) {
      await query(
        `INSERT INTO healthie_clients (patient_id, healthie_client_id, is_active, match_method, created_at, updated_at)
         VALUES ($1, $2, TRUE, 'auto_link_on_create', NOW(), NOW())
         ON CONFLICT (healthie_client_id)
         DO UPDATE SET
           patient_id = EXCLUDED.patient_id,
           match_method = EXCLUDED.match_method,
           is_active = TRUE,
           updated_at = NOW()`,
        [created.patient_id, existingHealthieId]
      );
      console.log(`[API] ✅ Auto-linked to existing Healthie patient: ${existingHealthieId}`);
    }

    // === NEW: Sync to Healthie (synchronous - wait for completion) ===
    let healthieClientId: string | null = null;
    if (body.clinic && (body.clinic === 'nowprimary.care' || body.clinic === 'nowmenshealth.care')) {
      try {
        console.log(`[API] 🏥 Creating patient in Healthie for clinic: ${body.clinic}`);

        const healthieResult = await createPatientInHealthie({
          patientName: created.patient_name,
          email: body.email,
          phoneNumber: created.phone_number,
          dateOfBirth: created.date_of_birth,
          address: created.address,
          city: created.city,
          state: created.state,
          zip: created.postal_code,
          clinic: body.clinic as ClinicType
        });

        if (healthieResult.success && healthieResult.healthieClientId) {
          healthieClientId = healthieResult.healthieClientId;
          console.log(`[API] ✅ Created Healthie patient: ${healthieClientId}`);

          // Update patient record with Healthie ID
          await query(
            `UPDATE patients SET healthie_client_id = $1 WHERE patient_id = $2`,
            [healthieClientId, created.patient_id]
          );
          console.log(`[API] ✅ Updated GMH patient with Healthie client ID`);
        } else {
          console.error(`[API] ❌ Healthie sync failed: ${healthieResult.error}`);
          // Don't block patient creation - log and continue
        }
      } catch (healthieError) {
        const errorMsg = healthieError instanceof Error ? healthieError.message : String(healthieError);
        console.error('[API] ❌ Healthie sync exception:', errorMsg);
        // Patient is still created successfully, Healthie sync can be retried later
      }
    } else {
      console.log(`[API] ⚠️  No clinic selected - skipping Healthie sync`);
    }

    // === EXISTING: Sync to GHL (async fire-and-forget with clinic routing) ===
    (async () => {
      try {
        const patientForSync = await fetchPatientById(created.patient_id);
        if (patientForSync && user?.user_id) {
          console.log(`[API] 📞 Syncing to GHL (token is sub-account scoped, clinic: ${body.clinic || 'none'})`);

          // V2 Private Integration Tokens are sub-account scoped - don't pass location ID
          const syncResult = await syncPatientToGHL(patientForSync, user.user_id);

          if (syncResult.success) {
            console.log(`[API] ✅ Successfully synced new patient ${created.patient_name} (${created.patient_id}) to GHL. Contact ID: ${syncResult.ghlContactId || 'N/A'}`);

            // If Men's Health, add 'existing' tag
            if (body.clinic === 'nowmenshealth.care' && syncResult.ghlContactId) {
              try {
                // Import GHL client to add tag  
                const { createGHLClient } = await import('@/lib/ghl');
                const ghlClient = createGHLClient();
                if (ghlClient) {
                  await ghlClient.addTag(syncResult.ghlContactId, 'existing');
                  console.log(`[API] ✅ Added 'existing' tag to Men's Health patient in GHL`);
                }
              } catch (tagError) {
                console.error(`[API] ❌ Failed to add 'existing' tag:`, tagError);
                // Don't fail sync if tag fails
              }
            }
          } else {
            console.error(`[API] ❌ Failed to sync new patient ${created.patient_name} (${created.patient_id}) to GHL: ${syncResult.error}`);
          }
        } else {
          console.error(`[API] ⚠️  Could not fetch patient ${created.patient_id} for GHL sync`);
        }
      } catch (ghlError) {
        // Log the error but don't fail the patient creation
        const errorMsg = ghlError instanceof Error ? ghlError.message : String(ghlError);
        console.error(`[API] ❌ Failed to sync new patient ${created.patient_name} (${created.patient_id}) to GHL:`, errorMsg);
        // The patient is still created successfully, GHL sync can be retried later
        // Update patient record with error status
        try {
          await query(
            `UPDATE patients 
             SET ghl_sync_status = 'error',
                 ghl_sync_error = $1
             WHERE patient_id = $2`,
            [errorMsg.substring(0, 500), created.patient_id]
          );
        } catch (updateError) {
          console.error(`[API] Failed to update patient sync error status:`, updateError);
        }
      }
    })();

    // Return immediately without waiting for GHL sync
    return NextResponse.json({
      data: created,
      integrations: {
        healthie: healthieClientId ? 'success' : 'skipped',
        ghl: 'processing'
      }
    });
  } catch (error) {
    console.error('[API] Failed to create patient:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to create patient';

    // Log full error details for debugging
    if (error instanceof Error) {
      console.error('[API] Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
        user: user?.email || 'unknown',
        userRole: user?.role || 'unknown',
        userId: user?.user_id || 'unknown'
      });

      // Check for specific database errors
      if (error.message.includes('violates') || error.message.includes('constraint')) {
        return NextResponse.json(
          { error: 'Database constraint error. Please check all required fields are valid.' },
          { status: 400 }
        );
      }

      // Check for authentication errors
      if (error.message.includes('Unauthorized') || error.message.includes('Forbidden')) {
        return NextResponse.json(
          { error: 'You do not have permission to create patients. Please contact an administrator.' },
          { status: 403 }
        );
      }
    }

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

