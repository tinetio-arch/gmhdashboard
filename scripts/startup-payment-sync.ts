#!/usr/bin/env npx tsx
/**
 * Startup Payment Sync - Runs payment sync after extended dashboard downtime
 * 
 * This script is called as a PM2 pre-start hook for gmh-dashboard.
 * It checks the last heartbeat timestamp and:
 * - If downtime > 1 hour: runs the failed payments sync
 * - If downtime <= 1 hour: skips (normal restart)
 * 
 * This prevents missed payment failures when the dashboard is down for extended periods.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/.env' });
dotenv.config({ path: '.env.local' });

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const HEARTBEAT_FILE = path.join(__dirname, '..', '.heartbeat');
const DOWNTIME_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour in milliseconds

// Telegram alerting
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ALERT_CHAT_ID = process.env.TELEGRAM_APPROVAL_CHAT_ID;

async function sendTelegramAlert(message: string) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ALERT_CHAT_ID) {
        console.log('[Startup Sync] Telegram not configured, skipping alert');
        return;
    }

    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_ALERT_CHAT_ID,
                text: message,
                parse_mode: 'HTML'
            })
        });
        console.log('[Startup Sync] Telegram alert sent');
    } catch (err) {
        console.error('[Startup Sync] Failed to send Telegram alert:', err);
    }
}

function readLastHeartbeat(): { timestamp: number; isoTime: string } | null {
    try {
        if (!fs.existsSync(HEARTBEAT_FILE)) {
            console.log('[Startup Sync] No heartbeat file found - first run or was deleted');
            return null;
        }
        const data = JSON.parse(fs.readFileSync(HEARTBEAT_FILE, 'utf-8'));
        return data;
    } catch (err) {
        console.error('[Startup Sync] Error reading heartbeat file:', err);
        return null;
    }
}

function writeHeartbeat() {
    const timestamp = Date.now();
    const data = {
        timestamp,
        isoTime: new Date(timestamp).toISOString(),
        service: 'gmh-dashboard'
    };
    fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify(data, null, 2));
    console.log(`[Startup Sync] Heartbeat updated: ${data.isoTime}`);
}

async function runPaymentSync() {
    console.log('[Startup Sync] Running failed payments sync...');

    // Import and run the sync logic directly
    const { query: dbQuery } = await import('../lib/db');

    const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY!;
    const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';

    const FAILED_STATUSES = new Set(['declined', 'failed', 'card_declined', 'error', 'voided', 'card_error']);

    async function healthieQuery<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
        const response = await fetch(HEALTHIE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                authorization: `Basic ${HEALTHIE_API_KEY}`,
                authorizationsource: 'API',
            },
            body: JSON.stringify({ query, variables }),
        });

        if (!response.ok) {
            throw new Error(`Healthie API error: ${response.status}`);
        }

        const result = await response.json() as any;
        if (result.errors) {
            throw new Error(`Healthie GraphQL error: ${JSON.stringify(result.errors)}`);
        }

        return result.data as T;
    }

    let failedPayments: { name: string; status: string; amount: string; type: string }[] = [];
    let patientsMarkedHold: string[] = [];

    const PAID_STATUSES = new Set(['paid', 'complete', 'completed', 'succeeded', 'success', 'processed']);

    /**
     * Check if a patient has a successful billing item created AFTER a given failed one.
     * Prevents re-processing stale historical failures.
     */
    async function hasNewerSuccessfulPayment(healthieClientId: string, failedCreatedAt: string): Promise<boolean> {
        try {
            const query = `query GetPatientBillingItems($client_id: ID) {
                billingItems(sender_id: $client_id, page_size: 10) {
                    id
                    state
                    created_at
                }
            }`;
            const data = await healthieQuery<{ billingItems: any[] }>(query, { client_id: healthieClientId });
            const items = data.billingItems || [];
            const failedDate = new Date(failedCreatedAt).getTime();
            for (const item of items) {
                const state = (item.state || '').toLowerCase();
                const createdAt = new Date(item.created_at || 0).getTime();
                if (PAID_STATUSES.has(state) && createdAt >= failedDate) {
                    return true;
                }
            }
            return false;
        } catch (err) {
            console.error(`  ⚠️ Error checking newer payments for ${healthieClientId}:`, err);
            return false;
        }
    }

    // ========================================
    // 1. Check requestedPayments (one-time)
    // ========================================
    console.log('[Startup Sync] Checking requestedPayments...');
    const requestedPaymentsQuery = `query GetRequestedPayments($offset: Int, $page_size: Int) {
        requestedPayments(offset: $offset, page_size: $page_size) {
            id
            recipient_id
            recipient { full_name email }
            price
            status
            created_at
            updated_at
        }
    }`;

    let offset = 0;
    const pageSize = 100;

    while (true) {
        const data = await healthieQuery<{ requestedPayments: any[] }>(requestedPaymentsQuery, { offset, page_size: pageSize });
        const payments = data.requestedPayments || [];

        if (payments.length === 0) break;

        for (const p of payments) {
            const status = (p.status || '').toLowerCase();
            if (FAILED_STATUSES.has(status)) {
                // For requestedPayments: recipient = PATIENT, sender = provider
                const patientName = p.recipient?.full_name || 'Unknown';
                const healthieId = p.recipient_id || null;

                failedPayments.push({
                    name: patientName,
                    status,
                    amount: p.price || '0',
                    type: 'one-time'
                });

                // Update patient status in database - match via healthie_clients table
                const timestamp = new Date().toISOString().split('T')[0];
                const noteEntry = `[${timestamp}] AUTO-SYNC: One-time payment ${status} - $${p.price || '?'}`;

                // Try healthie_clients match first (canonical source)
                const result = await dbQuery(`
                    UPDATE patients p
                    SET 
                        status_key = 'hold_payment_research',
                        alert_status = 'Hold - Payment Research',
                        notes = CASE 
                            WHEN p.notes IS NULL OR p.notes = '' THEN $2
                            ELSE p.notes || E'\\n' || $2
                        END,
                        last_modified = NOW()
                    FROM healthie_clients hc
                    WHERE hc.patient_id::text = p.patient_id::text
                        AND hc.healthie_client_id = $1
                        AND hc.is_active = TRUE
                        AND p.status_key NOT IN ('hold_payment_research', 'inactive')
                    RETURNING p.patient_id, p.full_name
                `, [healthieId, noteEntry]);

                if (result.length > 0) {
                    patientsMarkedHold.push(patientName);
                    console.log(`  ⚠️  ${patientName}: Set to HOLD (one-time: ${status})`);
                } else if (patientName !== 'Unknown') {
                    // Fallback to name match
                    const nameResult = await dbQuery(`
                        UPDATE patients
                        SET 
                            status_key = 'hold_payment_research',
                            alert_status = 'Hold - Payment Research',
                            notes = CASE 
                                WHEN notes IS NULL OR notes = '' THEN $2
                                ELSE notes || E'\\n' || $2
                            END,
                            last_modified = NOW()
                        WHERE LOWER(full_name) = LOWER($1)
                            AND status_key NOT IN ('hold_payment_research', 'inactive')
                        RETURNING patient_id
                    `, [patientName, noteEntry]);

                    if (nameResult.length > 0) {
                        patientsMarkedHold.push(patientName + ' (name match)');
                        console.log(`  ⚠️  ${patientName}: Set to HOLD (one-time name match: ${status})`);
                    }
                }
            }
        }

        offset += pageSize;
        if (payments.length < pageSize) break;
    }
    console.log(`[Startup Sync] Checked requestedPayments: ${offset} total`);

    // ========================================
    // 2. Check billingItems (RECURRING/subscription)
    // ========================================
    console.log('[Startup Sync] Checking failed billingItems (recurring)...');
    // NOTE: "sender" is the PATIENT who pays, "recipient" is the PROVIDER who receives
    const billingItemsQuery = `query GetFailedBillingItems($offset: Int, $page_size: Int) {
        billingItems(offset: $offset, page_size: $page_size, status: "failed") {
            id
            state
            failure_reason
            stripe_error
            amount_paid
            is_recurring
            sender { id full_name email }
            created_at
        }
    }`;

    let unmatchedPatients: { name: string; healthieId: string; amount: string }[] = [];

    offset = 0;
    while (true) {
        const data = await healthieQuery<{ billingItems: any[] }>(billingItemsQuery, { offset, page_size: pageSize });
        const items = data.billingItems || [];

        if (items.length === 0) break;

        for (const item of items) {
            // Only process recent failures (last 7 days)
            const createdAt = new Date(item.created_at);
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            if (createdAt < sevenDaysAgo) continue;

            // sender = PATIENT who pays (not recipient which is the provider)
            const patientName = item.sender?.full_name || 'Unknown';
            const healthieId = item.sender?.id || null;
            const failureReason = item.failure_reason || 'Payment failed';

            failedPayments.push({
                name: patientName,
                status: item.state || 'failed',
                amount: item.amount_paid || '0',
                type: item.is_recurring ? 'recurring' : 'billing-item'
            });

            // Check if patient has a newer successful payment AFTER this failure
            const hasPaid = await hasNewerSuccessfulPayment(healthieId, item.created_at || '');
            if (hasPaid) {
                console.log(`  ⏭️  ${patientName}: Skipping hold - newer successful payment found after this failure`);
                continue;
            }

            // Update patient status in database - match via healthie_clients table (canonical source)
            const timestamp = new Date().toISOString().split('T')[0];
            const noteEntry = `[${timestamp}] AUTO-SYNC: Recurring payment FAILED - $${item.amount_paid || '?'} - ${failureReason.substring(0, 100)}`;

            const result = await dbQuery(`
                UPDATE patients p
                SET 
                    status_key = 'hold_payment_research',
                    alert_status = 'Hold - Payment Research',
                    notes = CASE 
                        WHEN p.notes IS NULL OR p.notes = '' THEN $2
                        ELSE p.notes || E'\\n' || $2
                    END,
                    last_modified = NOW()
                FROM healthie_clients hc
                WHERE hc.patient_id::text = p.patient_id::text
                    AND hc.healthie_client_id = $1
                    AND hc.is_active = TRUE
                    AND p.status_key NOT IN ('hold_payment_research', 'inactive')
                RETURNING p.patient_id, p.full_name
            `, [healthieId, noteEntry]);

            // Fallback to name match if no healthie_clients match
            let matched = result.length > 0;
            if (!matched && patientName !== 'Unknown') {
                const nameResult = await dbQuery(`
                    UPDATE patients
                    SET 
                        status_key = 'hold_payment_research',
                        alert_status = 'Hold - Payment Research',
                        notes = CASE 
                            WHEN notes IS NULL OR notes = '' THEN $2
                            ELSE notes || E'\\n' || $2
                        END,
                        last_modified = NOW()
                    WHERE LOWER(full_name) = LOWER($1)
                        AND status_key NOT IN ('hold_payment_research', 'inactive')
                    RETURNING patient_id, full_name
                `, [patientName, noteEntry]);
                matched = nameResult.length > 0;
                if (matched) {
                    patientsMarkedHold.push(patientName + ' (name match)');
                    console.log(`  ⚠️  ${patientName}: Set to HOLD (name match, recurring: ${item.state})`);
                }
            } else if (matched) {
                patientsMarkedHold.push(patientName);
                console.log(`  ⚠️  ${patientName}: Set to HOLD (healthie_clients match, recurring: ${item.state})`);
            }

            if (!matched) {
                // Track unmatched for manual review
                unmatchedPatients.push({
                    name: patientName,
                    healthieId: healthieId || 'unknown',
                    amount: item.amount_paid || '0'
                });
                console.log(`  ⚠️  ${patientName} (Healthie ID: ${healthieId}): NOT FOUND in DB - needs manual review`);
            }
        }

        offset += pageSize;
        if (items.length < pageSize) break;
    }
    console.log(`[Startup Sync] Checked failed billingItems`);

    return { failedPayments, patientsMarkedHold, unmatchedPatients };
}

