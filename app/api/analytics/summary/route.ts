/**
 * Unified Analytics Summary API
 * Aggregates patient, financial, and system data into one real-time endpoint
 */
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireApiUser } from '@/lib/auth';
import { fetchPeptideFinancials } from '@/lib/peptideQueries';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const dynamic = 'force-dynamic';

interface PM2Process {
    name: string;
    status: string;
    cpu: number;
    memory: number;
    uptime: number;
    restarts: number;
}

async function getPM2Status(): Promise<PM2Process[]> {
    try {
        const { stdout } = await execAsync('pm2 jlist');
        const processes = JSON.parse(stdout);
        return processes.map((p: any) => ({
            name: p.name,
            status: p.pm2_env?.status || 'unknown',
            cpu: p.monit?.cpu || 0,
            memory: Math.round((p.monit?.memory || 0) / 1024 / 1024), // MB
            uptime: p.pm2_env?.pm_uptime || 0,
            restarts: p.pm2_env?.restart_time || 0,
        }));
    } catch (error) {
        console.error('Failed to get PM2 status:', error);
        return [];
    }
}

async function getDiskUsage(): Promise<{ used: string; free: string; percent: number }> {
    try {
        const { stdout } = await execAsync("df -h / | tail -1 | awk '{print $3, $4, $5}'");
        const [used, free, percent] = stdout.trim().split(' ');
        return { used, free, percent: parseInt(percent) || 0 };
    } catch (error) {
        return { used: 'N/A', free: 'N/A', percent: 0 };
    }
}

interface APIHealth {
    name: string;
    status: 'healthy' | 'degraded' | 'down' | 'unknown';
    lastCheck: string;
    message?: string;
}

async function checkAPIHealth(): Promise<APIHealth[]> {
    const health: APIHealth[] = [];
    const now = new Date().toISOString();

    // Check QuickBooks OAuth status
    try {
        const qboResult = await query(`
            SELECT token_expires_at, updated_at 
            FROM quickbooks_tokens 
            ORDER BY updated_at DESC LIMIT 1
        `);
        if (qboResult.length > 0) {
            const expiresAt = new Date(qboResult[0].token_expires_at);
            const hoursUntilExpiry = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);

            if (hoursUntilExpiry < 0) {
                health.push({ name: 'QuickBooks', status: 'down', lastCheck: now, message: 'Token expired' });
            } else if (hoursUntilExpiry < 24) {
                health.push({ name: 'QuickBooks', status: 'degraded', lastCheck: now, message: `Expires in ${hoursUntilExpiry.toFixed(0)}h` });
            } else {
                health.push({ name: 'QuickBooks', status: 'healthy', lastCheck: now });
            }
        } else {
            health.push({ name: 'QuickBooks', status: 'unknown', lastCheck: now, message: 'No token found' });
        }
    } catch (e) {
        health.push({ name: 'QuickBooks', status: 'unknown', lastCheck: now, message: 'Check failed' });
    }

    // Check Healthie (look at recent sync activity)
    try {
        const healthieResult = await query(`
            SELECT COUNT(*) as recent_syncs
            FROM patients 
            WHERE healthie_client_id IS NOT NULL 
            AND updated_at >= NOW() - INTERVAL '24 hours'
        `);
        const recentSyncs = parseInt(healthieResult[0]?.recent_syncs) || 0;
        health.push({
            name: 'Healthie',
            status: recentSyncs > 0 ? 'healthy' : 'degraded',
            lastCheck: now,
            message: `${recentSyncs} syncs in 24h`
        });
    } catch (e) {
        health.push({ name: 'Healthie', status: 'unknown', lastCheck: now });
    }

    // Check GHL (based on sync errors)
    try {
        const ghlResult = await query(`
            SELECT 
                COUNT(CASE WHEN ghl_sync_status = 'error' THEN 1 END) as errors,
                COUNT(CASE WHEN ghl_sync_status = 'synced' THEN 1 END) as synced
            FROM patients WHERE (status_key != 'inactive' OR status_key IS NULL)
        `);
        const errors = parseInt(ghlResult[0]?.errors) || 0;
        const synced = parseInt(ghlResult[0]?.synced) || 0;
        const errorRate = synced > 0 ? (errors / (errors + synced)) * 100 : 0;

        health.push({
            name: 'GoHighLevel',
            status: errorRate < 5 ? 'healthy' : errorRate < 15 ? 'degraded' : 'down',
            lastCheck: now,
            message: `${errors} errors, ${synced} synced`
        });
    } catch (e) {
        health.push({ name: 'GoHighLevel', status: 'unknown', lastCheck: now });
    }

    // Check cron job logs for freshness
    try {
        const { stdout } = await execAsync(`
            stat -c %Y /home/ec2-user/logs/sync-billing.log 2>/dev/null || echo 0
        `);
        const lastMod = parseInt(stdout.trim()) * 1000;
        const hoursAgo = (Date.now() - lastMod) / (1000 * 60 * 60);

        health.push({
            name: 'Sync Jobs',
            status: hoursAgo < 8 ? 'healthy' : hoursAgo < 24 ? 'degraded' : 'down',
            lastCheck: now,
            message: hoursAgo < 1 ? 'Recent' : `${hoursAgo.toFixed(0)}h ago`
        });
    } catch (e) {
        health.push({ name: 'Sync Jobs', status: 'unknown', lastCheck: now });
    }

    return health;
}

