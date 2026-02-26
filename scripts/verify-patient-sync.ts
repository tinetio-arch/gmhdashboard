/**
 * End-to-end verification script
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { Pool } from 'pg';

const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || '5432'),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

async function verify() {
    console.log('='.repeat(70));
    console.log('END-TO-END VERIFICATION REPORT');
    console.log('='.repeat(70));

    // 1. Overall patient counts
    const totalActive = await pool.query(`
    SELECT COUNT(*) as count FROM patients 
    WHERE (status_key != 'inactive' OR status_key IS NULL)
  `);
    console.log('\n📊 PATIENT COUNTS');
    console.log('-'.repeat(70));
    console.log('Total active patients: ' + totalActive.rows[0].count);

    // 2. Healthie linkage (from view)
    const healthie = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(healthie_id) as linked
    FROM patient_data_entry_v
  `);
    const healthieLinked = parseInt(healthie.rows[0].linked);
    const healthieTotal = parseInt(healthie.rows[0].total);
    console.log('\n🏥 HEALTHIE LINKAGE');
    console.log('-'.repeat(70));
    console.log('Linked to Healthie: ' + healthieLinked + '/' + healthieTotal + ' (' + Math.round(healthieLinked / healthieTotal * 100) + '%)');

    // 3. GHL sync status
    const ghl = await pool.query(`
    SELECT 
      ghl_sync_status,
      COUNT(*) as count,
      COUNT(ghl_contact_id) as with_id
    FROM patients
    WHERE (status_key != 'inactive' OR status_key IS NULL)
    GROUP BY ghl_sync_status
    ORDER BY count DESC
  `);
    console.log('\n📱 GHL SYNC STATUS');
    console.log('-'.repeat(70));
    let ghlSynced = 0;
    let ghlTotal = 0;
    ghl.rows.forEach(r => {
        const status = r.ghl_sync_status || 'null';
        const count = parseInt(r.count);
        ghlTotal += count;
        console.log('  ' + status.padEnd(15) + ': ' + count + ' (' + r.with_id + ' with GHL ID)');
        if (status === 'synced') ghlSynced = count;
    });
    console.log('GHL Sync Rate: ' + Math.round(ghlSynced / ghlTotal * 100) + '%');

    // 4. Patient routing breakdown
    const routing = await pool.query(`
    SELECT 
      CASE 
        WHEN client_type_key ILIKE '%primecare%' OR client_type_key ILIKE '%nowprimarycare%'
        THEN 'Primary Care'
        ELSE 'Mens Health' 
      END as ghl_location,
      COUNT(*) as count
    FROM patients
    WHERE (status_key != 'inactive' OR status_key IS NULL)
    GROUP BY 1
    ORDER BY 1
  `);
    console.log('\n🗺️  GHL PATIENT ROUTING');
    console.log('-'.repeat(70));
    routing.rows.forEach(r => console.log('  ' + r.ghl_location.padEnd(15) + ': ' + r.count + ' patients'));

    // 5. Errors/issues remaining
    const errors = await pool.query(`
    SELECT 
      ghl_sync_error,
      COUNT(*) as count
    FROM patients
    WHERE ghl_sync_status = 'error' AND (status_key != 'inactive' OR status_key IS NULL)
    GROUP BY ghl_sync_error
    ORDER BY count DESC
    LIMIT 5
  `);
    console.log('\n⚠️  REMAINING SYNC ERRORS');
    console.log('-'.repeat(70));
    if (errors.rows.length === 0) {
        console.log('  None! ✅');
    } else {
        errors.rows.forEach(r => console.log('  ' + r.count + 'x: ' + (r.ghl_sync_error || 'unknown').substring(0, 55)));
    }

    // 6. Duplicate phone check remaining
    const duplicates = await pool.query(`
    SELECT phone_number, COUNT(*) as cnt
    FROM patient_data_entry_v pde
    JOIN patients p ON pde.patient_id::text = p.patient_id::text
    WHERE phone_number IS NOT NULL AND phone_number != ''
      AND (p.status_key != 'inactive' OR p.status_key IS NULL)
    GROUP BY phone_number
    HAVING COUNT(*) > 1
  `);
    console.log('\n👥 DUPLICATE PHONE NUMBERS (Active Patients Only)');
    console.log('-'.repeat(70));
    console.log('  Remaining phone duplicates: ' + duplicates.rows.length);
    if (duplicates.rows.length > 0) {
        console.log('  (Note: Some may be family members sharing phone)');
    }

    // 7. Missing contact info
    const missing = await pool.query(`
    SELECT 
      SUM(CASE WHEN pde.email IS NULL OR pde.email = '' THEN 1 ELSE 0 END) as no_email,
      SUM(CASE WHEN pde.phone_number IS NULL OR pde.phone_number = '' THEN 1 ELSE 0 END) as no_phone,
      SUM(CASE WHEN (pde.email IS NULL OR pde.email = '') AND (pde.phone_number IS NULL OR pde.phone_number = '') THEN 1 ELSE 0 END) as no_contact
    FROM patient_data_entry_v pde
    JOIN patients p ON pde.patient_id::text = p.patient_id::text
    WHERE (p.status_key != 'inactive' OR p.status_key IS NULL)
  `);
    console.log('\n📋 CONTACT INFO GAPS');
    console.log('-'.repeat(70));
    console.log('  Patients without email: ' + missing.rows[0].no_email);
    console.log('  Patients without phone: ' + missing.rows[0].no_phone);
    console.log('  Patients without either: ' + missing.rows[0].no_contact + ' (cannot sync to GHL)');

    console.log('\n' + '='.repeat(70));
    console.log('✅ VERIFICATION COMPLETE');
    console.log('='.repeat(70));

    await pool.end();
}

verify().catch(console.error);
