/**
 * CEO Alerts API - Real-time monitoring of critical business events
 * 
 * Aggregates alerts from:
 * - PM2 service status (system health)
 * - Payment failures (Healthie webhooks, QuickBooks)
 * - Data sync freshness
 * - Inventory levels
 * - Patient hold status
 */

import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const execAsync = promisify(exec);

interface Alert {
    id: string;
    severity: 'critical' | 'warning' | 'info';
    category: 'system' | 'payment' | 'sync' | 'inventory' | 'patient';
    title: string;
    message: string;
    timestamp: string;
    actionUrl?: string;
    actionLabel?: string;
}

export async function GET() {
    const alerts: Alert[] = [];
    const now = new Date().toISOString();

    try {
        // ==================== SYSTEM HEALTH ALERTS ====================
        try {
            const { stdout } = await execAsync('pm2 jlist');
            const processes = JSON.parse(stdout);

            for (const proc of processes) {
                if (proc.pm2_env?.status !== 'online') {
                    alerts.push({
                        id: `pm2-${proc.name}`,
                        severity: 'critical',
                        category: 'system',
                        title: `Service Down: ${proc.name}`,
                        message: `${proc.name} is ${proc.pm2_env?.status || 'offline'}. Restarts: ${proc.pm2_env?.restart_time || 0}`,
                        timestamp: now,
                        actionUrl: '/ops/system-health',
                        actionLabel: 'View Details'
                    });
                } else if ((proc.pm2_env?.restart_time || 0) > 10) {
                    alerts.push({
                        id: `pm2-restarts-${proc.name}`,
                        severity: 'warning',
                        category: 'system',
                        title: `Unstable Service: ${proc.name}`,
                        message: `${proc.name} has restarted ${proc.pm2_env?.restart_time} times`,
                        timestamp: now
                    });
                }
            }
        } catch (e) {
            console.error('PM2 check failed:', e);
        }

        // ==================== PAYMENT FAILURE ALERTS ====================
        // ==================== PAYMENT FAILURE ALERTS ====================
        try {
            // Check QuickBooks Integration Status
            const { needsConnectionAttention } = await import('@/lib/quickbooksHealth');
            const qbHealth = await needsConnectionAttention();

            if (qbHealth.needsAttention) {
                alerts.push({
                    id: 'qb-connection-issue',
                    severity: qbHealth.severity,
                    category: 'sync',
                    title: 'QuickBooks Connection Issue',
                    message: qbHealth.reason || 'Connection requires attention',
                    timestamp: now,
                    actionUrl: '/ops/api/auth/quickbooks',
                    actionLabel: 'Reconnect QuickBooks'
                });
            }

            // ==================== HEALTHIE WEBHOOK HEALTH CHECK ====================
            // Alert if we haven't received any webhooks recently - means integration may be broken
            try {
                const lastWebhook = await query<{ received_at: string; hours_ago: string }>(`
                    SELECT 
                        received_at,
                        EXTRACT(EPOCH FROM (NOW() - received_at)) / 3600 as hours_ago
                    FROM healthie_webhook_events 
                    ORDER BY received_at DESC 
                    LIMIT 1
                `);

                if (lastWebhook.length === 0) {
                    // No webhooks ever received - critical
                    alerts.push({
                        id: 'healthie-webhook-never',
                        severity: 'critical',
                        category: 'sync',
                        title: '⚠️ Healthie Webhooks Not Configured',
                        message: 'No Healthie webhook events have ever been received. Payment failure alerts are NOT working!',
                        timestamp: now,
                        actionUrl: '/ops/admin/quickbooks',
                        actionLabel: 'View Admin Panel'
                    });
                } else {
                    const hoursAgo = parseFloat(lastWebhook[0].hours_ago);

                    if (hoursAgo > 72) {
                        // No webhooks in 3 days - critical
                        alerts.push({
                            id: 'healthie-webhook-critical',
                            severity: 'critical',
                            category: 'sync',
                            title: '🚨 Healthie Webhooks DOWN',
                            message: `No webhook events received in ${Math.round(hoursAgo)} hours. Payment failure detection is NOT working!`,
                            timestamp: now,
                            actionUrl: '/ops/admin/quickbooks',
                            actionLabel: 'View Admin Panel'
                        });
                    } else if (hoursAgo > 24) {
                        // No webhooks in 1 day - warning
                        alerts.push({
                            id: 'healthie-webhook-stale',
                            severity: 'warning',
                            category: 'sync',
                            title: 'Healthie Webhooks Stale',
                            message: `No webhook events in ${Math.round(hoursAgo)} hours. May indicate connectivity issue.`,
                            timestamp: now,
                            actionUrl: '/ops/admin/quickbooks',
                            actionLabel: 'View Admin Panel'
                        });
                    }
                }
            } catch (e) {
                console.error('Healthie webhook health check failed:', e);
            }

            // Check for patients with payment failure alerts
            const failures = await query<{ count: string }>(`
                SELECT COUNT(*) as count 
                FROM patients 
                WHERE alert_status = 'Payment Failed' OR status_key = 'hold_payment_research'
            `);
            const failureCount = parseInt(failures[0]?.count || '0');

            if (failureCount > 0) {
                alerts.push({
                    id: 'payment-failures-critical',
                    severity: 'critical',
                    category: 'payment',
                    title: '🚨 Payment Failures Detected',
                    message: `${failureCount} patient(s) have failed payments recently. Immediate attention required.`,
                    timestamp: now,
                    actionUrl: '/ops/patients?status=hold_payment_research',
                    actionLabel: 'Resolve Payments'
                });
            }

            // Check patients on payment hold (legacy check, kept for broader coverage)
            const holdPatients = await query<{ count: string }>(`
                SELECT COUNT(*) as count 
                FROM patients 
                WHERE status ILIKE '%hold%' AND status ILIKE '%payment%'
                AND alert_status != 'Payment Failed'
            `);
            const holdCount = parseInt(holdPatients[0]?.count || '0');

            if (holdCount > 0) {
                alerts.push({
                    id: 'patients-payment-hold',
                    severity: holdCount > 3 ? 'warning' : 'info',
                    category: 'payment',
                    title: 'Patients on Payment Hold',
                    message: `${holdCount} patient(s) need payment attention`,
                    timestamp: now,
                    actionUrl: '/ops/patients?status=hold',
                    actionLabel: 'View Patients'
                });
            }
        } catch (e) {
            console.error('Payment check failed:', e);
        }

        // ==================== DATA SYNC FRESHNESS ALERTS ====================
        // Uses actual Snowflake data timestamps (not log files, which can lie)
        try {
            const freshnessPath = '/tmp/snowflake-freshness.json';
            if (fs.existsSync(freshnessPath)) {
                const freshnessData = JSON.parse(fs.readFileSync(freshnessPath, 'utf8'));
                const checkedAt = new Date(freshnessData.checked_at);
                const checkAgeHours = (Date.now() - checkedAt.getTime()) / (1000 * 60 * 60);

                // Alert if the freshness check itself hasn't run
                if (checkAgeHours > 4) {
                    alerts.push({
                        id: 'snowflake-check-stale',
                        severity: 'warning',
                        category: 'sync',
                        title: 'Snowflake Freshness Check Not Running',
                        message: `Last freshness check was ${Math.round(checkAgeHours)} hours ago`,
                        timestamp: now,
                    });
                }

                // Alert for each stale table
                for (const table of freshnessData.tables || []) {
                    if (table.status === 'stale') {
                        const severity = table.hours_old > table.threshold_hours * 3 ? 'critical' : 'warning';
                        alerts.push({
                            id: `snowflake-stale-${table.table.toLowerCase()}`,
                            severity,
                            category: 'sync',
                            title: `Snowflake Data Stale: ${table.description || table.table}`,
                            message: `${table.table}: ${table.rows} rows, last update ${table.hours_old}h ago (threshold: ${table.threshold_hours}h)`,
                            timestamp: now,
                        });
                    } else if (table.status === 'error') {
                        alerts.push({
                            id: `snowflake-error-${table.table.toLowerCase()}`,
                            severity: 'critical',
                            category: 'sync',
                            title: `Snowflake Error: ${table.table}`,
                            message: table.error || 'Unknown error querying table',
                            timestamp: now,
                        });
                    }
                }
            } else {
                // Freshness file doesn't exist — monitor not set up
                alerts.push({
                    id: 'snowflake-no-monitor',
                    severity: 'warning',
                    category: 'sync',
                    title: 'Snowflake Freshness Monitor Not Running',
                    message: 'No freshness data found. Run snowflake-freshness-check.py to enable monitoring.',
                    timestamp: now,
                });
            }
        } catch (e) {
            console.error('Snowflake freshness check failed:', e);
        }

        // ==================== INVENTORY ALERTS ====================
        try {
            // Use correct table 'vials' with columns: location, remaining_volume_ml, status
            const inventory = await query<{ location: string; total_ml: string }>(`
                SELECT location, SUM(remaining_volume_ml) as total_ml
                FROM vials
                WHERE status = 'active'
                GROUP BY location
            `);

            for (const item of inventory) {
                const totalMl = parseFloat(item.total_ml || '0');
                const locationName = item.location || 'Unknown';
                if (totalMl < 30) {
                    alerts.push({
                        id: `inventory-critical-${locationName}`,
                        severity: 'critical',
                        category: 'inventory',
                        title: `Low Inventory: ${locationName}`,
                        message: `Only ${totalMl.toFixed(1)}ml remaining`,
                        timestamp: now,
                        actionUrl: '/ops/inventory',
                        actionLabel: 'Manage Inventory'
                    });
                } else if (totalMl < 60) {
                    alerts.push({
                        id: `inventory-warning-${locationName}`,
                        severity: 'warning',
                        category: 'inventory',
                        title: `Low Inventory: ${locationName}`,
                        message: `${totalMl.toFixed(1)}ml remaining - consider reorder`,
                        timestamp: now
                    });
                }
            }
        } catch (e) {
            console.error('Inventory check failed:', e);
        }


        // ==================== UNSIGNED DISPENSES ALERTS ====================
        try {
            const unsigned = await query<{ count: string }>(`
                SELECT COUNT(*) as count
                FROM dispenses
                WHERE COALESCE(signature_status, 'awaiting_signature') <> 'signed'
                AND dispense_date >= CURRENT_DATE - 7
            `);
            const unsignedCount = parseInt(unsigned[0]?.count || '0');

            if (unsignedCount > 5) {
                alerts.push({
                    id: 'dispenses-unsigned',
                    severity: 'warning',
                    category: 'patient',
                    title: 'Unsigned Dispenses',
                    message: `${unsignedCount} dispenses need provider signature`,
                    timestamp: now,
                    actionUrl: '/ops/dispenses?status=unsigned',
                    actionLabel: 'Sign Now'
                });
            }
        } catch (e) {
            console.error('Dispenses check failed:', e);
        }

        // Sort by severity (critical first, then warning, then info)
        const severityOrder = { critical: 0, warning: 1, info: 2 };
        alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

        return NextResponse.json({
            timestamp: now,
            totalAlerts: alerts.length,
            criticalCount: alerts.filter(a => a.severity === 'critical').length,
            warningCount: alerts.filter(a => a.severity === 'warning').length,
            infoCount: alerts.filter(a => a.severity === 'info').length,
            alerts
        });

    } catch (error) {
        console.error('Alerts API error:', error);
        return NextResponse.json({
            timestamp: now,
            totalAlerts: 0,
            criticalCount: 0,
            warningCount: 0,
            infoCount: 0,
            alerts: [],
            error: 'Failed to fetch alerts'
        }, { status: 500 });
    }
}
