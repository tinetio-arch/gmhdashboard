import { Pool, types } from 'pg';
import type { QueryResultRow } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

// GLOBAL FIX: Override pg driver's date parser.
// By default, pg converts PostgreSQL 'date' columns (OID 1082) into JavaScript
// Date objects at UTC midnight (e.g., "2026-03-28" → new Date("2026-03-28T00:00:00Z")).
// When clients in Arizona (UTC-7) display this using local time methods, they see
// the PREVIOUS day (March 27 at 5PM instead of March 28).
// Fix: Return raw YYYY-MM-DD strings — no timezone conversion, no ambiguity.
types.setTypeParser(1082, (val: string) => val);  // date → raw string
// Note: timestamp columns (1114, 1184) are left as default — they carry time info
// and are handled correctly by new Date() throughout the app
let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const {
      DATABASE_HOST,
      DATABASE_PORT,
      DATABASE_NAME,
      DATABASE_USER,
      DATABASE_PASSWORD,
      DATABASE_SSLMODE
    } = process.env;

    if (!DATABASE_HOST || !DATABASE_NAME || !DATABASE_USER || !DATABASE_PASSWORD) {
      throw new Error('Database environment variables are not configured.');
    }

    // Load AWS RDS CA certificate bundle for verified SSL connections
    const caCertPath = path.join(process.cwd(), 'certs', 'rds-combined-ca-bundle.pem');
    const sslConfig = DATABASE_SSLMODE === 'disable'
      ? false
      : {
        rejectUnauthorized: true,
        ca: fs.readFileSync(caCertPath, 'utf8'),
      };

    pool = new Pool({
      host: DATABASE_HOST,
      port: Number(DATABASE_PORT ?? 5432),
      database: DATABASE_NAME,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
      ssl: sslConfig,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
  }

  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T[]> {
  const client = await getPool().connect();
  try {
    const result = await client.query<T>(text, params);
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Convert a Postgres `timestamp without time zone` value (which webhook code
 * stores as UTC wall-clock) into an unambiguous UTC ISO string.
 *
 * Why: bare strings like "2026-04-15 15:57:18" are parsed by browsers as LOCAL
 * time. On an Arizona iPad that means UTC values render shifted +7h
 * (e.g. 8:57 AM AZ rendered as 3:57 PM AZ — Apr 15 2026 incident with
 * Luke McCarthy's text). pg-node also misparses these (using the Node process
 * TZ — EC2 is MST). This helper handles both runtime shapes (string and Date).
 *
 * Use any time you SELECT a `timestamp without time zone` column and ship it
 * to the client. Date columns are fine as-is (db.ts string override below).
 *
 * Also safe for Healthie appointment.date strings like "2026-05-12 04:30:00 -0700":
 * the offset is detected, parsed, and re-emitted as strict ISO 8601 ("...Z").
 * This protects iOS/JSC/Hermes clients that don't parse the space-separated,
 * non-T-prefixed format that Healthie returns.
 */
export function pgTimestampToUTCISO(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    return new Date(v.getTime() - v.getTimezoneOffset() * 60_000).toISOString();
  }
  const s = String(v).trim();
  if (!s) return null;
  const hasTz = /(Z|[+-]\d{2}:?\d{2})$/.test(s);
  return new Date(hasTz ? s : s.replace(' ', 'T') + 'Z').toISOString();
}

export function pgTimestampToUTCMs(v: unknown): number | null {
  const iso = pgTimestampToUTCISO(v);
  return iso ? Date.parse(iso) : null;
}
