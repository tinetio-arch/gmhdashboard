const { Pool } = require('pg');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.production' });

const execAsync = promisify(exec);

async function createBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const backupDir = '/home/ec2-user/backups';
  const backupFile = path.join(backupDir, `gmh-dashboard-backup-${timestamp}.sql`);
  
  // Ensure backup directory exists
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  const {
    DATABASE_HOST,
    DATABASE_USER,
    DATABASE_PASSWORD,
    DATABASE_NAME
  } = process.env;
  
  console.log('📦 Creating database backup...');
  console.log(`Database: ${DATABASE_NAME}`);
  console.log(`Backup file: ${backupFile}`);
  
  try {
    // Create custom format backup (compressed)
    const customBackupFile = backupFile.replace('.sql', '.dump');
    const pgDumpCmd = `PGPASSWORD="${DATABASE_PASSWORD}" pg_dump -h ${DATABASE_HOST} -U ${DATABASE_USER} -d ${DATABASE_NAME} --no-owner --no-acl -F c -f "${customBackupFile}"`;
    
    console.log('Running pg_dump...');
    await execAsync(pgDumpCmd);
    
    // Also create a plain SQL backup for easy inspection
    const sqlDumpCmd = `PGPASSWORD="${DATABASE_PASSWORD}" pg_dump -h ${DATABASE_HOST} -U ${DATABASE_USER} -d ${DATABASE_NAME} --no-owner --no-acl -F p -f "${backupFile}"`;
    
    console.log('Creating SQL dump...');
    await execAsync(sqlDumpCmd);
    
    // Get file sizes
    const customStats = fs.statSync(customBackupFile);
    const sqlStats = fs.statSync(backupFile);
    
    console.log('\n✅ Backup completed successfully!');
    console.log(`Custom format: ${customBackupFile} (${(customStats.size / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`SQL format: ${backupFile} (${(sqlStats.size / 1024 / 1024).toFixed(2)} MB)`);
    
    // List recent backups
    const backups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('gmh-dashboard-backup-'))
      .map(f => {
        const stats = fs.statSync(path.join(backupDir, f));
        return { name: f, size: stats.size, date: stats.mtime };
      })
      .sort((a, b) => b.date - a.date)
      .slice(0, 5);
    
    console.log('\n📋 Recent backups:');
    backups.forEach((b, i) => {
      console.log(`  ${i + 1}. ${b.name} (${(b.size / 1024 / 1024).toFixed(2)} MB) - ${b.date.toISOString()}`);
    });
    
  } catch (error) {
    console.error('❌ Backup failed:', error.message);
    process.exit(1);
  }
}

createBackup().catch(console.error);




