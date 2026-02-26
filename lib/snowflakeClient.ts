/**
 * Shared Snowflake Client with Key-Pair Authentication
 * Uses JARVIS_SERVICE_ACCOUNT service account to bypass MFA requirement
 */

import snowflake from 'snowflake-sdk';
import * as fs from 'fs';
import * as crypto from 'crypto';

// Configuration from environment
const {
    SNOWFLAKE_ACCOUNT = 'KXWWLYZ-DZ83651',
    SNOWFLAKE_SERVICE_USER = 'JARVIS_SERVICE_ACCOUNT',
    SNOWFLAKE_PRIVATE_KEY_PATH = '/home/ec2-user/.snowflake/rsa_key_new.p8',
    SNOWFLAKE_WAREHOUSE = 'GMH_WAREHOUSE',
    SNOWFLAKE_DATABASE = 'GMH_CLINIC',
    SNOWFLAKE_SCHEMA = 'PATIENT_DATA',
} = process.env;

// Cache the private key
let privateKey: string | null = null;

function getPrivateKey(): string {
    if (privateKey) return privateKey;

    try {
        // Read the unencrypted private key
        const keyPath = SNOWFLAKE_PRIVATE_KEY_PATH;
        const keyContent = fs.readFileSync(keyPath, 'utf8');

        // The key should be in PEM format without password
        privateKey = keyContent;
        return privateKey;
    } catch (error) {
        console.error('Failed to read Snowflake private key:', error);
        throw new Error(`Could not load Snowflake private key from ${SNOWFLAKE_PRIVATE_KEY_PATH}`);
    }
}

interface SnowflakeConfig {
    warehouse?: string;
    database?: string;
    schema?: string;
}

/**
 * Create a Snowflake connection using key-pair authentication
 */
export function createSnowflakeConnection(config?: SnowflakeConfig): snowflake.Connection {
    const key = getPrivateKey();

    return snowflake.createConnection({
        account: SNOWFLAKE_ACCOUNT,
        username: SNOWFLAKE_SERVICE_USER,
        authenticator: 'SNOWFLAKE_JWT',
        privateKey: key,
        warehouse: config?.warehouse || SNOWFLAKE_WAREHOUSE,
        database: config?.database || SNOWFLAKE_DATABASE,
        schema: config?.schema || SNOWFLAKE_SCHEMA,
    });
}

/**
 * Connect to Snowflake (promisified)
 */
export async function connectSnowflake(conn: snowflake.Connection): Promise<void> {
    return new Promise((resolve, reject) => {
        conn.connect((err) => {
            if (err) {
                console.error('Snowflake connection error:', err.message);
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

/**
 * Execute a query (promisified)
 */
export async function querySnowflake<T = Record<string, unknown>>(
    conn: snowflake.Connection,
    sql: string
): Promise<T[]> {
    return new Promise((resolve, reject) => {
        conn.execute({
            sqlText: sql,
            complete: (err, stmt, rows) => {
                if (err) {
                    console.error('Snowflake query error:', err.message);
                    reject(err);
                } else {
                    resolve((rows || []) as T[]);
                }
            },
        });
    });
}

/**
 * Execute a query with auto-connect and cleanup
 * This is the main function to use for one-off queries
 */
export async function executeSnowflakeQuery<T = Record<string, unknown>>(
    sql: string,
    config?: SnowflakeConfig
): Promise<T[]> {
    const conn = createSnowflakeConnection(config);

    try {
        await connectSnowflake(conn);
        const results = await querySnowflake<T>(conn, sql);
        return results;
    } finally {
        conn.destroy(() => { });
    }
}

/**
 * Test Snowflake connectivity (returns true if connection is successful)
 */
export async function testSnowflakeConnection(): Promise<{
    connected: boolean;
    responseTime: number;
    error?: string;
}> {
    const start = Date.now();

    try {
        await executeSnowflakeQuery('SELECT 1 AS test');
        return {
            connected: true,
            responseTime: Date.now() - start,
        };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
            connected: false,
            responseTime: Date.now() - start,
            error: errorMessage,
        };
    }
}
