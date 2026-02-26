/**
 * GMH Comprehensive Morning Report
 * 
 * Consolidated daily report sent via Telegram at 7am MST including:
 * - System health status
 * - Controlled substance inventory check status (yesterday's morning + EOD)
 * - Current inventory levels
 * - Financial/payments snapshot (from Snowflake)
 * - AWS infrastructure costs
 * - Dispensing activity
 * - Action items
 * 
 * Run via cron: 0 14 * * * cd /home/ec2-user/gmhdashboard && npx tsx scripts/morning-telegram-report.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
// Load both env files - .env.local for dashboard, .env for Snowflake
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: '/home/ec2-user/.env' });

import fetch from 'node-fetch';
// NOTE: snowflake-sdk import removed — v1.15.0 hangs Node.js on load
import { getDailyCheckSummary, getSystemInventoryCounts } from '../lib/controlledSubstanceCheck';
import { query } from '../lib/db';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Snowflake removed — was hanging indefinitely
import * as fs from 'fs';

async function sendTelegram(text: string) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.log('Telegram not configured, printing to console:');
        console.log(text);
        return;
    }

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text,
            parse_mode: 'Markdown',
            disable_web_page_preview: true
        }),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Telegram send failed: ${res.status} ${body}`);
    }
}

function formatCurrency(n: number | null): string {
    const val = Number(n || 0);
    return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ==================== FINANCIAL DATA (SNOWFLAKE) ====================
interface FinancialData {
    totalCollected: number;
    totalInvoiced: number;
    totalPaid: number;
    totalOpen: number;
    recurringBilling: number;
    packagesPaid: number;
    packagesRemaining: number;
    unpaidPatientsHealthie: number;
    unpaidPatientsAll: number;
    totalPatients: number;
    lastPaymentActivity: string | null;
}

async function getFinancialData(): Promise<FinancialData | null> {
    // First try Postgres-based financial data (QuickBooks + Healthie cache)
    try {
        // Get QuickBooks revenue from Postgres
        const qbResult = await query<{ last7d: string; last30d: string; total: string }>(`
            SELECT 
                COALESCE(SUM(CASE WHEN receipt_date >= CURRENT_DATE - 7 THEN amount ELSE 0 END), 0) as last7d,
                COALESCE(SUM(CASE WHEN receipt_date >= CURRENT_DATE - 30 THEN amount ELSE 0 END), 0) as last30d,
                COALESCE(SUM(amount), 0) as total
            FROM quickbooks_sales_receipts
            WHERE receipt_date >= CURRENT_DATE - 90
        `);

        // Get patient counts
        const patientResult = await query<{ total: string }>(`
            SELECT COUNT(*) as total FROM patients WHERE status_key != 'inactive' OR status_key IS NULL
        `);

        // Get Healthie revenue from cache file if available
        let healthieRevenue = { last7d: 0, last30d: 0 };
        try {
            const fs = require('fs');
            const cache = JSON.parse(fs.readFileSync('/tmp/healthie-revenue-cache.json', 'utf8'));
            healthieRevenue = { last7d: cache.last7Days || 0, last30d: cache.last30Days || 0 };
        } catch (e) {
            console.log('Healthie cache not available');
        }

        const qb7d = parseFloat(qbResult[0]?.last7d || '0');
        const qb30d = parseFloat(qbResult[0]?.last30d || '0');
        const qbTotal = parseFloat(qbResult[0]?.total || '0');

        return {
            totalCollected: qb30d + healthieRevenue.last30d,
            totalInvoiced: qbTotal,
            totalPaid: qb30d,
            totalOpen: 0, // Not available from Postgres
            recurringBilling: qb30d,
            packagesPaid: healthieRevenue.last30d,
            packagesRemaining: 0,
            unpaidPatientsHealthie: 0,
            unpaidPatientsAll: 0,
            totalPatients: parseInt(patientResult[0]?.total || '0'),
            lastPaymentActivity: null
        };
    } catch (err) {
        console.error('Postgres financial query failed:', err);
    }

    // NOTE: Snowflake fallback removed — Node.js snowflake-sdk v1.15.0 hangs indefinitely.
    // All financial data now comes from Postgres (primary) + Healthie cache file.
    // Snowflake sync is handled separately by Python: /home/ec2-user/scripts/sync-all-to-snowflake.py
    console.log('Postgres financial data unavailable, skipping financial section');
    return null;
}


// ==================== SYSTEM HEALTH ====================
async function getSystemHealth(): Promise<{ status: string; issues: string[] }> {
    const issues: string[] = [];

    try {
        await query('SELECT 1');
    } catch (err) {
        issues.push('⚠️ Database connection issue');
    }

    return {
        status: issues.length === 0 ? '✅ All systems operational' : '⚠️ Issues detected',
        issues
    };
}

// ==================== DISPENSING ACTIVITY ====================
async function getRecentDispenses(): Promise<{ count: number; totalMl: number }> {
    const result = await query<{ count: string; total_ml: string }>(`
    SELECT 
      COUNT(*) as count,
      COALESCE(SUM(total_dispensed_ml::numeric), 0) as total_ml
    FROM dispenses
    WHERE dispense_date >= CURRENT_DATE - INTERVAL '1 day'
  `);

    return {
        count: parseInt(result[0]?.count || '0'),
        totalMl: parseFloat(result[0]?.total_ml || '0')
    };
}

async function getUnsignedDispenses(): Promise<number> {
    const result = await query<{ count: string }>(`
    SELECT COUNT(*) as count
    FROM dispenses
    WHERE COALESCE(signature_status, 'awaiting_signature') <> 'signed'
  `);

    return parseInt(result[0]?.count || '0');
}

// ==================== PATIENT COUNTS ====================
async function getPatientCounts(): Promise<{ active: number; hold: number; total: number }> {
    const result = await query<{ status: string; count: string }>(`
    SELECT status, COUNT(*) as count
    FROM patients
    GROUP BY status
  `);

    let active = 0;
    let hold = 0;
    let total = 0;

    for (const row of result) {
        total += parseInt(row.count);
        if (row.status?.toLowerCase().includes('hold')) {
            hold += parseInt(row.count);
        } else if (row.status?.toLowerCase() === 'active') {
            active += parseInt(row.count);
        }
    }

    return { active, hold, total };
}

// ==================== FORMAT REPORT ====================
function formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

async function buildMorningReport(): Promise<string> {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Get all data
    const [
        yesterdayChecks,
        inventory,
        health,
        dispenses,
        unsigned,
        patients,
        financial
    ] = await Promise.all([
        getDailyCheckSummary(yesterday),
        getSystemInventoryCounts(),
        getSystemHealth(),
        getRecentDispenses(),
        getUnsignedDispenses(),
        getPatientCounts(),
        getFinancialData()
    ]);

    let report = `🌅 *GMH MORNING REPORT*\n`;
    report += `📅 ${formatDate(today)}\n\n`;

    // ===== SYSTEM HEALTH =====
    report += `*🖥️ System Status*\n`;
    report += `${health.status}\n`;
    if (health.issues.length > 0) {
        report += health.issues.join('\n') + '\n';
    }
    report += '\n';

    // ===== INVENTORY CHECKS =====
    report += `*📋 Yesterday's Inventory Checks*\n`;

    if (yesterdayChecks.morning.completed) {
        report += `☀️ Morning: ✅ ${yesterdayChecks.morning.time} (${yesterdayChecks.morning.by})`;
        if (yesterdayChecks.morning.notes) {
            report += `\n   📝 _${yesterdayChecks.morning.notes}_`;
        }
        if (yesterdayChecks.morning.hasDiscrepancy) {
            report += `\n   ⚠️ DISCREPANCY`;
            if (yesterdayChecks.morning.reason) {
                report += `: _${yesterdayChecks.morning.reason}_`;
            }
        }
        report += '\n';
    } else {
        report += `☀️ Morning: ❌ NOT COMPLETED\n`;
    }

    if (yesterdayChecks.evening.completed) {
        report += `🌙 EOD: ✅ ${yesterdayChecks.evening.time} (${yesterdayChecks.evening.by})`;
        if (yesterdayChecks.evening.notes) {
            report += `\n   📝 _${yesterdayChecks.evening.notes}_`;
        }
        if (yesterdayChecks.evening.hasDiscrepancy) {
            report += `\n   ⚠️ DISCREPANCY`;
            if (yesterdayChecks.evening.reason) {
                report += `: _${yesterdayChecks.evening.reason}_`;
            }
        }
        report += '\n';
    } else {
        report += `🌙 EOD: ❌ NOT COMPLETED\n`;
    }
    report += '\n';

    // ===== TESTOSTERONE INVENTORY =====
    report += `*💉 Testosterone Inventory*\n`;
    report += `Carrie Boyd: ${inventory.cb30ml.totalMl.toFixed(1)}ml (${inventory.cb30ml.vialCount} vials)\n`;
    report += `TopRX: ${inventory.topRx10ml.totalMl.toFixed(1)}ml (${inventory.topRx10ml.vialCount} vials)\n\n`;

    // ===== DISPENSING ACTIVITY =====
    report += `*📊 Last 24hr Dispensing*\n`;
    report += `Dispenses: ${dispenses.count} | Volume: ${dispenses.totalMl.toFixed(1)}ml\n`;
    if (unsigned > 0) {
        report += `⚠️ Unsigned: ${unsigned}\n`;
    }
    report += '\n';

    // ===== PATIENT COUNTS =====
    report += `*👥 Patients*\n`;
    report += `Active: ${patients.active} | Hold: ${patients.hold} | Total: ${patients.total}\n\n`;

    // ===== FINANCIAL DATA =====
    if (financial) {
        report += `*💰 Financial Snapshot*\n`;
        report += `Collected: ${formatCurrency(financial.totalCollected)}\n`;
        report += `Invoices: ${formatCurrency(financial.totalInvoiced)} invoiced | ${formatCurrency(financial.totalOpen)} open\n`;
        report += `Recurring: ${formatCurrency(financial.recurringBilling)}\n`;
        report += `Packages: ${formatCurrency(financial.packagesPaid)} paid | ${formatCurrency(financial.packagesRemaining)} remaining\n`;
        if (financial.unpaidPatientsAll > 0) {
            report += `⚠️ ${financial.unpaidPatientsAll} patients with open balances\n`;
        }
        report += '\n';
    }

    // ===== ACTION ITEMS =====
    const reminders: string[] = [];
    if (!yesterdayChecks.morning.completed || !yesterdayChecks.evening.completed) {
        reminders.push('🔔 Inventory checks were missed yesterday');
    }
    if (unsigned > 5) {
        reminders.push('🔔 Multiple unsigned dispenses need provider attention');
    }
    if (inventory.cb30ml.totalMl < 60) {
        reminders.push('🔔 Carrie Boyd stock running low');
    }
    if (inventory.topRx10ml.totalMl < 50) {
        reminders.push('🔔 TopRX stock running low');
    }
    if (patients.hold > 5) {
        reminders.push(`🔔 ${patients.hold} patients on hold status`);
    }

    if (reminders.length > 0) {
        report += `*⚡ Action Items*\n`;
        report += reminders.join('\n') + '\n';
    }

    report += `\n_Have a great day!_ 🚀`;

    return report;
}

async function main() {
    try {
        const report = await buildMorningReport();
        await sendTelegram(report);
        console.log('✅ Comprehensive morning report sent successfully');
        process.exit(0);
    } catch (err) {
        console.error('Failed to send morning report:', err);
        process.exit(1);
    }
}

main();
