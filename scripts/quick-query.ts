#!/usr/bin/env npx tsx
/**
 * Quick one-off Snowflake query script
 * Usage: npx tsx scripts/quick-query.ts "SELECT * FROM ..."
 */

import * as snowflake from 'snowflake-sdk';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = process.argv[2];
if (!sql) {
  console.error('Usage: npx tsx scripts/quick-query.ts "SELECT * FROM ..."');
  process.exit(1);
}

// Suppress Snowflake SDK logs
(snowflake as any).configure({ logLevel: 'OFF' });

const conn = snowflake.createConnection({
  account: process.env.SNOWFLAKE_ACCOUNT || 'KXWWLYZ-DZ83651',
  username: process.env.SNOWFLAKE_USER || 'tinetio123',
  password: process.env.SNOWFLAKE_PASSWORD!,
  warehouse: process.env.SNOWFLAKE_WAREHOUSE || 'GMH_WAREHOUSE',
  database: process.env.SNOWFLAKE_DATABASE || 'GMH_CLINIC'
});

conn.connect((err) => {
  if (err) {
    console.error('Connection error:', err.message);
    process.exit(1);
  }
  
  conn.execute({
    sqlText: sql,
    complete: (err, stmt, rows) => {
      if (err) {
        console.error('Query error:', err.message);
        process.exit(1);
      }
      console.log(JSON.stringify(rows, null, 2));
      conn.destroy(() => process.exit(0));
    }
  });
});
