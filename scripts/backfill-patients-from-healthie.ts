/**
 * Backfill patient data from Healthie
 *
 * Fills in missing fields (DOB, address, clinic, gender, payment method, client type)
 * for patients that have a healthie_client_id link but are missing local data.
 *
 * Healthie is the source of truth. Only fills NULL/empty fields — never overwrites staff data.
 *
 * Usage:
 *   DRY_RUN=true npx tsx scripts/backfill-patients-from-healthie.ts   # preview changes
 *   npx tsx scripts/backfill-patients-from-healthie.ts                 # execute
 */

import dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/.env' });
dotenv.config({ path: '.env.local' });

import { Pool } from 'pg';

const DRY_RUN = process.env.DRY_RUN === 'true';
const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT || 5432),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

// Rate limit: 5 req/sec
async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHealthieUser(healthieId: string): Promise<any | null> {
  try {
    const res = await fetch(HEALTHIE_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${HEALTHIE_API_KEY}`,
        'AuthorizationSource': 'API',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `query GetUser($id: ID) {
          user(id: $id) {
            id first_name last_name email phone_number dob gender
            active
            user_group { id name }
            location { line1 line2 city state zip }
          }
        }`,
        variables: { id: healthieId },
      }),
    });
    const json = await res.json() as any;
    return json?.data?.user || null;
  } catch (err) {
    console.error(`  Failed to fetch Healthie user ${healthieId}:`, err);
    return null;
  }
}

function mapGroupToClinic(groupName: string | null): string | null {
  if (!groupName) return null;
  const lower = groupName.toLowerCase();
  if (lower.includes('menshealth')) return 'nowmenshealth.care';
  if (lower.includes('primary')) return 'nowprimary.care';
  return null;
}

function mapGroupToClientType(groupName: string | null): { key: string; label: string } | null {
  if (!groupName) return null;
  const lower = groupName.toLowerCase();
  if (lower.includes('menshealth')) return { key: 'nowmenshealth', label: 'NowMensHealth.Care' };
  if (lower.includes('primary')) return { key: 'nowprimarycare', label: 'NowPrimary.Care' };
  return null;
}

async function main() {
  if (!HEALTHIE_API_KEY) {
    console.error('Missing HEALTHIE_API_KEY');
    process.exit(1);
  }

  console.log(`\n${ DRY_RUN ? '🔍 DRY RUN' : '🔧 LIVE RUN'} — Backfilling patient data from Healthie\n`);

  // Get all patients with Healthie links that are missing data
  const patients = await pool.query(`
    SELECT p.patient_id, p.full_name, p.dob, p.address_line1, p.city, p.state, p.postal_code,
           p.clinic, p.payment_method_key, p.client_type_key, p.gender, p.added_by,
           hc.healthie_client_id
    FROM patients p
    JOIN healthie_clients hc ON hc.patient_id = p.patient_id::text AND hc.is_active = true
    WHERE p.status_key NOT IN ('inactive', 'discharged')
    ORDER BY p.full_name
  `);

  console.log(`Found ${patients.rows.length} active patients with Healthie links\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < patients.rows.length; i++) {
    const p = patients.rows[i];

    // Rate limit
    if (i > 0 && i % 5 === 0) await sleep(1000);

    const healthieUser = await fetchHealthieUser(p.healthie_client_id);
    if (!healthieUser) {
      console.log(`  ❌ ${p.full_name} — Healthie fetch failed`);
      errors++;
      continue;
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    // DOB
    if (!p.dob && healthieUser.dob) {
      updates.push(`dob = $${paramIdx++}`);
      values.push(healthieUser.dob);
    }

    // Address
    const loc = healthieUser.location;
    if ((!p.address_line1 || p.address_line1 === '') && loc?.line1) {
      updates.push(`address_line1 = $${paramIdx++}`);
      values.push(loc.line1);
    }
    if ((!p.city || p.city === '') && loc?.city) {
      updates.push(`city = $${paramIdx++}`);
      values.push(loc.city);
    }
    if ((!p.state || p.state === '') && loc?.state) {
      updates.push(`state = $${paramIdx++}`);
      values.push(loc.state);
    }
    if ((!p.postal_code || p.postal_code === '') && loc?.zip) {
      updates.push(`postal_code = $${paramIdx++}`);
      values.push(loc.zip);
    }

    // Gender
    if (!p.gender && healthieUser.gender) {
      updates.push(`gender = $${paramIdx++}`);
      values.push(healthieUser.gender);
    }

    // Clinic (from Healthie group)
    const groupName = healthieUser.user_group?.name || null;
    const clinic = mapGroupToClinic(groupName);
    if ((!p.clinic || p.clinic === '') && clinic) {
      updates.push(`clinic = $${paramIdx++}`);
      values.push(clinic);
    }

    // For auto-provisioned patients: also fill payment method and client type
    if (p.added_by === 'auto-provision-NEEDS-DATA') {
      if (!p.payment_method_key || p.payment_method_key === '') {
        updates.push(`payment_method_key = $${paramIdx++}`);
        values.push('healthie');
        updates.push(`payment_method = $${paramIdx++}`);
        values.push('Healthie');
      }

      const clientType = mapGroupToClientType(groupName);
      if ((!p.client_type_key || p.client_type_key === '') && clientType) {
        updates.push(`client_type_key = $${paramIdx++}`);
        values.push(clientType.key);
        updates.push(`client_type = $${paramIdx++}`);
        values.push(clientType.label);
      }
    }

    if (updates.length === 0) {
      skipped++;
      continue;
    }

    updates.push(`updated_at = NOW()`);
    values.push(p.patient_id);
    const sql = `UPDATE patients SET ${updates.join(', ')} WHERE patient_id = $${paramIdx}`;

    if (DRY_RUN) {
      console.log(`  📝 ${p.full_name}: would update ${updates.filter(u => !u.startsWith('updated_at')).join(', ')}`);
    } else {
      await pool.query(sql, values);
      console.log(`  ✅ ${p.full_name}: updated ${updates.filter(u => !u.startsWith('updated_at')).length} fields`);
    }
    updated++;
  }

  console.log(`\n${ DRY_RUN ? '🔍 DRY RUN' : '✅ DONE'} — ${updated} updated, ${skipped} already complete, ${errors} errors\n`);

  await pool.end();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