async function main() {
    console.log('\n===========================================');
    console.log('[Startup Sync] Dashboard startup check');
    console.log('===========================================\n');

    const lastHeartbeat = readLastHeartbeat();

    if (!lastHeartbeat) {
        console.log('[Startup Sync] No previous heartbeat - skipping sync (first run)');
        writeHeartbeat();
        return;
    }

    const now = Date.now();
    const downtimeMs = now - lastHeartbeat.timestamp;
    const downtimeHours = (downtimeMs / (1000 * 60 * 60)).toFixed(2);

    console.log(`[Startup Sync] Last heartbeat: ${lastHeartbeat.isoTime}`);
    console.log(`[Startup Sync] Downtime: ${downtimeHours} hours`);

    if (downtimeMs > DOWNTIME_THRESHOLD_MS) {
        console.log(`\n⚠️  [Startup Sync] Extended downtime detected (>${DOWNTIME_THRESHOLD_MS / (1000 * 60)} minutes)`);
        console.log('[Startup Sync] Running payment sync to catch missed failures...\n');

        try {
            const { failedPayments, patientsMarkedHold } = await runPaymentSync();

            // Send Telegram alert about the sync
            const alertMessage = `🔄 <b>STARTUP PAYMENT SYNC</b>

Dashboard was down for <b>${downtimeHours} hours</b>
Automatic payment sync completed.

<b>Results:</b>
• Failed payments found: ${failedPayments.length}
• Patients set to HOLD: ${patientsMarkedHold.length}

${patientsMarkedHold.length > 0 ? `<b>Patients on HOLD:</b>\n${patientsMarkedHold.map(n => `• ${n}`).join('\n')}` : '✅ No new failed payments detected.'}`;

            await sendTelegramAlert(alertMessage);

            console.log('\n[Startup Sync] ✅ Complete');
            console.log(`  Failed payments: ${failedPayments.length}`);
            console.log(`  Patients set to HOLD: ${patientsMarkedHold.length}`);
        } catch (err) {
            console.error('[Startup Sync] ❌ Error during sync:', err);
            await sendTelegramAlert(`❌ <b>STARTUP SYNC FAILED</b>\n\nDashboard was down for ${downtimeHours} hours.\nPayment sync failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    } else {
        console.log('[Startup Sync] Normal restart - no sync needed');
    }

    // Update heartbeat for next startup check
    writeHeartbeat();
}

main().catch(err => {
    console.error('[Startup Sync] Fatal error:', err);
    process.exit(1);
});