// Get infrastructure costs (AWS + estimated others)
async function getInfrastructureCosts(): Promise<{
    aws: { daily: number; monthly: number; forecast: number };
    snowflake: { daily: number; weekly: number };
    googleCloud: { estimated: number };
}> {
    const costs = {
        aws: { daily: 0, monthly: 0, forecast: 0 },
        snowflake: { daily: 0, weekly: 0 },
        googleCloud: { estimated: 7 } // Fixed estimate for Gemini/Places API
    };

    // Get AWS costs - use cached data from aws_monitor.py output
    try {
        const { stdout } = await execAsync(`
            # Try to read cached AWS costs from last monitor run
            grep -oP 'AWS MTD: \\$[0-9.]+' /home/ec2-user/.pm2/logs/telegram-ai-bot-v2-out.log 2>/dev/null | tail -1 | grep -oP '[0-9.]+' || \
            grep -oP 'Monthly so far: \\$[0-9.]+' /home/ec2-user/logs/aws-costs.log 2>/dev/null | tail -1 | grep -oP '[0-9.]+' || \
            echo "180"
        `);
        const monthly = parseFloat(stdout.trim()) || 0;
        costs.aws = {
            daily: monthly > 0 ? monthly / new Date().getDate() : 6, // Estimate ~$6/day
            monthly: monthly || 180,
            forecast: monthly > 0 ? (monthly / new Date().getDate()) * 30 : 180
        };
    } catch (e) {
        // Default AWS estimate based on EC2 + RDS
        costs.aws = { daily: 6, monthly: 180, forecast: 180 };
    }

    // Snowflake costs - get from telegram monitor logs
    try {
        const { stdout } = await execAsync(`
            grep -oP 'Snowflake.*\\$[0-9.]+' /home/ec2-user/.pm2/logs/telegram-ai-bot-v2-out.log 2>/dev/null | tail -1 | grep -oP '[0-9.]+' || \
            echo "0.50"
        `);
        costs.snowflake.daily = parseFloat(stdout.trim()) || 0.50;
        costs.snowflake.weekly = costs.snowflake.daily * 7;
    } catch (e) {
        costs.snowflake = { daily: 0.50, weekly: 3.50 }; // Default estimate
    }

    return costs;
}

// Get revenue from both QuickBooks (Postgres) AND Healthie Billing (Snowflake)
// Per SOURCE OF TRUTH: HEALTHIE_BILLING_ITEMS is in Snowflake, syncs every 6h
async function getRevenueTrends(): Promise<{
    last7Days: number;
    last30Days: number;
    successRate: number;
    pendingPayments: number;
    healthie7d: number;
    healthie30d: number;
}> {
    let qbRevenue = { last7Days: 0, last30Days: 0 };
    let healthieRevenue = { last7Days: 0, last30Days: 0, successRate: 100, pending: 0 };

    // 1. QuickBooks from Postgres
    try {
        const result = await query(`
            SELECT 
                COALESCE(SUM(CASE WHEN receipt_date >= CURRENT_DATE - 7 THEN amount ELSE 0 END), 0) as last_7_days,
                COALESCE(SUM(CASE WHEN receipt_date >= CURRENT_DATE - 30 THEN amount ELSE 0 END), 0) as last_30_days
            FROM quickbooks_sales_receipts
            WHERE receipt_date >= CURRENT_DATE - 30
        `);
        const r = result[0] || {};
        qbRevenue = {
            last7Days: parseFloat(r.last_7_days) || 0,
            last30Days: parseFloat(r.last_30_days) || 0
        };
    } catch (e) {
        console.error('Failed to get QuickBooks revenue:', e);
    }

    // 2. Healthie Billing from cache file (updated daily via cron)
    // Per SOURCE OF TRUTH: HEALTHIE_BILLING_ITEMS is in Snowflake, syncs every 6h
    try {
        const cacheFile = '/tmp/healthie-revenue-cache.json';
        const fs = require('fs');
        if (fs.existsSync(cacheFile)) {
            const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            healthieRevenue = {
                last7Days: cache.day7 || 0,
                last30Days: cache.day30 || 0,
                successRate: cache.successRate || 0,
                pending: cache.pending || 0
            };
        }
    } catch (e) {
        console.error('Failed to read Healthie revenue cache:', e);
    }

    return {
        last7Days: qbRevenue.last7Days,
        last30Days: qbRevenue.last30Days,
        successRate: healthieRevenue.successRate,
        pendingPayments: healthieRevenue.pending,
        healthie7d: healthieRevenue.last7Days,
        healthie30d: healthieRevenue.last30Days
    };
}


