#!/usr/bin/env npx tsx
/**
 * Cache Healthie Revenue to JSON File
 * Runs every 30 mins via cron to cache Snowflake data for fast API access
 * 
 * Output: /tmp/healthie-revenue-cache.json
 */
const snowflake = require('snowflake-sdk');
const fs = require('fs');
require('dotenv').config({ path: '/home/ec2-user/.env' });

const CACHE_FILE = '/tmp/healthie-revenue-cache.json';

console.log('[HealthieRevenue] Starting cache job...');

const conn = snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT || 'KXWWLYZ-DZ83651',
    username: 'JARVIS_SERVICE_ACCOUNT',
    warehouse: process.env.SNOWFLAKE_WAREHOUSE || 'GMH_WAREHOUSE',
    database: 'GMH_CLINIC',
    schema: 'FINANCIAL_DATA',
    authenticator: 'SNOWFLAKE_JWT',
    privateKey: fs.readFileSync('/home/ec2-user/.snowflake/rsa_key_new.p8', 'utf8')
});

conn.connect((err: any) => {
    if (err) {
        console.error('[HealthieRevenue] Connection error:', err.message);
        // Write error state to cache
        const errorData = { error: true, cached_at: new Date().toISOString(), day7: 0, day30: 0, successRate: 0, pending: 0 };
        fs.writeFileSync(CACHE_FILE, JSON.stringify(errorData));
        process.exit(1);
    }

    console.log('[HealthieRevenue] Connected to Snowflake');

    // 1. Get Totals
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
            if (err) {
                console.error('[HealthieRevenue] Query error:', err.message);
                conn.destroy(() => process.exit(1));
                return;
            }

            const r = rows[0];
            const successCnt = r.SUCCESS_CNT || 0;
            const failCnt = r.FAIL_CNT || 0;
            const total = successCnt + failCnt;
            const rate = total > 0 ? Math.round((successCnt / total) * 100) : 100;

            const cacheData: any = {
                cached_at: new Date().toISOString(),
                day7: r.DAY7 || 0,
                day30: r.DAY30 || 0,
                successRate: rate,
                pending: r.PENDING_CNT || 0,
                daily: []
            };

            // 2. Get Daily Breakdown
            conn.execute({
                sqlText: `
                    SELECT 
                        TO_CHAR(PAYMENT_DATE, 'YYYY-MM-DD') as day,
                        SUM(AMOUNT_PAID) as amount
                    FROM GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_BILLING_ITEMS
                    WHERE PAYMENT_DATE >= CURRENT_DATE - 30 
                      AND STATE = 'succeeded'
                    GROUP BY 1
                    ORDER BY 1 DESC
                `,
                complete: (err2: any, stmt2: any, rows2: any[]) => {
                    if (!err2 && rows2) {
                        cacheData.daily = rows2.map((row: any) => ({
                            day: row.DAY,
                            amount: row.AMOUNT
                        }));
                    }

                    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData));
                    console.log(`[HealthieRevenue] Cached: 7d=$${cacheData.day7}, 30d=$${cacheData.day30}, success=${cacheData.successRate}%`);
                    console.log(`[HealthieRevenue] Daily data points: ${cacheData.daily.length}`);
                    conn.destroy(() => process.exit(0));
                }
            });
        }
    });
});
