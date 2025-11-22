import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query, getPool } from '@/lib/db';
import { stripHonorifics } from '@/lib/nameUtils';

interface UnmappedPatient {
  clinicsync_patient_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  alt_phone: string | null;
  dob: string | null;
  membership_plan: string | null;
  is_active: boolean;
  raw_payload: any;
}

interface DiagnosticResult {
  clinicsync_patient_id: string;
  full_name: string;
  membership_plan: string | null;
  missing_fields: string[];
  potential_matches: {
    by_email?: { patient_id: string; full_name: string; confidence: number };
    by_phone?: { patient_id: string; full_name: string; confidence: number };
    by_name_dob?: { patient_id: string; full_name: string; confidence: number };
    by_name_only?: { patient_id: string; full_name: string; confidence: number };
  };
  match_failure_reasons: string[];
  recommendations: string[];
}

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.length >= 10 ? cleaned : null;
}

export async function GET(req: NextRequest) {
  try {
    await requireApiUser(req, 'admin');

    // Get unmapped ClinicSync patients
    const unmappedPatients = await query<UnmappedPatient>(`
      SELECT 
        cm.clinicsync_patient_id,
        cm.full_name,
        cm.email,
        cm.phone,
        cm.alt_phone,
        cm.dob,
        cm.membership_plan,
        cm.is_active,
        cm.raw_payload
      FROM clinicsync_memberships cm
      LEFT JOIN patient_clinicsync_mapping pcm ON cm.clinicsync_patient_id = pcm.clinicsync_patient_id
      WHERE pcm.patient_id IS NULL
        AND cm.is_active = true
      ORDER BY cm.full_name
      LIMIT 50
    `);

    const pool = getPool();
    const client = await pool.connect();
    
    try {
      const diagnostics: DiagnosticResult[] = [];

      for (const patient of unmappedPatients) {
        const result: DiagnosticResult = {
          clinicsync_patient_id: patient.clinicsync_patient_id,
          full_name: patient.full_name,
          membership_plan: patient.membership_plan,
          missing_fields: [],
          potential_matches: {},
          match_failure_reasons: [],
          recommendations: []
        };

        // Check missing fields
        if (!patient.email) result.missing_fields.push('email');
        if (!patient.phone && !patient.alt_phone) result.missing_fields.push('phone');
        if (!patient.dob) result.missing_fields.push('date of birth');

        // Try email match
        if (patient.email) {
          const emailMatch = await client.query<{ patient_id: string; full_name: string }>(
            `SELECT patient_id, full_name FROM patients 
             WHERE LOWER(email) = LOWER($1) 
             ORDER BY updated_at DESC LIMIT 1`,
            [patient.email]
          );
          if (emailMatch.rows.length > 0) {
            result.potential_matches.by_email = {
              ...emailMatch.rows[0],
              confidence: 0.95
            };
          } else {
            result.match_failure_reasons.push(`No patient with email: ${patient.email}`);
          }
        }

        // Try phone match
        const normalizedPhone = normalizePhone(patient.phone) || normalizePhone(patient.alt_phone);
        if (normalizedPhone) {
          const phoneMatch = await client.query<{ patient_id: string; full_name: string }>(
            `SELECT patient_id, full_name FROM patients 
             WHERE regexp_replace(COALESCE(phone_primary, ''), '\\D', '', 'g') = $1 
             ORDER BY updated_at DESC LIMIT 1`,
            [normalizedPhone]
          );
          if (phoneMatch.rows.length > 0) {
            result.potential_matches.by_phone = {
              ...phoneMatch.rows[0],
              confidence: 0.9
            };
          } else {
            result.match_failure_reasons.push(`No patient with phone: ${normalizedPhone}`);
          }
        }

        // Try name + DOB match
        if (patient.full_name && patient.dob) {
          const normalizedName = stripHonorifics(patient.full_name).toLowerCase().trim();
          const nameDobMatch = await client.query<{ patient_id: string; full_name: string }>(
            `SELECT patient_id, full_name FROM patients 
             WHERE LOWER(TRIM(REGEXP_REPLACE(full_name, '^(Mr\.|Mrs\.|Ms\.|Miss|Dr\.|Prof\.|Sir|Madam|Rev\.|Fr\.)\\s+', '', 'gi'))) = $1
               AND dob = $2 
             LIMIT 1`,
            [normalizedName, patient.dob]
          );
          if (nameDobMatch.rows.length > 0) {
            result.potential_matches.by_name_dob = {
              ...nameDobMatch.rows[0],
              confidence: 0.85
            };
          } else {
            // Check if name exists but DOB doesn't match
            const nameOnlyCheck = await client.query<{ patient_id: string; full_name: string; dob: string | null }>(
              `SELECT patient_id, full_name, dob FROM patients 
               WHERE LOWER(TRIM(REGEXP_REPLACE(full_name, '^(Mr\.|Mrs\.|Ms\.|Miss|Dr\.|Prof\.|Sir|Madam|Rev\.|Fr\.)\\s+', '', 'gi'))) = $1
               LIMIT 5`,
              [normalizedName]
            );
            if (nameOnlyCheck.rows.length > 0) {
              result.match_failure_reasons.push(
                `Found ${nameOnlyCheck.rows.length} patient(s) with name "${patient.full_name}" but DOB doesn't match`
              );
              nameOnlyCheck.rows.forEach(row => {
                if (row.dob) {
                  result.match_failure_reasons.push(
                    `  - ${row.full_name} has DOB: ${row.dob} (expected: ${patient.dob})`
                  );
                }
              });
            }
          }
        }

        // Try name-only match
        if (patient.full_name) {
          const normalizedName = stripHonorifics(patient.full_name).toLowerCase().trim();
          const nameOnlyMatch = await client.query<{ patient_id: string; full_name: string }>(
            `SELECT patient_id, full_name FROM patients 
             WHERE LOWER(TRIM(REGEXP_REPLACE(full_name, '^(Mr\.|Mrs\.|Ms\.|Miss|Dr\.|Prof\.|Sir|Madam|Rev\.|Fr\.)\\s+', '', 'gi'))) = $1
               AND status_key NOT IN ('inactive', 'discharged')
             ORDER BY updated_at DESC LIMIT 1`,
            [normalizedName]
          );
          if (nameOnlyMatch.rows.length > 0) {
            result.potential_matches.by_name_only = {
              ...nameOnlyMatch.rows[0],
              confidence: 0.7
            };
          } else {
            result.match_failure_reasons.push(`No active patient with name: ${patient.full_name}`);
          }
        }

        // Generate recommendations
        if (result.missing_fields.includes('email') && result.missing_fields.includes('phone')) {
          result.recommendations.push('Add email OR phone number to improve matching');
        }
        if (result.missing_fields.includes('date of birth')) {
          result.recommendations.push('Add date of birth for more accurate name matching');
        }
        if (Object.keys(result.potential_matches).length > 0) {
          result.recommendations.push('Potential matches found - review and manually link if correct');
        }
        if (result.match_failure_reasons.some(r => r.includes('DOB doesn\'t match'))) {
          result.recommendations.push('Verify and correct date of birth in ClinicSync/Jane');
        }

        diagnostics.push(result);
      }

      // Check for potential duplicates in patients table
      const duplicateCheck = await client.query<{ full_name: string; count: string; patient_ids: string }>(
        `SELECT 
          LOWER(TRIM(REGEXP_REPLACE(full_name, '^(Mr\.|Mrs\.|Ms\.|Miss|Dr\.|Prof\.|Sir|Madam|Rev\.|Fr\.)\\s+', '', 'gi'))) as full_name,
          COUNT(*) as count,
          STRING_AGG(patient_id::text, ', ') as patient_ids
        FROM patients
        WHERE status_key NOT IN ('inactive', 'discharged')
        GROUP BY LOWER(TRIM(REGEXP_REPLACE(full_name, '^(Mr\.|Mrs\.|Ms\.|Miss|Dr\.|Prof\.|Sir|Madam|Rev\.|Fr\.)\\s+', '', 'gi')))
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC
        LIMIT 10`
      );

      // Summary statistics
      const summary = {
        total_unmapped: unmappedPatients.length,
        missing_email: diagnostics.filter(d => d.missing_fields.includes('email')).length,
        missing_phone: diagnostics.filter(d => d.missing_fields.includes('phone')).length,
        missing_dob: diagnostics.filter(d => d.missing_fields.includes('date of birth')).length,
        has_potential_matches: diagnostics.filter(d => Object.keys(d.potential_matches).length > 0).length,
        no_matches_found: diagnostics.filter(d => Object.keys(d.potential_matches).length === 0).length,
        duplicate_patients: duplicateCheck.rows
      };

      return NextResponse.json({
        summary,
        diagnostics,
        recommendations: [
          'Ensure all ClinicSync/Jane patients have email addresses',
          'Add phone numbers where missing',
          'Verify dates of birth are correctly formatted (YYYY-MM-DD)',
          'Consider manual mapping for patients with potential matches',
          'Check for duplicate patient records in the main patients table'
        ]
      });

    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Mapping diagnostics error:', error);
    return NextResponse.json(
      { error: 'Failed to generate mapping diagnostics' },
      { status: 500 }
    );
  }
}
