const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function runMigration() {
  const client = new Client({
    host: process.env.DATABASE_HOST,
    port: process.env.DATABASE_PORT || 5432,
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: process.env.DATABASE_SSLMODE === 'require' ? { rejectUnauthorized: false } : false
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Read migration file
    const migrationPath = path.join(__dirname, '..', 'migrations', '20251122_add_ghl_sync.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('Running GHL sync migration...');
    await client.query(migrationSQL);
    
    console.log('Migration completed successfully!');
    console.log('Database is now ready for GoHighLevel integration.');

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Run migration
runMigration();
