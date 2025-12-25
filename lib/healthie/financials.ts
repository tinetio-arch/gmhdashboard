import 'dotenv/config';
import fetch from 'node-fetch';
import snowflake from 'snowflake-sdk';

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
  SNOWFLAKE_WAREHOUSE = 'GMH_WAREHOUSE',
  SNOWFLAKE_DATABASE = 'GMH_CLINIC',
  SNOWFLAKE_SCHEMA = 'FINANCIAL_DATA',
} = process.env;

function assertEnv(name: string, value: string | undefined) {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export async function fetchGraphQL<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(HEALTHIE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: `Basic ${assertEnv('HEALTHIE_API_KEY', HEALTHIE_API_KEY)}`,
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
  return snowflake.createConnection({
    account: assertEnv('SNOWFLAKE_ACCOUNT', SNOWFLAKE_ACCOUNT),
    username: assertEnv('SNOWFLAKE_USER', SNOWFLAKE_USER),
    password: assertEnv('SNOWFLAKE_PASSWORD', SNOWFLAKE_PASSWORD),
    warehouse: SNOWFLAKE_WAREHOUSE,
    database: SNOWFLAKE_DATABASE,
    schema: SNOWFLAKE_SCHEMA,
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
