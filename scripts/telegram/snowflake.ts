/**
 * Snowflake Database Module
 */

import * as snowflake from 'snowflake-sdk';
import * as fs from 'fs';
import type { ConversationContext } from './types';
import { callGemini } from './gemini';

let snowflakeConn: any = null;

/**
 * Connect to Snowflake using key-pair auth (primary) or password (fallback)
 */
export async function connectSnowflake() {
    // Base configuration
    const connectionConfig: any = {
        account: process.env.SNOWFLAKE_ACCOUNT!,
        username: process.env.SNOWFLAKE_USER || process.env.SNOWFLAKE_USERNAME!,
        warehouse: process.env.SNOWFLAKE_WAREHOUSE!,
        database: process.env.SNOWFLAKE_DATABASE!,
        schema: process.env.SNOWFLAKE_SCHEMA
    };

    const privateKeyPath = '/home/ec2-user/.snowflake/rsa_key_new.p8';

    // Check if private key exists for key-pair auth
    if (fs.existsSync(privateKeyPath)) {
        try {
            console.log('[Snowflake] Found private key file at:', privateKeyPath);
            const privateKeyVal = fs.readFileSync(privateKeyPath, 'utf8');

            // Use key-pair authentication
            connectionConfig.authenticator = 'SNOWFLAKE_JWT';
            connectionConfig.privateKey = privateKeyVal;

            // EXPLICITLY ensure no password is set
            delete connectionConfig.password;

            console.log('[Snowflake] configured for Key-Pair Authentication');
        } catch (e) {
            console.error('[Snowflake] Error reading private key:', e);
            // Fallback
            connectionConfig.password = process.env.SNOWFLAKE_PASSWORD!;
        }
    } else {
        // Fall back to password auth
        connectionConfig.password = process.env.SNOWFLAKE_PASSWORD!;
        console.log('[Snowflake] Using Password Authentication');
    }

    // Debug log (sanitized)
    const debugConfig = { ...connectionConfig };
    if (debugConfig.password) debugConfig.password = '***';
    if (debugConfig.privateKey) debugConfig.privateKey = '***';
    if (debugConfig.privateKeyPass) debugConfig.privateKeyPass = '***';
    console.log('[Snowflake] Connection Config:', JSON.stringify(debugConfig));

    const conn = snowflake.createConnection(connectionConfig);

    return new Promise<any>((resolve, reject) => {
        conn.connect((err: any, conn: any) => {
            if (err) {
                console.error('[Snowflake] Connection failed:', err.message);
                reject(err);
            } else {
                console.log('[Snowflake] ✅ Connected successfully');
                snowflakeConn = conn;
                resolve(conn);
            }
        });
    });
}

/**
 * Execute a SQL query
 */
export async function executeQuery(sql: string): Promise<any[]> {
    const conn = await connectSnowflake();

    return new Promise((resolve, reject) => {
        conn.execute({
            sqlText: sql,
            complete: (err: any, stmt: any, rows: any) => {
                conn.destroy(() => { });
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            }
        });
    });
}

/**
 * Execute query with self-healing retry on failure
 */
export async function executeQueryWithRetry(
    sql: string,
    question: string,
    schemaContext: string,
    prevContext?: ConversationContext | null,
    maxRetries: number = 2
): Promise<{ results: any[]; finalSQL: string; retryCount: number }> {
    let currentSQL = sql;
    let retryCount = 0;

    while (retryCount <= maxRetries) {
        try {
            const results = await executeQuery(currentSQL);
            return { results, finalSQL: currentSQL, retryCount };
        } catch (err: any) {
            console.log(`[Bot] ❌ Query failed (attempt ${retryCount + 1}/${maxRetries + 1}):`, err.message);

            if (retryCount >= maxRetries) {
                throw err;
            }

            // Ask AI to fix the SQL
            console.log('[Bot] 🔧 Asking AI to fix the query...');
            currentSQL = await generateFixedSQL(question, currentSQL, err.message, schemaContext, prevContext);
            retryCount++;
        }
    }

    throw new Error('Max retries exceeded');
}

/**
 * Generate fixed SQL based on error message
 */
async function generateFixedSQL(
    originalQuestion: string,
    failedSQL: string,
    errorMessage: string,
    schemaContext: string,
    prevContext?: ConversationContext | null
): Promise<string> {
    let fixPrompt = `${schemaContext}

The following SQL query failed:
\`\`\`sql
${failedSQL}
\`\`\`

Error message: ${errorMessage}

Original question: "${originalQuestion}"

Please generate a CORRECTED SQL query that fixes this error. Remember:
1. Use only columns that exist in the schema above
2. For QBO customer ID, use GMH_CLINIC.PATIENT_DATA.PATIENTS table, NOT PATIENT_360_VIEW
3. Use proper Snowflake syntax
4. Return ONLY the corrected SQL, no explanation.

Corrected SQL:`;

    if (prevContext) {
        fixPrompt = `Previous context:\n- Query: ${prevContext.lastQuery}\n- SQL: ${prevContext.lastSql}\n\n` + fixPrompt;
    }

    const response = await callGemini(fixPrompt, 1500, 0);

    // Clean up the response
    let correctedSQL = response.trim();
    if (correctedSQL.startsWith('```sql')) {
        correctedSQL = correctedSQL.replace(/^```sql\s*/, '').replace(/\s*```$/, '');
    } else if (correctedSQL.startsWith('```')) {
        correctedSQL = correctedSQL.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    console.log('[Bot] 🔧 Generated fixed SQL:', correctedSQL.substring(0, 100) + '...');
    return correctedSQL;
}

/**
 * Cleanup Snowflake connection
 */
export function destroyConnection() {
    if (snowflakeConn) {
        snowflakeConn.destroy(() => {
            console.log('[Snowflake] Connection destroyed');
        });
        snowflakeConn = null;
    }
}
