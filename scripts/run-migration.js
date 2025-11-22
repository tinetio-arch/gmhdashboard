const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.production' });

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  port: 5432,
  ssl: {
    rejectUnauthorized: false
  }
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('Connected to database');
    
    // Run each part of the migration separately
    console.log('1. Adding columns to clinicsync_memberships...');
    await client.query(`
      ALTER TABLE clinicsync_memberships 
      ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS membership_rank INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS combined_tier TEXT
    `);
    
    console.log('2. Creating index...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_clinicsync_patient_active_multi 
      ON clinicsync_memberships (patient_id, is_active, membership_rank)
    `);
    
    console.log('3. Adding jane_quickbooks payment method...');
    await client.query(`
      INSERT INTO payment_method_lookup (method_key, display_name, hex_color, is_active)
      VALUES ('jane_quickbooks', 'Jane & QuickBooks', '#a4c2f4', true)
      ON CONFLICT (method_key) DO NOTHING
    `);
    
    console.log('4. Adding mixed client type...');
    await client.query(`
      INSERT INTO client_type_lookup (type_key, display_name, hex_color, is_primary_care, is_active)
      VALUES ('mixed_primcare_jane_qbo_tcmh', 'Mixed Primcare (Jane) | QBO TCMH', '#76a5af', true, true)
      ON CONFLICT (type_key) DO NOTHING
    `);
    
    console.log('5. Adding row_style_class column...');
    await client.query(`
      ALTER TABLE patients 
      ADD COLUMN IF NOT EXISTS row_style_class TEXT
    `);
    
    console.log('6. Creating patient_multi_memberships view...');
    await client.query(`
      CREATE OR REPLACE VIEW patient_multi_memberships AS
      SELECT 
          p.patient_id,
          p.full_name,
          COUNT(DISTINCT cm.clinicsync_patient_id) as active_membership_count,
          STRING_AGG(DISTINCT cm.membership_plan, ' + ' ORDER BY cm.membership_plan) as combined_plans,
          STRING_AGG(DISTINCT cm.pass_id::text, ',' ORDER BY cm.pass_id::text) as pass_ids,
          MAX(CASE WHEN cm.is_active = FALSE THEN 1 ELSE 0 END) as has_expired_memberships
      FROM patients p
      JOIN clinicsync_memberships cm ON p.patient_id = cm.patient_id
      WHERE cm.is_active = TRUE OR cm.contract_end_date > CURRENT_DATE - INTERVAL '90 days'
      GROUP BY p.patient_id, p.full_name
      HAVING COUNT(DISTINCT cm.clinicsync_patient_id) > 1 
          OR MAX(CASE WHEN cm.is_active = FALSE THEN 1 ELSE 0 END) = 1
    `);
    
    console.log('7. Creating update_mixed_payment_patients function...');
    await client.query(`
      CREATE OR REPLACE FUNCTION update_mixed_payment_patients() 
      RETURNS void AS $$
      BEGIN
          UPDATE patients p
          SET 
              payment_method_key = 'jane_quickbooks',
              client_type_key = CASE 
                  WHEN p.client_type_key IN ('primary_care', 'primcare', 'primary') 
                  THEN 'mixed_primcare_jane_qbo_tcmh'
                  ELSE p.client_type_key
              END,
              row_style_class = 'mixed-payment-lightblue',
              updated_at = NOW()
          WHERE EXISTS (
              SELECT 1 FROM patient_qb_mapping qb 
              WHERE qb.patient_id = p.patient_id 
              AND qb.is_active = TRUE
          )
          AND EXISTS (
              SELECT 1 FROM clinicsync_memberships cm 
              WHERE cm.patient_id = p.patient_id 
              AND cm.is_active = TRUE
          )
          AND p.payment_method_key != 'jane_quickbooks';
      END;
      $$ LANGUAGE plpgsql
    `);
    
    console.log('8. Running update_mixed_payment_patients...');
    await client.query('SELECT update_mixed_payment_patients()');
    
    // Check results
    const mixedCount = await client.query(
      "SELECT COUNT(*) FROM patients WHERE payment_method_key = 'jane_quickbooks'"
    );
    console.log(`\nMigration completed successfully!`);
    console.log(`Mixed payment patients updated: ${mixedCount.rows[0].count}`);
    
    // Show some examples
    const examples = await client.query(`
      SELECT full_name, payment_method_key, client_type_key, row_style_class
      FROM patients 
      WHERE payment_method_key = 'jane_quickbooks'
      LIMIT 5
    `);
    
    if (examples.rows.length > 0) {
      console.log('\nExample mixed payment patients:');
      examples.rows.forEach(row => {
        console.log(`- ${row.full_name}: ${row.client_type_key}`);
      });
    }
    
  } catch (error) {
    console.error('Migration error:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the migration
runMigration().catch(console.error);
