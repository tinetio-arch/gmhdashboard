const { Pool } = require('pg');
require('dotenv').config({ path: '.env.production' });

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: process.env.DATABASE_PORT,
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

async function resolveSandyPayment() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const patientId = 'a1eaa7f1-e493-4155-9bb1-05706df303b5';
    
    console.log('Resolving payment issue for Sandy Schilling...');
    
    // 1. Mark the payment issue as resolved
    const resolveResult = await client.query(`
      UPDATE payment_issues 
      SET 
        resolved_at = NOW(),
        resolved_by = NULL,
        resolution_notes = CONCAT(resolution_notes, ' | Manually resolved - patient verified as up to date')
      WHERE patient_id = $1 
        AND resolved_at IS NULL
      RETURNING *
    `, [patientId]);
    
    console.log(`Resolved ${resolveResult.rowCount} payment issues`);
    
    // 2. Update the clinicsync membership to clear the amount due
    const membershipResult = await client.query(`
      UPDATE clinicsync_memberships
      SET 
        amount_due = 0,
        balance_owing = 0,
        updated_at = NOW()
      WHERE patient_id = $1
        AND is_active = true
      RETURNING *
    `, [patientId]);
    
    console.log(`Updated ${membershipResult.rowCount} memberships`);
    
    // 3. Update patient status back to active if it was changed to hold
    const statusResult = await client.query(`
      UPDATE patients
      SET status_key = 'active'
      WHERE patient_id = $1
        AND status_key = 'hold_payment_research'
      RETURNING full_name, status_key
    `, [patientId]);
    
    if (statusResult.rowCount > 0) {
      console.log(`Updated patient status back to active`);
      
      // 4. Log the status change
      await client.query(`
        INSERT INTO patient_status_activity_log 
          (patient_id, previous_status, new_status, changed_by_user_id, change_reason, created_at)
        VALUES 
          ($1, 'hold_payment_research', 'active', NULL, 'Payment issue manually resolved - patient verified as up to date', NOW())
      `, [patientId]);
    }
    
    await client.query('COMMIT');
    console.log('Successfully resolved Sandy Schilling\'s payment issue!');
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error resolving payment:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the resolution
resolveSandyPayment().catch(console.error);
