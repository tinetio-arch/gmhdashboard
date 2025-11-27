import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const user = await requireApiUser(req, 'admin');

    const { primaryPatientId, duplicatePatientIds, action, normName, disableMembershipPackages } = await req.json();

    if (!primaryPatientId || !duplicatePatientIds || !Array.isArray(duplicatePatientIds) || duplicatePatientIds.length === 0) {
      return NextResponse.json(
        { error: 'Primary patient ID and at least one duplicate patient ID are required' },
        { status: 400 }
      );
    }

    if (!['merge', 'remove'].includes(action)) {
      return NextResponse.json(
        { error: 'Action must be either "merge" or "remove"' },
        { status: 400 }
      );
    }

    // Verify primary patient exists
    const primaryCheck = await query<{ patient_id: string }>(
      'SELECT patient_id FROM patients WHERE patient_id = $1',
      [primaryPatientId]
    );

    if (primaryCheck.length === 0) {
      return NextResponse.json(
        { error: 'Primary patient not found' },
        { status: 404 }
      );
    }

    // Verify all duplicate patients exist
    const duplicateCheck = await query<{ patient_id: string }>(
      `SELECT patient_id FROM patients WHERE patient_id = ANY($1::uuid[])`,
      [duplicatePatientIds]
    );

    if (duplicateCheck.length !== duplicatePatientIds.length) {
      return NextResponse.json(
        { error: 'One or more duplicate patients not found' },
        { status: 404 }
      );
    }

    if (action === 'merge') {
      // Merge duplicates into primary patient
      // Transfer all related data:
      // 1. Dispenses - update patient_id
      // 2. Memberships - update patient_id
      // 3. Payments - update patient_id
      // 4. DEA transactions - preserve but update patient_id
      // 5. GHL sync history - update patient_id
      // 6. Patient mappings - consolidate

      await query('BEGIN');

      try {
        // Transfer dispenses
        await query(`
          UPDATE dispenses 
          SET patient_id = $1, updated_at = NOW()
          WHERE patient_id = ANY($2::uuid[])
        `, [primaryPatientId, duplicatePatientIds]);

        // Transfer memberships (if any)
        await query(`
          UPDATE clinicsync_memberships 
          SET patient_id = $1, updated_at = NOW()
          WHERE patient_id = ANY($2::uuid[])
        `, [primaryPatientId, duplicatePatientIds]);

        // Transfer GHL sync history
        await query(`
          UPDATE ghl_sync_history 
          SET patient_id = $1, updated_at = NOW()
          WHERE patient_id = ANY($2::uuid[])
        `, [primaryPatientId, duplicatePatientIds]);

        // Consolidate patient mappings - keep active mappings from duplicates
        await query(`
          UPDATE patient_qb_mapping 
          SET patient_id = $1, updated_at = NOW()
          WHERE patient_id = ANY($2::uuid[]) 
            AND is_active = TRUE
            AND NOT EXISTS (
              SELECT 1 FROM patient_qb_mapping 
              WHERE patient_id = $1 
                AND qb_customer_id = patient_qb_mapping.qb_customer_id 
                AND is_active = TRUE
            )
        `, [primaryPatientId, duplicatePatientIds]);

        // Mark duplicate patients as inactive
        await query(`
          UPDATE patients 
          SET status_key = 'inactive',
              updated_at = NOW()
          WHERE patient_id = ANY($1::uuid[])
        `, [duplicatePatientIds]);

        // Disable/expire duplicate membership packages in jane_packages_import
        // Mark all packages for this normalized name as inactive, except those matching the primary patient
        if (disableMembershipPackages !== false && normName) {
          const primaryPatient = await query<{ full_name: string }>(
            'SELECT full_name FROM patients WHERE patient_id = $1',
            [primaryPatientId]
          );
          
          if (primaryPatient.length > 0) {
            await query(`
              UPDATE jane_packages_import
              SET status = CASE 
                WHEN status IS NULL OR status = '' THEN 'Inactive - Duplicate Resolved'
                WHEN lower(status) NOT LIKE '%inactive%' AND lower(status) NOT LIKE '%discharg%' 
                  THEN status || ' - Inactive (Duplicate Resolved)'
                ELSE status
              END
              WHERE lower(norm_name) = lower($1)
                AND lower(patient_name) != lower($2)
            `, [normName, primaryPatient[0].full_name]);
          }
        }

        // Record merge history
        for (const duplicateId of duplicatePatientIds) {
          await query(`
            INSERT INTO patient_merges (
              primary_patient_id, merged_patient_id, merged_by, merge_notes
            ) VALUES ($1, $2, $3, $4)
          `, [
            primaryPatientId,
            duplicateId,
            user.email,
            `Merged duplicate patient into primary record`
          ]);
        }

        // Track resolution
        if (normName) {
          await query(`
            INSERT INTO membership_audit_resolutions (
              normalized_name, resolution_type, resolved_at, resolved_by, resolution_notes
            ) VALUES ($1, 'duplicate_merged', NOW(), $2, $3)
            ON CONFLICT DO NOTHING
          `, [normName, user.email, `Merged ${duplicatePatientIds.length} duplicates into primary patient`]);
        }

        await query('COMMIT');

        return NextResponse.json({ 
          success: true, 
          message: `Successfully merged ${duplicatePatientIds.length} duplicate(s) into primary patient` 
        });
      } catch (error) {
        await query('ROLLBACK');
        throw error;
      }
    } else {
      // Remove duplicates (mark as inactive)
      await query(`
        UPDATE patients 
        SET status_key = 'inactive',
            updated_at = NOW()
        WHERE patient_id = ANY($1::uuid[])
      `, [duplicatePatientIds]);

      // Disable/expire duplicate membership packages
      if (disableMembershipPackages !== false && normName) {
        const primaryPatient = await query<{ full_name: string }>(
          'SELECT full_name FROM patients WHERE patient_id = $1',
          [primaryPatientId]
        );
        
        if (primaryPatient.length > 0) {
          await query(`
            UPDATE jane_packages_import
            SET status = CASE 
              WHEN status IS NULL OR status = '' THEN 'Inactive - Duplicate Removed'
              WHEN lower(status) NOT LIKE '%inactive%' AND lower(status) NOT LIKE '%discharg%'
                THEN status || ' - Inactive (Duplicate Removed)'
              ELSE status
            END
            WHERE lower(norm_name) = lower($1)
              AND lower(patient_name) != lower($2)
          `, [normName, primaryPatient[0].full_name]);
        }
      }

      // Track resolution
      if (normName) {
        await query(`
          INSERT INTO membership_audit_resolutions (
            normalized_name, resolution_type, resolved_at, resolved_by, resolution_notes
          ) VALUES ($1, 'duplicate_removed', NOW(), $2, $3)
          ON CONFLICT DO NOTHING
        `, [normName, user.email, `Removed ${duplicatePatientIds.length} duplicate patient(s)`]);
      }

      return NextResponse.json({ 
        success: true, 
        message: `Successfully removed ${duplicatePatientIds.length} duplicate(s)` 
      });
    }
  } catch (error) {
    console.error('Error resolving duplicates:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to resolve duplicates' },
      { status: 500 }
    );
  }
}

