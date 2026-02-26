#!/usr/bin/env npx tsx
/**
 * Sync all Healthie BillingItems (recurring payments) to Snowflake
 * This captures membership payments and recurring charges
 * 
 * Usage: npx tsx scripts/sync-healthie-billing-items.ts
 * 
 * Table schema: BILLING_ITEM_ID, PATIENT_ID, HEALTHIE_SENDER_ID, SENDER_NAME,
 *               RECIPIENT_ID, RECIPIENT_NAME, AMOUNT_PAID, STATE, PAYMENT_DATE, SYNCED_AT
 */

import fetch from 'node-fetch';
import snowflake from 'snowflake-sdk';
import * as fs from 'fs';

// Configure logging
(snowflake as any).configure({ logLevel: 'OFF' });

const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY!;
const PRIVATE_KEY_PATH = '/home/ec2-user/.snowflake/rsa_key_new.p8';

interface BillingItem {
    id: string;
    sender_id: string | null;
    sender_name: string | null;
    recipient_id: string | null;
    recipient_name: string | null;
    amount_paid: string | null;
    state: string | null;
    created_at: string | null;
}

async function fetchAllBillingItems(): Promise<BillingItem[]> {
    const pageSize = 100;
    let offset = 0;
    const allItems: BillingItem[] = [];

    const query = `query GetBillingItems($offset: Int, $page_size: Int) {
    billingItems(offset: $offset, page_size: $page_size) {
      id
      sender_id
      sender { full_name }
      recipient_id
      recipient { full_name }
      amount_paid
      state
      created_at
    }
  }`;

    console.log('📥 Fetching billing items from Healthie...');

    while (true) {
        // Retry up to 3 times for transient errors (truncated JSON, etc.)
        let data: any;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const res = await fetch('https://api.gethealthie.com/graphql', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        authorization: `Basic ${HEALTHIE_API_KEY}`,
                        authorizationsource: 'API'
                    },
                    body: JSON.stringify({ query, variables: { offset, page_size: pageSize } })
                });
                data = await res.json() as any;
                break; // Success
            } catch (fetchErr: any) {
                console.warn(`  ⚠️ Attempt ${attempt}/3 failed at offset ${offset}: ${fetchErr.message}`);
                if (attempt === 3) throw fetchErr;
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            }
        }

        if (data.errors) {
            console.error('GraphQL Errors:', JSON.stringify(data.errors, null, 2));
            break;
        }

        const items = data.data?.billingItems || [];
        if (items.length === 0) break;

        for (const item of items) {
            allItems.push({
                id: item.id,
                sender_id: item.sender_id,
                sender_name: item.sender?.full_name || null,
                recipient_id: item.recipient_id,
                recipient_name: item.recipient?.full_name || null,
                amount_paid: item.amount_paid,
                state: item.state,
                created_at: item.created_at
            });
        }

        console.log(`  Fetched ${allItems.length} billing items so far...`);
        offset += pageSize;

        if (items.length < pageSize) break;

        // Rate limiting: 500ms delay between paginated requests
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`✅ Total billing items fetched: ${allItems.length}`);
    return allItems;
}

