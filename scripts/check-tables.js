const { Pool } = require('pg');
require('dotenv').config({ path: '.env.production' });

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

async function checkTables() {
  const client = await pool.connect();
  try {
    // Check payment_method_lookup columns
    const pmCols = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'payment_method_lookup'
      ORDER BY ordinal_position
    `);
    console.log('payment_method_lookup columns:');
    pmCols.rows.forEach(row => console.log(`  - ${row.column_name}: ${row.data_type}`));
    
    // Check client_type_lookup columns
    const ctCols = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'client_type_lookup'
      ORDER BY ordinal_position
    `);
    console.log('\nclient_type_lookup columns:');
    ctCols.rows.forEach(row => console.log(`  - ${row.column_name}: ${row.data_type}`));
    
    // Check existing payment methods
    const pms = await client.query('SELECT * FROM payment_method_lookup LIMIT 3');
    console.log('\nExample payment methods:');
    pms.rows.forEach(row => console.log(`  - ${JSON.stringify(row)}`));
    
  } finally {
    client.release();
    await pool.end();
  }
}

checkTables().catch(console.error);




