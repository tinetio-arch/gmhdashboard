import { Pool } from 'pg';
import type { QueryResultRow } from 'pg';

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

    pool = new Pool({
      host: DATABASE_HOST,
      port: Number(DATABASE_PORT ?? 5432),
      database: DATABASE_NAME,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
      ssl: DATABASE_SSLMODE === 'disable' ? false : { rejectUnauthorized: false },
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
