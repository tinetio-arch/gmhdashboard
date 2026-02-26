import 'dotenv/config';
import fetch from 'node-fetch';
import snowflake from 'snowflake-sdk';
import fs from 'fs';
import crypto from 'crypto';

export type BillingItem = {
  id: string;
  recipient_id: string | null;
  sender_id: string | null;
  sender_name: string | null;
  recipient_name: string | null;
  amount_paid: string | null;
  state: string | null;
  created_at: string | null;
};

const {
  HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql',
  HEALTHIE_API_KEY,
  SNOWFLAKE_ACCOUNT,
  SNOWFLAKE_USER,
  SNOWFLAKE_PASSWORD,
  SNOWFLAKE_SERVICE_USER,
  SNOWFLAKE_PRIVATE_KEY_PATH,
  SNOWFLAKE_WAREHOUSE = 'GMH_WAREHOUSE',
  SNOWFLAKE_DATABASE = 'GMH_CLINIC',
  SNOWFLAKE_SCHEMA = 'FINANCIAL_DATA',
} = process.env;

function assertEnv(name: string, value: string | undefined) {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export async function fetchGraphQL<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const apiUrl = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
  const apiKey = process.env.HEALTHIE_API_KEY;
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: `Basic ${assertEnv('HEALTHIE_API_KEY', apiKey)}`,
      authorizationsource: 'API',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json: unknown = await res.json();
  const data = json as { data?: T; errors?: unknown };
  if (!res.ok || data.errors) {
    throw new Error(`Healthie API error: ${res.status} ${JSON.stringify(data.errors || json)}`);
  }
  if (!data.data) throw new Error('Healthie API returned no data');
  return data.data;
}

export async function fetchBillingItems(): Promise<BillingItem[]> {
  const pageSize = 100; // API max
  let offset = 0;
  const rows: BillingItem[] = [];
  const query = `
    query BillingItems($page_size: Int, $offset: Int) {
      billingItems(page_size: $page_size, offset: $offset) {
        id
        recipient_id
        sender_id
        sender { full_name }
        recipient { full_name }
        amount_paid
        state
        created_at
      }
    }
  `;

  while (true) {
    const data: { billingItems: any[] } = await fetchGraphQL(query, { page_size: pageSize, offset });
    if (!data.billingItems.length) break;
    data.billingItems.forEach((b) => {
      rows.push({
        id: b.id,
        recipient_id: b.recipient_id ?? null,
        sender_id: b.sender_id ?? null,
        sender_name: b.sender?.full_name ?? null,
        recipient_name: b.recipient?.full_name ?? null,
        amount_paid: b.amount_paid ?? null,
        state: b.state ?? null,
        created_at: b.created_at ?? null,
      });
    });
    offset += pageSize;
  }
  return rows;
}

export function getSnowflakeConnection() {
  // Read env vars at call time (not module load time) because ESM import
  // hoisting means this module loads before dotenv.config() runs in callers
  const sfAccount = process.env.SNOWFLAKE_ACCOUNT;
  const sfServiceUser = process.env.SNOWFLAKE_SERVICE_USER;
  const sfPrivateKeyPath = process.env.SNOWFLAKE_PRIVATE_KEY_PATH;
  const sfWarehouse = process.env.SNOWFLAKE_WAREHOUSE || 'GMH_WAREHOUSE';
  const sfDatabase = process.env.SNOWFLAKE_DATABASE || 'GMH_CLINIC';
  const sfSchema = process.env.SNOWFLAKE_SCHEMA || 'FINANCIAL_DATA';

  // Prefer key-pair auth (required now that Snowflake enforces MFA)
  if (sfPrivateKeyPath && sfServiceUser) {
    console.log(`[Snowflake] Using key-pair auth with service user: ${sfServiceUser}`);
    // Read key file and export as PEM string (per Snowflake Node.js SDK docs)
    const keyFile = fs.readFileSync(sfPrivateKeyPath);
    const keyObj = crypto.createPrivateKey({ key: keyFile, format: 'pem' });
    const privateKey = keyObj.export({ format: 'pem', type: 'pkcs8' });

    return snowflake.createConnection({
      account: assertEnv('SNOWFLAKE_ACCOUNT', sfAccount),
      username: sfServiceUser,
      authenticator: 'SNOWFLAKE_JWT',
      privateKey: privateKey,
      warehouse: sfWarehouse,
      database: sfDatabase,
      schema: sfSchema,
    });
  }

  // Fallback to password auth (will fail if MFA is enforced)
  console.warn('[Snowflake] ⚠️ Using password auth - may fail if MFA is required. Set SNOWFLAKE_PRIVATE_KEY_PATH and SNOWFLAKE_SERVICE_USER for key-pair auth.');
  return snowflake.createConnection({
    account: assertEnv('SNOWFLAKE_ACCOUNT', sfAccount),
    username: assertEnv('SNOWFLAKE_USER', process.env.SNOWFLAKE_USER),
    password: assertEnv('SNOWFLAKE_PASSWORD', process.env.SNOWFLAKE_PASSWORD),
    warehouse: sfWarehouse,
    database: sfDatabase,
    schema: sfSchema,
  });
}