// Get system resources (memory, CPU)
async function getSystemResources(): Promise<{
    memory: { used: number; total: number; percent: number };
    cpu: { loadAvg: number; cores: number };
}> {
    const resources = {
        memory: { used: 0, total: 0, percent: 0 },
        cpu: { loadAvg: 0, cores: 1 }
    };

    try {
        // Memory
        const { stdout: memOut } = await execAsync("free -m | grep Mem | awk '{print $2, $3}'");
        const [total, used] = memOut.trim().split(' ').map(Number);
        resources.memory = {
            total: total || 0,
            used: used || 0,
            percent: total > 0 ? Math.round((used / total) * 100) : 0
        };

        // CPU load average
        const { stdout: loadOut } = await execAsync("cat /proc/loadavg | awk '{print $1}'");
        const { stdout: coresOut } = await execAsync("nproc");
        resources.cpu = {
            loadAvg: parseFloat(loadOut.trim()) || 0,
            cores: parseInt(coresOut.trim()) || 1
        };
    } catch (e) {
        console.error('Failed to get system resources:', e);
    }

    return resources;
}

// Get data sync freshness
async function getSyncFreshness(): Promise<Array<{
    name: string;
    lastSync: string | null;
    hoursAgo: number;
    status: 'fresh' | 'stale' | 'critical';
}>> {
    const syncs: Array<{ name: string; lastSync: string | null; hoursAgo: number; status: 'fresh' | 'stale' | 'critical' }> = [];

    const checkLog = async (name: string, logPath: string) => {
        try {
            const { stdout } = await execAsync(`stat -c %Y "${logPath}" 2>/dev/null || echo 0`);
            const timestamp = parseInt(stdout.trim()) * 1000;
            if (timestamp === 0) {
                syncs.push({ name, lastSync: null, hoursAgo: -1, status: 'critical' });
            } else {
                const hoursAgo = (Date.now() - timestamp) / (1000 * 60 * 60);
                const lastSync = new Date(timestamp).toISOString();
                syncs.push({
                    name,
                    lastSync,
                    hoursAgo: Math.round(hoursAgo * 10) / 10,
                    status: hoursAgo < 8 ? 'fresh' : hoursAgo < 24 ? 'stale' : 'critical'
                });
            }
        } catch (e) {
            syncs.push({ name, lastSync: null, hoursAgo: -1, status: 'critical' });
        }
    };

    await Promise.all([
        checkLog('Healthie Billing', '/home/ec2-user/logs/sync-billing.log'),
        checkLog('Healthie Invoices', '/home/ec2-user/logs/sync-invoices.log'),
        checkLog('Healthie Ops', '/home/ec2-user/logs/healthie-ops-sync.log'),
        checkLog('Morning Report', '/home/ec2-user/logs/morning-report.log'),
    ]);

    return syncs;
}

