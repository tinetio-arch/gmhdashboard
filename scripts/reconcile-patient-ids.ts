import 'dotenv/config';
import snowflake from 'snowflake-sdk';
import { query } from '@/lib/db';

const {
  SNOWFLAKE_ACCOUNT,
  SNOWFLAKE_USER,
  SNOWFLAKE_PASSWORD,
  SNOWFLAKE_WAREHOUSE = 'GMH_WAREHOUSE',
  SNOWFLAKE_DATABASE = 'GMH_CLINIC',
  SNOWFLAKE_SCHEMA = 'PATIENT_DATA',
} = process.env;

function assertEnv(name: string, value: string | undefined) {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function getSnowflakeConnection() {
  return snowflake.createConnection({
    account: assertEnv('SNOWFLAKE_ACCOUNT', SNOWFLAKE_ACCOUNT),
    username: assertEnv('SNOWFLAKE_USER', SNOWFLAKE_USER),
    password: assertEnv('SNOWFLAKE_PASSWORD', SNOWFLAKE_PASSWORD),
    warehouse: SNOWFLAKE_WAREHOUSE,
    database: SNOWFLAKE_DATABASE,
    schema: SNOWFLAKE_SCHEMA,
  });
}

async function connectSnowflake(conn: snowflake.Connection) {
  await new Promise<void>((resolve, reject) => {
    conn.connect((err) => (err ? reject(err) : resolve()));
  });
}

async function fetchSnowflakePatients(conn: snowflake.Connection) {
  const sql = `
    select
      patient_id,
      patient_name,
      email,
      healthie_client_id
    from ${SNOWFLAKE_DATABASE}.PATIENT_DATA.PATIENTS
    where healthie_client_id is not null
  `;

  return new Promise<Array<{ patient_id: string; patient_name: string; email: string | null; healthie_client_id: string }>>((resolve, reject) => {
    const rows: any[] = [];
    conn.execute({
      sqlText: sql,
      complete: (err, _stmt, res) => {
        if (err) return reject(err);
        resolve((res ?? []) as any[]);
      },
    });
  });
}

async function linkHealthieClient(patientId: string, healthieClientId: string) {
  await query(
    `
      INSERT INTO healthie_clients (patient_id, healthie_client_id, match_method, is_active)
      VALUES ($1, $2, 'snowflake_sync', TRUE)
      ON CONFLICT (healthie_client_id) DO UPDATE
        SET patient_id = EXCLUDED.patient_id,
            match_method = EXCLUDED.match_method,
            is_active = TRUE,
            updated_at = NOW()
    `,
    [patientId, healthieClientId]
  );
}

async function main() {
  const conn = getSnowflakeConnection();
  await connectSnowflake(conn);

  try {
    const patients = await fetchSnowflakePatients(conn);
    let linked = 0;
    for (const row of patients) {
      const patientId = row.patient_id;
      const healthieClientId = row.healthie_client_id;
      if (!patientId || !healthieClientId) continue;
      try {
        await linkHealthieClient(patientId, healthieClientId);
        linked += 1;
      } catch (err) {
        console.error('Failed to link patient', { patientId, healthieClientId, err });
      }
    }
    console.log('Linking complete', { total: patients.length, linked });
  } finally {
    conn.destroy((err) => {
      if (err) {
        console.error('Error closing Snowflake connection', err);
      }
    });
  }
}

main().catch((err) => {
  console.error('Reconcile patient IDs failed', err);
  process.exitCode = 1;
});
