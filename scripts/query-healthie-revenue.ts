#!/usr/bin/env npx tsx
/**
 * Healthie Revenue Query
 * Queries Snowflake HEALTHIE_BILLING_ITEMS for revenue data
 * Returns: day7,day30,successRate,pendingCount
 */
const snowflake = require('snowflake-sdk');
const fs = require('fs');
require('dotenv').config({ path: '/home/ec2-user/.env' });

const conn = snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT,
    username: process.env.SNOWFLAKE_USER || process.env.SNOWFLAKE_USERNAME,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    database: 'GMH_CLINIC',
    schema: 'FINANCIAL_DATA',
    authenticator: 'SNOWFLAKE_JWT',
    privateKey: fs.readFileSync('/home/ec2-user/.snowflake/rsa_key_new.p8', 'utf8')
});

conn.connect((err: any) => {
    if (err) {
        console.log('0,0,100,0');
        process.exit(0);
    }

    conn.execute({
        sqlText: `
            SELECT 
                COALESCE(SUM(CASE WHEN PAYMENT_DATE >= CURRENT_DATE - 7 AND STATE = 'succeeded' THEN AMOUNT_PAID ELSE 0 END), 0) as day7,
                COALESCE(SUM(CASE WHEN PAYMENT_DATE >= CURRENT_DATE - 30 AND STATE = 'succeeded' THEN AMOUNT_PAID ELSE 0 END), 0) as day30,
                COALESCE(COUNT(CASE WHEN STATE = 'succeeded' THEN 1 END), 0) as success_cnt,
                COALESCE(COUNT(CASE WHEN STATE = 'failed' OR STATE = 'declined' THEN 1 END), 0) as fail_cnt,
                COALESCE(COUNT(CASE WHEN STATE = 'scheduled' OR STATE = 'pending' THEN 1 END), 0) as pending_cnt
            FROM GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_BILLING_ITEMS
            WHERE PAYMENT_DATE >= CURRENT_DATE - 30
        `,
        complete: (err: any, stmt: any, rows: any[]) => {
            if (err || !rows || rows.length === 0) {
                console.log('0,0,100,0');
            } else {
                const r = rows[0];
                const successCnt = r.SUCCESS_CNT || 0;
                const failCnt = r.FAIL_CNT || 0;
                const total = successCnt + failCnt;
                const rate = total > 0 ? Math.round((successCnt / total) * 100) : 100;
                console.log(`${r.DAY7},${r.DAY30},${rate},${r.PENDING_CNT || 0}`);
            }
            conn.destroy(() => process.exit(0));
        }
    });
});
