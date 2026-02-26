import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { CloudWatchClient, DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';

// Force this route to be dynamic (not cached)
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const execAsync = promisify(exec);
const cloudwatch = new CloudWatchClient({ region: 'us-east-1' });

// Check CloudWatch alarms for external monitoring
async function getCloudWatchAlarms(): Promise<Array<{
    name: string;
    state: 'OK' | 'ALARM' | 'INSUFFICIENT_DATA';
    reason: string;
    updatedAt: string | null;
}>> {
    try {
        const command = new DescribeAlarmsCommand({ AlarmNamePrefix: 'GMH-' });
        const response = await cloudwatch.send(command);

        return (response.MetricAlarms || []).map((alarm) => ({
            name: alarm.AlarmName || 'unknown',
            state: alarm.StateValue as 'OK' | 'ALARM' | 'INSUFFICIENT_DATA',
            reason: alarm.StateReason || '',
            updatedAt: alarm.StateUpdatedTimestamp?.toISOString() || null
        }));
    } catch (e: any) {
        console.error('Failed to get CloudWatch alarms:', e);
        return [{ name: 'CloudWatch Error', state: 'INSUFFICIENT_DATA', reason: e.message, updatedAt: null }];
    }
}

// Get detailed PM2 process status
async function getPM2Processes(): Promise<Array<{
    name: string;
    status: string;
    cpu: number;
    memory: number;
    memoryMB: number;
    restarts: number;
    uptime: string;
    pid: number;
}>> {
    try {
        const { stdout } = await execAsync('pm2 jlist 2>/dev/null || echo "[]"');
        const processes = JSON.parse(stdout);

        return processes.map((p: any) => ({
            name: p.name,
            status: p.pm2_env?.status || 'unknown',
            cpu: p.monit?.cpu || 0,
            memory: p.monit?.memory || 0,
            memoryMB: Math.round((p.monit?.memory || 0) / 1024 / 1024),
            restarts: p.pm2_env?.restart_time || 0,
            uptime: formatUptime(p.pm2_env?.pm_uptime),
            pid: p.pid || 0
        }));
    } catch (e) {
        console.error('Failed to get PM2 processes:', e);
        return [];
    }
}

function formatUptime(startTime: number): string {
    if (!startTime) return 'N/A';
    const uptime = Date.now() - startTime;
    const hours = Math.floor(uptime / 3600000);
    const mins = Math.floor((uptime % 3600000) / 60000);
    if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    return `${hours}h ${mins}m`;
}

// Check API endpoint health
async function checkApiHealth(): Promise<Array<{
    name: string;
    status: 'healthy' | 'warning' | 'error';
    responseTime: number;
    lastCheck: string;
    message: string;
}>> {
    const endpoints = [
        { name: 'Healthie API', url: process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql', type: 'graphql' },
        { name: 'QuickBooks', check: 'token' },
        { name: 'Snowflake', check: 'cache' },
        { name: 'PostgreSQL', check: 'db' },
    ];

    const results = [];

    // Check Healthie API
    try {
        const start = Date.now();
        const response = await fetch(process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${process.env.HEALTHIE_API_KEY}`
            },
            body: JSON.stringify({ query: '{ __typename }' })
        });
        const responseTime = Date.now() - start;
        results.push({
            name: 'Healthie API',
            status: response.ok ? 'healthy' : 'error',
            responseTime,
            lastCheck: new Date().toISOString(),
            message: response.ok ? `OK (${responseTime}ms)` : `Error: ${response.status}`
        });
    } catch (e: any) {
        results.push({
            name: 'Healthie API',
            status: 'error',
            responseTime: 0,
            lastCheck: new Date().toISOString(),
            message: `Connection failed: ${e.message}`
        });
    }

    // Check QuickBooks token
    try {
        const { query } = await import('@/lib/db');
        const tokens = await query('SELECT expires_at FROM quickbooks_oauth_tokens ORDER BY created_at DESC LIMIT 1');
        if (tokens.length > 0) {
            const expiresAt = new Date(tokens[0].expires_at);
            const msUntilExpiry = expiresAt.getTime() - Date.now();
            const hoursUntilExpiry = Math.round(msUntilExpiry / 3600000 * 10) / 10; // 1 decimal place
            const daysUntilExpiry = Math.round(msUntilExpiry / 86400000 * 10) / 10;

            let status: 'healthy' | 'warning' | 'error' = 'healthy';
            let message = '';

            if (msUntilExpiry <= 0) {
                status = 'error';
                message = 'Token expired!';
            } else if (hoursUntilExpiry < 2) {
                status = 'error';
                message = `Token expires in ${hoursUntilExpiry}h - refresh needed!`;
            } else if (hoursUntilExpiry < 24) {
                status = 'warning';
                message = `Token expires in ${hoursUntilExpiry}h`;
            } else if (daysUntilExpiry < 7) {
                status = 'warning';
                message = `Token expires in ${daysUntilExpiry} days`;
            } else {
                message = `Token expires in ${daysUntilExpiry} days`;
            }

            results.push({
                name: 'QuickBooks OAuth',
                status,
                responseTime: 0,
                lastCheck: new Date().toISOString(),
                message
            });
        } else {
            results.push({
                name: 'QuickBooks OAuth',
                status: 'error',
                responseTime: 0,
                lastCheck: new Date().toISOString(),
                message: 'No token found'
            });
        }
    } catch (e: any) {
        results.push({
            name: 'QuickBooks OAuth',
            status: 'error',
            responseTime: 0,
            lastCheck: new Date().toISOString(),
            message: `DB error: ${e.message}`
        });
    }

    // Check Snowflake health via Python freshness check JSON
    // (Node.js snowflake-sdk hangs indefinitely — removed)
    try {
        const freshnessFile = '/tmp/snowflake-freshness.json';
        if (fs.existsSync(freshnessFile)) {
            const freshness = JSON.parse(fs.readFileSync(freshnessFile, 'utf8'));
            const checkedAt = new Date(freshness.checked_at);
            const ageHours = (Date.now() - checkedAt.getTime()) / 3600000;
            const staleCount = freshness.stale_count || 0;
            const errorCount = freshness.error_count || 0;

            let sfStatus: 'healthy' | 'warning' | 'error' = 'healthy';
            let sfMessage = '';

            if (ageHours > 6) {
                sfStatus = 'warning';
                sfMessage = `Freshness check is ${Math.round(ageHours)}h old`;
            } else if (errorCount > 0) {
                sfStatus = 'error';
                sfMessage = `${errorCount} table errors detected`;
            } else if (staleCount > 0) {
                sfStatus = 'warning';
                sfMessage = `${staleCount} tables stale, checked ${Math.round(ageHours * 10) / 10}h ago`;
            } else {
                sfMessage = `All tables fresh, checked ${Math.round(ageHours * 10) / 10}h ago`;
            }

            results.push({
                name: 'Snowflake',
                status: sfStatus,
                responseTime: 0,
                lastCheck: checkedAt.toISOString(),
                message: sfMessage
            });
        } else {
            results.push({
                name: 'Snowflake',
                status: 'warning',
                responseTime: 0,
                lastCheck: new Date().toISOString(),
                message: 'No freshness data — run snowflake-freshness-check.py'
            });
        }
    } catch (e: any) {
        results.push({
            name: 'Snowflake',
            status: 'error',
            responseTime: 0,
            lastCheck: new Date().toISOString(),
            message: `Check failed: ${e.message}`
        });
    }

    // Also check Snowflake cache for analytics data freshness
    try {
        const cacheFile = '/tmp/healthie-revenue-cache.json';
        if (fs.existsSync(cacheFile)) {
            const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            const cacheAge = Math.floor((Date.now() - new Date(cache.cached_at).getTime()) / 3600000);
            results.push({
                name: 'Snowflake Cache',
                status: cacheAge < 24 ? 'healthy' : cacheAge < 48 ? 'warning' : 'error',
                responseTime: 0,
                lastCheck: cache.cached_at,
                message: `Cached ${cacheAge}h ago`
            });
        }
    } catch (e) {
        // Cache check is optional - don't add error if it fails
    }

    // Check Access Labs API (lab ordering system)
    try {
        const envPath = '/home/ec2-user/.env.production';
        if (!fs.existsSync(envPath)) {
            results.push({
                name: 'Access Labs',
                status: 'error',
                responseTime: 0,
                lastCheck: new Date().toISOString(),
                message: 'CRITICAL: .env.production file missing!'
            });
        } else {
            const envContent = fs.readFileSync(envPath, 'utf8');
            const hasUsername = envContent.includes('ACCESS_LABS_USERNAME=');
            const hasPassword = envContent.includes('ACCESS_LABS_PASSWORD=');
            if (!hasUsername || !hasPassword) {
                results.push({
                    name: 'Access Labs',
                    status: 'error',
                    responseTime: 0,
                    lastCheck: new Date().toISOString(),
                    message: 'Access Labs credentials missing from .env.production'
                });
            } else {
                // Try to authenticate with Access Labs
                try {
                    const usernameMatch = envContent.match(/ACCESS_LABS_USERNAME=(.+)/);
                    const passwordMatch = envContent.match(/ACCESS_LABS_PASSWORD=(.+)/);
                    const apiUrlMatch = envContent.match(/ACCESS_LABS_API_URL=(.+)/);
                    const apiUrl = apiUrlMatch ? apiUrlMatch[1].trim() : 'https://access.labsvc.net';
                    const start = Date.now();
                    const authResp = await fetch(`${apiUrl}/authAPI.cgi?mode=getSessionkey&username=${encodeURIComponent(usernameMatch![1].trim())}&password=${encodeURIComponent(passwordMatch![1].trim())}`, {
                        method: 'POST',
                        signal: AbortSignal.timeout(10000) // 10 second timeout
                    });
                    const responseTime = Date.now() - start;
                    if (authResp.ok) {
                        results.push({
                            name: 'Access Labs',
                            status: 'healthy',
                            responseTime,
                            lastCheck: new Date().toISOString(),
                            message: `Auth OK (${responseTime}ms)`
                        });
                    } else {
                        results.push({
                            name: 'Access Labs',
                            status: 'warning',
                            responseTime,
                            lastCheck: new Date().toISOString(),
                            message: `Auth returned ${authResp.status}`
                        });
                    }
                } catch (authErr: any) {
                    results.push({
                        name: 'Access Labs',
                        status: 'warning',
                        responseTime: 0,
                        lastCheck: new Date().toISOString(),
                        message: `API unreachable: ${authErr.message}`
                    });
                }
            }
        }
    } catch (e: any) {
        results.push({
            name: 'Access Labs',
            status: 'error',
            responseTime: 0,
            lastCheck: new Date().toISOString(),
            message: `Check failed: ${e.message}`
        });
    }

    // Check PostgreSQL
    try {
        const { query } = await import('@/lib/db');
        const start = Date.now();
        await query('SELECT 1');
        const responseTime = Date.now() - start;
        results.push({
            name: 'PostgreSQL',
            status: 'healthy',
            responseTime,
            lastCheck: new Date().toISOString(),
            message: `OK (${responseTime}ms)`
        });
    } catch (e: any) {
        results.push({
            name: 'PostgreSQL',
            status: 'error',
            responseTime: 0,
            lastCheck: new Date().toISOString(),
            message: `Connection failed: ${e.message}`
        });
    }

    return results as any;
}

// Check cron job status from log files
async function getCronJobs(): Promise<Array<{
    name: string;
    schedule: string;
    lastRun: string | null;
    hoursAgo: number;
    status: 'success' | 'warning' | 'error' | 'unknown';
    duration?: string;
}>> {
    // Log paths match cron-alert.sh wrapper output (logs/cron/)
    // Updated Feb 22, 2026: reflects crontab restructure (individual Healthie syncs
    // replaced by unified sync-all-to-snowflake.py)
    const jobs = [
        { name: 'Snowflake Sync (All Data)', logFile: '/home/ec2-user/logs/cron/snowflake-sync.log', schedule: 'Every 4h' },
        { name: 'Snowflake Freshness', logFile: '/home/ec2-user/logs/cron/snowflake-freshness.log', schedule: 'Every 2h' },
        { name: 'Morning Report', logFile: '/home/ec2-user/logs/cron/morning-report.log', schedule: 'Daily 7am' },
        { name: 'QuickBooks Sync', logFile: '/home/ec2-user/logs/cron/quickbooks-sync.log', schedule: 'Every 3h' },
        { name: 'Healthie Revenue Cache', logFile: '/home/ec2-user/logs/cron/healthie-revenue-cache.log', schedule: 'Every 6h' },
        { name: 'Peptide Purchases Sync', logFile: '/home/ec2-user/logs/cron/peptide-sync.log', schedule: 'Every 6h' },
        { name: 'Access Labs Sync', logFile: '/home/ec2-user/logs/cron/lab-results-fetch.log', schedule: 'Every 30m' },
        { name: 'Healthie Webhooks', logFile: '/home/ec2-user/logs/cron/process-healthie-webhooks.log', schedule: 'Every 5m' },
        { name: 'Healthie Failed Payments', logFile: '/home/ec2-user/logs/cron/healthie-failed-payments.log', schedule: 'Every 6h' },
        { name: 'Lab Status Refresh', logFile: '/home/ec2-user/logs/cron/lab-status-refresh.log', schedule: 'Daily 10pm' },
        { name: 'Infrastructure Monitor', logFile: '/home/ec2-user/logs/cron/infrastructure-monitor.log', schedule: 'Daily 9am' },
        { name: 'Heartbeat', logFile: '/home/ec2-user/logs/cron/heartbeat.log', schedule: 'Every 5m' },
    ];

    const results = [];

    for (const job of jobs) {
        try {
            const stats = fs.statSync(job.logFile);
            const hoursAgo = Math.round((Date.now() - stats.mtimeMs) / 3600000 * 10) / 10;

            // Try to read last line for success/error
            const { stdout } = await execAsync(`tail -1 ${job.logFile} 2>/dev/null || echo ""`);
            // More precise error detection - avoid false positives like "errors: 0"
            const lowerLine = stdout.toLowerCase();
            const hasError = (lowerLine.includes('error:') || lowerLine.includes('failed') ||
                lowerLine.includes('exception') || lowerLine.includes('fatal')) &&
                !lowerLine.includes('errors: 0') && !lowerLine.includes('error: 0');

            results.push({
                name: job.name,
                schedule: job.schedule,
                lastRun: stats.mtime.toISOString(),
                hoursAgo,
                status: hasError ? 'error' : hoursAgo < 24 ? 'success' : hoursAgo < 48 ? 'warning' : 'error'
            });
        } catch (e) {
            results.push({
                name: job.name,
                schedule: job.schedule,
                lastRun: null,
                hoursAgo: -1,
                status: 'unknown'
            });
        }
    }

    return results as any;
}

// Get system resources (detailed)
async function getSystemResources(): Promise<{
    memory: { total: number; used: number; free: number; percent: number };
    cpu: { loadAvg: number[]; cores: number; percent: number };
    disk: { total: number; used: number; free: number; percent: number };
    uptime: string;
}> {
    const resources = {
        memory: { total: 0, used: 0, free: 0, percent: 0 },
        cpu: { loadAvg: [0, 0, 0], cores: 1, percent: 0 },
        disk: { total: 0, used: 0, free: 0, percent: 0 },
        uptime: 'N/A'
    };

    try {
        // Memory
        const { stdout: memOut } = await execAsync("free -m | grep Mem | awk '{print $2, $3, $4}'");
        const [total, used, free] = memOut.trim().split(' ').map(Number);
        resources.memory = { total, used, free, percent: Math.round((used / total) * 100) };

        // CPU
        const { stdout: loadOut } = await execAsync("cat /proc/loadavg");
        const loadParts = loadOut.trim().split(' ');
        const { stdout: cpuOut } = await execAsync("nproc");
        const cores = parseInt(cpuOut.trim());
        resources.cpu = {
            loadAvg: [parseFloat(loadParts[0]), parseFloat(loadParts[1]), parseFloat(loadParts[2])],
            cores,
            percent: Math.round((parseFloat(loadParts[0]) / cores) * 100)
        };

        // Disk
        const { stdout: diskOut } = await execAsync("df -BG / | tail -1 | awk '{print $2, $3, $4, $5}'");
        const diskParts = diskOut.trim().split(' ');
        resources.disk = {
            total: parseInt(diskParts[0]),
            used: parseInt(diskParts[1]),
            free: parseInt(diskParts[2]),
            percent: parseInt(diskParts[3])
        };

        // Uptime
        const { stdout: uptimeOut } = await execAsync("uptime -p");
        resources.uptime = uptimeOut.trim().replace('up ', '');
    } catch (e) {
        console.error('Failed to get system resources:', e);
    }

    return resources;
}

// Get recent errors from PM2 logs
async function getRecentErrors(): Promise<Array<{
    process: string;
    timestamp: string;
    message: string;
}>> {
    try {
        const { stdout } = await execAsync(`
            find /home/ec2-user/.pm2/logs -name "*-error.log" -exec tail -5 {} \\; 2>/dev/null | 
            grep -i "error\\|failed\\|exception" | 
            tail -10
        `);

        return stdout.trim().split('\n')
            .filter(line => line.length > 0)
            .map(line => ({
                process: 'pm2',
                timestamp: new Date().toISOString(),
                message: line.slice(0, 200)
            }));
    } catch (e) {
        return [];
    }
}

// Check webhook health - are webhooks being received and processed?
async function checkWebhookHealth(): Promise<{
    status: 'healthy' | 'warning' | 'error';
    lastReceived: string | null;
    hoursAgo: number;
    pending: number;
    recentProcessed: number;
    recentErrors: number;
    message: string;
}> {
    try {
        const { query } = await import('@/lib/db');

        // Get last received webhook
        const lastReceived = await query(`
            SELECT received_at, event_type, status 
            FROM healthie_webhook_events 
            ORDER BY received_at DESC 
            LIMIT 1
        `);

        // Get counts for last 24 hours
        const stats = await query(`
            SELECT 
                COUNT(*) FILTER (WHERE status = 'received') as pending,
                COUNT(*) FILTER (WHERE status = 'processed' AND processed_at > NOW() - INTERVAL '24 hours') as recent_processed,
                COUNT(*) FILTER (WHERE status = 'error' AND processed_at > NOW() - INTERVAL '24 hours') as recent_errors,
                COUNT(*) FILTER (WHERE received_at > NOW() - INTERVAL '24 hours') as total_24h
            FROM healthie_webhook_events
        `);

        // Get recent error details for debugging
        const errorDetails = await query(`
            SELECT event_type, error, received_at, processed_at
            FROM healthie_webhook_events
            WHERE status = 'error' AND processed_at > NOW() - INTERVAL '24 hours'
            ORDER BY processed_at DESC
            LIMIT 5
        `);

        const lastReceivedAt = lastReceived[0]?.received_at;
        const hoursAgo = lastReceivedAt
            ? Math.round((Date.now() - new Date(lastReceivedAt).getTime()) / 3600000 * 10) / 10
            : -1;

        const pending = parseInt(stats[0]?.pending || '0');
        const recentProcessed = parseInt(stats[0]?.recent_processed || '0');
        const recentErrors = parseInt(stats[0]?.recent_errors || '0');
        const total24h = parseInt(stats[0]?.total_24h || '0');

        // Format error details for response
        const recentErrorDetails = errorDetails.map((e: any) => ({
            eventType: e.event_type,
            errorMessage: e.error?.substring(0, 200), // Truncate long messages
            receivedAt: e.received_at,
            processedAt: e.processed_at
        }));

        // Determine status
        let status: 'healthy' | 'warning' | 'error' = 'healthy';
        let message = '';

        if (hoursAgo === -1) {
            status = 'error';
            message = 'No webhooks ever received - check Healthie subscription';
        } else if (hoursAgo > 48) {
            status = 'error';
            message = `No webhooks in ${Math.round(hoursAgo)}h - may be failing silently`;
        } else if (hoursAgo > 24) {
            status = 'warning';
            message = `Last webhook ${Math.round(hoursAgo)}h ago - check if expected`;
        } else if (recentErrors > 0) {
            status = 'warning';
            message = `${recentErrors} errors in last 24h, ${recentProcessed} processed`;
        } else if (pending > 50) {
            status = 'warning';
            message = `${pending} webhooks pending processing (normally clears every 5min)`;
        } else {
            message = `${total24h} webhooks in 24h, ${recentProcessed} processed, ${pending} pending`;
        }

        return {
            status,
            lastReceived: lastReceivedAt ? new Date(lastReceivedAt).toISOString() : null,
            hoursAgo,
            pending,
            recentProcessed,
            recentErrors,
            recentErrorDetails,
            message
        };
    } catch (e: any) {
        return {
            status: 'error',
            lastReceived: null,
            hoursAgo: -1,
            pending: 0,
            recentProcessed: 0,
            recentErrors: 0,
            recentErrorDetails: [],
            message: `DB error: ${e.message}`
        };
    }
}

export async function GET() {
    try {
        const [processes, apiHealth, cronJobs, resources, recentErrors, webhookHealth, cloudwatchAlarms] = await Promise.all([
            getPM2Processes(),
            checkApiHealth(),
            getCronJobs(),
            getSystemResources(),
            getRecentErrors(),
            checkWebhookHealth(),
            getCloudWatchAlarms()
        ]);

        // Generate alerts
        const alerts: Array<{ level: 'critical' | 'warning' | 'info'; message: string }> = [];

        // Check for critical issues
        processes.filter(p => p.status !== 'online').forEach(p => {
            alerts.push({ level: 'critical', message: `PM2 process "${p.name}" is ${p.status}` });
        });

        apiHealth.filter(a => a.status === 'error').forEach(a => {
            alerts.push({ level: 'critical', message: `${a.name}: ${a.message}` });
        });

        cronJobs.filter(c => c.status === 'error').forEach(c => {
            alerts.push({ level: 'warning', message: `Cron "${c.name}" failed or stale (${c.hoursAgo}h ago)` });
        });

        // Webhook health alerts
        if (webhookHealth.status === 'error') {
            alerts.push({ level: 'critical', message: `Healthie Webhooks: ${webhookHealth.message}` });
        } else if (webhookHealth.status === 'warning') {
            alerts.push({ level: 'warning', message: `Healthie Webhooks: ${webhookHealth.message}` });
        }

        // CloudWatch alarm alerts
        cloudwatchAlarms.filter(a => a.state === 'ALARM').forEach(a => {
            alerts.push({ level: 'critical', message: `CloudWatch: ${a.name} - ${a.reason.substring(0, 100)}` });
        });

        if (resources.memory.percent > 90) {
            alerts.push({ level: 'critical', message: `Memory usage critical: ${resources.memory.percent}%` });
        } else if (resources.memory.percent > 80) {
            alerts.push({ level: 'warning', message: `Memory usage high: ${resources.memory.percent}%` });
        }

        if (resources.disk.percent > 90) {
            alerts.push({ level: 'critical', message: `Disk usage critical: ${resources.disk.percent}%` });
        } else if (resources.disk.percent > 80) {
            alerts.push({ level: 'warning', message: `Disk usage high: ${resources.disk.percent}%` });
        }

        const response = NextResponse.json({
            timestamp: new Date().toISOString(),
            alerts,
            processes,
            apiHealth,
            cronJobs,
            resources,
            recentErrors,
            webhookHealth,
            cloudwatchAlarms
        });

        // Prevent caching
        response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        response.headers.set('Pragma', 'no-cache');
        response.headers.set('Expires', '0');

        return response;
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