export async function GET(request: NextRequest) {
    try {
        await requireApiUser(request, 'read');
        const [
            patientStats,
            ghlStats,
            healthieStats,
            recentPatients,
            financialStats,
            pm2Status,
            diskUsage,
            apiHealth,
            infrastructureCosts,
            revenueTrends,
            systemResources,
            syncFreshness,
            peptideFinancials
        ] = await Promise.all([
            // Patient counts and trends
            query(`
        SELECT 
          COUNT(*) as total_patients,
          COUNT(CASE WHEN status_key != 'inactive' OR status_key IS NULL THEN 1 END) as active_patients,
          COUNT(CASE WHEN status_key = 'inactive' THEN 1 END) as inactive_patients,
          COUNT(CASE WHEN date_added >= NOW() - INTERVAL '7 days' THEN 1 END) as new_this_week,
          COUNT(CASE WHEN date_added >= NOW() - INTERVAL '30 days' THEN 1 END) as new_this_month
        FROM patients
      `),

            // GHL sync status
            query(`
        SELECT 
          ghl_sync_status,
          COUNT(*) as count,
          COUNT(ghl_contact_id) as with_id
        FROM patients
        WHERE (status_key != 'inactive' OR status_key IS NULL)
        GROUP BY ghl_sync_status
      `),

            // Healthie linkage
            query(`
        SELECT 
          COUNT(*) as total,
          COUNT(healthie_client_id) as with_healthie
        FROM patients
        WHERE (status_key != 'inactive' OR status_key IS NULL)
      `),

            // Recent patient activity
            query(`
        SELECT 
          full_name,
          client_type_key,
          date_added,
          ghl_sync_status
        FROM patients
        WHERE (status_key != 'inactive' OR status_key IS NULL)
        ORDER BY date_added DESC
        LIMIT 5
      `),

            // Financial overview (from QuickBooks sync)
            query(`
        SELECT 
          COUNT(*) as total_receipts,
          SUM(amount) as total_revenue,
          SUM(CASE WHEN receipt_date >= CURRENT_DATE - 30 THEN amount ELSE 0 END) as revenue_30d,
          SUM(CASE WHEN receipt_date >= CURRENT_DATE - 7 THEN amount ELSE 0 END) as revenue_7d
        FROM quickbooks_sales_receipts
        WHERE receipt_date >= CURRENT_DATE - 90
      `).catch(() => [{ total_receipts: 0, total_revenue: 0, revenue_30d: 0, revenue_7d: 0 }]),

            // PM2 status
            getPM2Status(),

            // Disk usage
            getDiskUsage(),

            // API health checks
            checkAPIHealth(),

            // Infrastructure costs (AWS, Snowflake, GCP)
            getInfrastructureCosts(),

            // Real-time revenue from Healthie
            getRevenueTrends(),

            // System resources (memory, CPU)
            getSystemResources(),

            // Data sync freshness
            getSyncFreshness(),

            // Peptide Financials
            fetchPeptideFinancials()
        ]);

        // Calculate GHL sync rate
        const ghlSynced = ghlStats.find((r: any) => r.ghl_sync_status === 'synced')?.count || 0;
        const ghlTotal = ghlStats.reduce((sum: number, r: any) => sum + parseInt(r.count), 0);

        // Build response
        const response = {
            timestamp: new Date().toISOString(),

            patients: {
                total: parseInt(patientStats[0]?.total_patients) || 0,
                active: parseInt(patientStats[0]?.active_patients) || 0,
                inactive: parseInt(patientStats[0]?.inactive_patients) || 0,
                newThisWeek: parseInt(patientStats[0]?.new_this_week) || 0,
                newThisMonth: parseInt(patientStats[0]?.new_this_month) || 0,
            },

            integrations: {
                ghl: {
                    synced: parseInt(ghlSynced) || 0,
                    total: ghlTotal,
                    syncRate: ghlTotal > 0 ? Math.round((ghlSynced / ghlTotal) * 100) : 0,
                    breakdown: ghlStats.map((r: any) => ({ status: r.ghl_sync_status, count: parseInt(r.count) }))
                },
                healthie: {
                    linked: parseInt(healthieStats[0]?.with_healthie) || 0,
                    total: parseInt(healthieStats[0]?.total) || 0,
                    linkRate: healthieStats[0]?.total > 0
                        ? Math.round((healthieStats[0]?.with_healthie / healthieStats[0]?.total) * 100)
                        : 0
                }
            },

            financial: {
                totalReceipts: parseInt(financialStats[0]?.total_receipts) || 0,
                totalRevenue: parseFloat(financialStats[0]?.total_revenue) || 0,
                revenue30d: parseFloat(financialStats[0]?.revenue_30d) || 0,
                revenue7d: parseFloat(financialStats[0]?.revenue_7d) || 0,
            },

            system: {
                services: pm2Status,
                disk: diskUsage,
                servicesOnline: pm2Status.filter(p => p.status === 'online').length,
                servicesTotal: pm2Status.length,
                apiHealth: apiHealth,
                memory: systemResources.memory,
                cpu: systemResources.cpu
            },

            costs: infrastructureCosts,

            revenue: revenueTrends,

            peptide: peptideFinancials,

            syncFreshness: syncFreshness,

            recentPatients: recentPatients.map((p: any) => ({
                name: p.full_name,
                type: p.client_type_key,
                ghlStatus: p.ghl_sync_status,
                added: p.date_added
            }))
        };

        return NextResponse.json(response);
    } catch (error) {
        console.error('Analytics API error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch analytics data', details: String(error) },
            { status: 500 }
        );
    }
}
