import { Pool } from 'pg';
import type { QueryResultRow } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

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