async function upsertToSnowflake(items: BillingItem[]): Promise<void> {
    // Read private key for JARVIS_SERVICE_ACCOUNT
    const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');

    const conn = snowflake.createConnection({
        account: 'KXWWLYZ-DZ83651',
        username: 'JARVIS_SERVICE_ACCOUNT',
        authenticator: 'SNOWFLAKE_JWT',
        privateKey: privateKey,
        warehouse: 'GMH_WAREHOUSE',
        database: 'GMH_CLINIC'
    });

    await new Promise<void>((resolve, reject) => {
        conn.connect((err) => {
            if (err) reject(err);
            else resolve();
        });
    });

    console.log('📊 Connected to Snowflake');

    // Get patient_id mappings from healthie_client_id
    const patientMapQuery = `
    SELECT HEALTHIE_CLIENT_ID, PATIENT_ID 
    FROM GMH_CLINIC.PATIENT_DATA.PATIENTS 
    WHERE HEALTHIE_CLIENT_ID IS NOT NULL`;

    const patientMap = new Map<string, string>();
    const rows: any[] = await new Promise((resolve, reject) => {
        conn.execute({
            sqlText: patientMapQuery,
            complete: (err, stmt, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        });
    });

    for (const row of rows) {
        patientMap.set(row.HEALTHIE_CLIENT_ID, row.PATIENT_ID);
    }
    console.log(`📋 Loaded ${patientMap.size} patient mappings`);

    // Upsert billing items - matching actual table schema
    const mergeSQL = `
    MERGE INTO GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_BILLING_ITEMS AS target
    USING (
      SELECT 
        ? AS BILLING_ITEM_ID,
        ? AS PATIENT_ID,
        ? AS HEALTHIE_SENDER_ID,
        ? AS SENDER_NAME,
        ? AS RECIPIENT_ID,
        ? AS RECIPIENT_NAME,
        ? AS AMOUNT_PAID,
        ? AS STATE,
        ? AS PAYMENT_DATE,
        CURRENT_TIMESTAMP() AS SYNCED_AT
    ) AS source
    ON target.BILLING_ITEM_ID = source.BILLING_ITEM_ID
    WHEN MATCHED THEN UPDATE SET
      PATIENT_ID = source.PATIENT_ID,
      HEALTHIE_SENDER_ID = source.HEALTHIE_SENDER_ID,
      SENDER_NAME = source.SENDER_NAME,
      RECIPIENT_ID = source.RECIPIENT_ID,
      RECIPIENT_NAME = source.RECIPIENT_NAME,
      AMOUNT_PAID = source.AMOUNT_PAID,
      STATE = source.STATE,
      PAYMENT_DATE = source.PAYMENT_DATE,
      SYNCED_AT = source.SYNCED_AT
    WHEN NOT MATCHED THEN INSERT (
      BILLING_ITEM_ID, PATIENT_ID, HEALTHIE_SENDER_ID, SENDER_NAME, 
      RECIPIENT_ID, RECIPIENT_NAME, AMOUNT_PAID, STATE, PAYMENT_DATE, SYNCED_AT
    ) VALUES (
      source.BILLING_ITEM_ID, source.PATIENT_ID, source.HEALTHIE_SENDER_ID,
      source.SENDER_NAME, source.RECIPIENT_ID, source.RECIPIENT_NAME,
      source.AMOUNT_PAID, source.STATE, source.PAYMENT_DATE, source.SYNCED_AT
    )`;

    let synced = 0;
    let errors = 0;

    for (const item of items) {
        const patientId = patientMap.get(item.sender_id || '') || null;
        const amountPaid = item.amount_paid ? parseFloat(item.amount_paid) : null;
        // Parse payment date from created_at (format: "2025-12-29 10:30:00 -0700")
        let paymentDate = null;
        if (item.created_at) {
            paymentDate = item.created_at.split(' ').slice(0, 2).join(' ');
        }

        try {
            await new Promise<void>((resolve, reject) => {
                conn.execute({
                    sqlText: mergeSQL,
                    binds: [
                        item.id,
                        patientId,
                        item.sender_id,
                        item.sender_name,
                        item.recipient_id,
                        item.recipient_name,
                        amountPaid,
                        item.state,
                        paymentDate
                    ] as any[],
                    complete: (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                });
            });
            synced++;
        } catch (e: any) {
            console.error(`Error syncing billing item ${item.id}:`, e.message);
            errors++;
        }
    }

    console.log(`✅ Synced ${synced} billing items, ${errors} errors`);

    conn.destroy((err) => {
        if (err) console.error('Error closing connection:', err);
    });
}

async function main() {
    if (!HEALTHIE_API_KEY) {
        console.error('Missing HEALTHIE_API_KEY');
        process.exit(1);
    }
    if (!fs.existsSync(PRIVATE_KEY_PATH)) {
        console.error(`Missing Snowflake private key at ${PRIVATE_KEY_PATH}`);
        process.exit(1);
    }

    const items = await fetchAllBillingItems();
    await upsertToSnowflake(items);

    console.log('\n🎉 Billing items sync complete!');
}

main().catch((err) => {
    console.error('Sync failed:', err);
    process.exit(1);
});