export async function connectSnowflake(conn: snowflake.Connection) {
  await new Promise<void>((resolve, reject) => {
    conn.connect((err) => (err ? reject(err) : resolve()));
  });
}

export async function execute(conn: snowflake.Connection, sql: string) {
  await new Promise<void>((resolve, reject) => {
    conn.execute({ sqlText: sql, complete: (err) => (err ? reject(err) : resolve()) });
  });
}

export async function upsertBillingItems(conn: snowflake.Connection, rows: BillingItem[]) {
  if (!rows.length) return;

  const values = rows
    .map((r) => {
      const sanitize = (v: string | null) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);
      const amount = r.amount_paid ? Number.parseFloat(r.amount_paid) : 0;
      return `('${r.id}', ${sanitize(r.recipient_id)}, ${sanitize(r.sender_id)}, ${sanitize(r.sender_name)}, ${sanitize(r.recipient_name)}, ${amount}, ${sanitize(r.state)}, ${r.created_at ? `TO_TIMESTAMP_NTZ('${r.created_at}')` : 'NULL'}, CURRENT_TIMESTAMP())`;
    })
    .join(',');

  const sql = `
    merge into HEALTHIE_BILLING_ITEMS t
    using (select column1 as BILLING_ITEM_ID,
                  column2 as PATIENT_ID,
                  column3 as HEALTHIE_SENDER_ID,
                  column4 as SENDER_NAME,
                  column5 as RECIPIENT_NAME,
                  column6 as AMOUNT_PAID,
                  column7 as STATE,
                  column8 as PAYMENT_DATE,
                  column9 as SYNCED_AT
           from values ${values}) s
    on t.BILLING_ITEM_ID = s.BILLING_ITEM_ID
    when matched then update set
      PATIENT_ID = s.PATIENT_ID,
      HEALTHIE_SENDER_ID = s.HEALTHIE_SENDER_ID,
      SENDER_NAME = s.SENDER_NAME,
      RECIPIENT_NAME = s.RECIPIENT_NAME,
      AMOUNT_PAID = s.AMOUNT_PAID,
      STATE = s.STATE,
      PAYMENT_DATE = s.PAYMENT_DATE,
      SYNCED_AT = s.SYNCED_AT
    when not matched then insert
      (BILLING_ITEM_ID, PATIENT_ID, HEALTHIE_SENDER_ID, SENDER_NAME, RECIPIENT_NAME, AMOUNT_PAID, STATE, PAYMENT_DATE, SYNCED_AT)
      values (s.BILLING_ITEM_ID, s.PATIENT_ID, s.HEALTHIE_SENDER_ID, s.SENDER_NAME, s.RECIPIENT_NAME, s.AMOUNT_PAID, s.STATE, s.PAYMENT_DATE, s.SYNCED_AT);
  `;

  await execute(conn, sql);
}
