#!/usr/bin/env npx tsx
/**
 * Sync all Healthie RequestedPayments (invoices) to Snowflake
 * Fetches full invoice details including price, balance, dates
 * 
 * Usage: npx tsx scripts/sync-healthie-invoices.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/.env' });
dotenv.config({ path: '.env.local' });

import fetch from 'node-fetch';
import snowflake from 'snowflake-sdk';
import * as fs from 'fs';

// Configure logging
(snowflake as any).configure({ logLevel: 'OFF' });

const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY!;
const PRIVATE_KEY_PATH = '/home/ec2-user/.snowflake/rsa_key_new.p8';

interface RequestedPayment {
  id: string;
  recipient_id: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  sender_name: string | null;
  price: string | null;
  balance_due: number | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  paid_at: string | null;
  email_sent_at: string | null;
  invoice_type: string | null;
  offering_name: string | null;
  currency: string | null;
}

async function fetchAllInvoices(): Promise<RequestedPayment[]> {
  const pageSize = 50;
  let offset = 0;
  const allInvoices: RequestedPayment[] = [];

  const query = `query GetRequestedPayments($offset: Int, $page_size: Int) {
    requestedPayments(offset: $offset, page_size: $page_size) {
      id
      recipient_id
      recipient { full_name email }
      sender { full_name }
      price
      balance_due
      status
      created_at
      updated_at
      paid_at
      email_sent_at
      invoice_type
      offering { name }
      currency
    }
  }`;

  console.log('📥 Fetching invoices from Healthie...');

  while (true) {
    const res = await fetch('https://api.gethealthie.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Basic ${HEALTHIE_API_KEY}`,
        authorizationsource: 'API'
      },
      body: JSON.stringify({ query, variables: { offset, page_size: pageSize } })
    });

    const data = await res.json() as any;

    if (data.errors) {
      console.error('GraphQL Errors:', JSON.stringify(data.errors, null, 2));
      break;
    }

    const invoices = data.data?.requestedPayments || [];
    if (invoices.length === 0) break;

    for (const inv of invoices) {
      allInvoices.push({
        id: inv.id,
        recipient_id: inv.recipient_id,
        recipient_name: inv.recipient?.full_name || null,
        recipient_email: inv.recipient?.email || null,
        sender_name: inv.sender?.full_name || null,
        price: inv.price,
        balance_due: inv.balance_due,
        status: inv.status,
        created_at: inv.created_at,
        updated_at: inv.updated_at,
        paid_at: inv.paid_at,
        email_sent_at: inv.email_sent_at,
        invoice_type: inv.invoice_type,
        offering_name: inv.offering?.name || null,
        currency: inv.currency || 'USD'
      });
    }

    console.log(`  Fetched ${allInvoices.length} invoices so far...`);
    offset += pageSize;

    if (invoices.length < pageSize) break;
  }

  console.log(`✅ Total invoices fetched: ${allInvoices.length}`);
  return allInvoices;
}

async function upsertToSnowflake(invoices: RequestedPayment[]): Promise<void> {
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

  // First, get patient_id mappings from healthie_client_id
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

  // Upsert invoices - use only columns that exist in the table
  const mergeSQL = `
    MERGE INTO GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_INVOICES AS target
    USING (
      SELECT 
        ? AS INVOICE_ID,
        ? AS HEALTHIE_CLIENT_ID,
        ? AS PATIENT_ID,
        ? AS AMOUNT,
        ? AS PAID_AMOUNT,
        ? AS REMAINING_BALANCE,
        ? AS STATUS,
        ? AS INVOICE_DATE,
        CURRENT_TIMESTAMP() AS SYNCED_AT
    ) AS source
    ON target.INVOICE_ID = source.INVOICE_ID
    WHEN MATCHED THEN UPDATE SET
      HEALTHIE_CLIENT_ID = source.HEALTHIE_CLIENT_ID,
      PATIENT_ID = source.PATIENT_ID,
      AMOUNT = source.AMOUNT,
      PAID_AMOUNT = source.PAID_AMOUNT,
      REMAINING_BALANCE = source.REMAINING_BALANCE,
      STATUS = source.STATUS,
      INVOICE_DATE = source.INVOICE_DATE,
      UPDATED_AT = CURRENT_TIMESTAMP(),
      SYNCED_AT = source.SYNCED_AT
    WHEN NOT MATCHED THEN INSERT (
      INVOICE_ID, HEALTHIE_CLIENT_ID, PATIENT_ID, AMOUNT, PAID_AMOUNT, 
      REMAINING_BALANCE, STATUS, INVOICE_DATE,
      CREATED_AT, SYNCED_AT
    ) VALUES (
      source.INVOICE_ID, source.HEALTHIE_CLIENT_ID, source.PATIENT_ID,
      source.AMOUNT, source.PAID_AMOUNT, source.REMAINING_BALANCE,
      source.STATUS, source.INVOICE_DATE,
      CURRENT_TIMESTAMP(), source.SYNCED_AT
    )`;

  let synced = 0;
  let errors = 0;

  for (const inv of invoices) {
    const patientId = patientMap.get(inv.recipient_id || '') || null;
    const price = inv.price ? parseFloat(inv.price) : null;
    const balanceDue = inv.balance_due || null;
    const paidAmount = price !== null && balanceDue !== null ? price - balanceDue : null;
    const invoiceDate = inv.created_at ? inv.created_at.split('T')[0] : null;

    try {
      await new Promise<void>((resolve, reject) => {
        conn.execute({
          sqlText: mergeSQL,
          binds: [
            inv.id,
            inv.recipient_id,
            patientId,
            price,
            paidAmount,
            balanceDue,
            inv.status,
            invoiceDate
          ] as any[],
          complete: (err) => {
            if (err) reject(err);
            else resolve();
          }
        });
      });
      synced++;
    } catch (e) {
      console.error(`Error syncing invoice ${inv.id}:`, e);
      errors++;
    }
  }

  console.log(`✅ Synced ${synced} invoices, ${errors} errors`);

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

  const invoices = await fetchAllInvoices();
  await upsertToSnowflake(invoices);

  console.log('\n🎉 Invoice sync complete!');
}

main().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});
