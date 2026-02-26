import { NextResponse } from 'next/server';
import * as fs from 'fs';

// Force this route to be dynamic (not cached)
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface TableFreshness {
    table_name: string;
    schema_name: string;
    record_count: number;
    last_updated: string | null;
    hours_since_update: number;
    status: 'fresh' | 'stale' | 'critical' | 'unknown';
    message: string;
}

/**
 * Reads Snowflake freshness data from the JSON file written by Python:
 * /home/ec2-user/scripts/snowflake-freshness-check.py
 * 
 * This replaces the previous Node.js snowflake-sdk direct query which 
 * hung indefinitely due to SDK bugs.
 */
async function getSnowflakeDataFreshness(): Promise<{
    status: 'healthy' | 'warning' | 'critical';
    tables: TableFreshness[];
    message: string;
}> {
    try {
        const freshnessPath = '/tmp/snowflake-freshness.json';

        if (!fs.existsSync(freshnessPath)) {
            return {
                status: 'critical',
                tables: [],
                message: 'Freshness data not available — run: python3 /home/ec2-user/scripts/snowflake-freshness-check.py'
            };
        }

        const freshnessData = JSON.parse(fs.readFileSync(freshnessPath, 'utf8'));
        const checkedAt = new Date(freshnessData.checked_at);
        const checkAgeHours = (Date.now() - checkedAt.getTime()) / (1000 * 60 * 60);

        // If the freshness check itself is too old, warn about it
        if (checkAgeHours > 6) {
            return {
                status: 'warning',
                tables: [],
                message: `Freshness check is ${Math.round(checkAgeHours)}h old — cron may not be running`
            };
        }

        const tables: TableFreshness[] = (freshnessData.tables || []).map((t: any) => {
            let status: TableFreshness['status'] = 'fresh';
            let message = 'Data is current';

            if (t.status === 'error') {
                status = 'critical';
                message = t.error || 'Query error';
            } else if (t.hours_old > t.threshold_hours * 3) {
                status = 'critical';
                message = `Data is ${Math.round(t.hours_old)} hours old — SYNC FAILURE`;
            } else if (t.hours_old > t.threshold_hours) {
                status = 'stale';
                message = `Last sync ${Math.round(t.hours_old * 10) / 10} hours ago (threshold: ${t.threshold_hours}h)`;
            }

            return {
                table_name: t.table,
                schema_name: t.schema,
                record_count: t.rows || 0,
                last_updated: t.last_update || null,
                hours_since_update: Math.round((t.hours_old || 0) * 10) / 10,
                status,
                message
            };
        });

        const criticalCount = tables.filter(t => t.status === 'critical').length;
        const staleCount = tables.filter(t => t.status === 'stale').length;

        let overallStatus: 'healthy' | 'warning' | 'critical' = 'healthy';
        let overallMessage = 'All data sources are fresh';

        if (criticalCount > 0) {
            overallStatus = 'critical';
            overallMessage = `${criticalCount} table(s) have critical sync failures`;
        } else if (staleCount > 0) {
            overallStatus = 'warning';
            overallMessage = `${staleCount} table(s) have stale data`;
        }

        return {
            status: overallStatus,
            tables,
            message: overallMessage
        };

    } catch (error: any) {
        console.error('Data freshness check failed:', error);
        return {
            status: 'critical',
            tables: [],
            message: `Failed to read freshness data: ${error.message}`
        };
    }
}

export async function GET() {
    try {
        const freshness = await getSnowflakeDataFreshness();

        return NextResponse.json({
            timestamp: new Date().toISOString(),
            ...freshness
        });
    } catch (error: any) {
        console.error('Data freshness API error:', error);
        return NextResponse.json({
            status: 'critical',
            tables: [],
            message: `API Error: ${error.message}`,
            timestamp: new Date().toISOString()
        }, { status: 500 });
    }
}
