#!/usr/bin/env npx tsx
/**
 * Sync Healthie Failed Payments to GMH Dashboard
 * 
 * This script queries the Healthie API for:
 *   1. requestedPayments - one-time invoice payments
 *   2. billingItems(status: "failed") - recurring/subscription CC failures
 * 
 * It identifies failed/declined payments and updates patient status
 * in the GMH Dashboard accordingly.
 * 
 * IMPORTANT: For billingItems, "sender" = PATIENT, "recipient" = PROVIDER (reversed from requestedPayments)
 * 
 * Run manually: npx tsx scripts/sync-healthie-failed-payments.ts
 * Cron: every 6 hours
 */

import dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/.env' });
dotenv.config({ path: '.env.local' });

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { query as dbQuery } from '../lib/db';

// Track processed billing item IDs to prevent reprocessing stale failures
const PROCESSED_FILE = path.join(__dirname, '..', '.processed-billing-items.json');
const PROCESSED_MAX_AGE_DAYS = 60;

function loadProcessedBillingItems(): Map<string, number> {
    try {
        if (!fs.existsSync(PROCESSED_FILE)) return new Map();
        const data = JSON.parse(fs.readFileSync(PROCESSED_FILE, 'utf-8'));
        const cutoff = Date.now() - PROCESSED_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
        const map = new Map<string, number>();
        for (const [id, ts] of Object.entries(data)) {
            if (typeof ts === 'number' && ts > cutoff) map.set(id, ts);
        }
        return map;
    } catch {
        return new Map();
    }
}

function saveProcessedBillingItems(processed: Map<string, number>): void {
    const obj: Record<string, number> = {};
    for (const [id, ts] of processed) obj[id] = ts;
    fs.writeFileSync(PROCESSED_FILE, JSON.stringify(obj, null, 2));
}

const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY!;
const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';

// Status sets from healthiePaymentAutomation.ts
const FAILED_STATUSES = new Set(['declined', 'failed', 'card_declined', 'error', 'voided', 'card_error']);
const PAID_STATUSES = new Set(['paid', 'complete', 'completed', 'succeeded', 'success', 'processed']);

interface RequestedPayment {
    id: string;
    recipient_id: string | null;
    recipient_name: string | null;
    recipient_email: string | null;
    price: string | null;
    balance_due: number | null;
    status: string | null;
    created_at: string | null;
    updated_at: string | null;
    paid_at: string | null;
}

interface BillingItem {
    id: string;
    state: string | null;
    failure_reason: string | null;
    stripe_error: string | null;
    amount_paid: string | null;
    is_recurring: boolean | null;
    created_at: string | null;
    sender_id: string | null;
    sender_name: string | null;
    sender_email: string | null;
}

interface PatientMapping {
    patient_id: string;
    full_name: string;
    healthie_client_id: string;
    current_status_key: string | null;
}

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

async function fetchAllRequestedPayments(): Promise<RequestedPayment[]> {
    const pageSize = 100;
    let offset = 0;
    const allPayments: RequestedPayment[] = [];

    const query = `query GetRequestedPayments($offset: Int, $page_size: Int) {
    requestedPayments(offset: $offset, page_size: $page_size) {
      id
      recipient_id
      recipient { full_name email }
      price
      balance_due
      status
      created_at
      updated_at
      paid_at
    }
  }`;

    console.log('📥 Fetching requestedPayments from Healthie...');

    while (true) {
        const data = await healthieQuery<{ requestedPayments: any[] }>(query, { offset, page_size: pageSize });
        const payments = data.requestedPayments || [];

        if (payments.length === 0) break;

        for (const p of payments) {
            allPayments.push({
                id: p.id,
                recipient_id: p.recipient_id,
                recipient_name: p.recipient?.full_name || null,
                recipient_email: p.recipient?.email || null,
                price: p.price,
                balance_due: p.balance_due,
                status: p.status?.toLowerCase() || null,
                created_at: p.created_at,
                updated_at: p.updated_at,
                paid_at: p.paid_at,
            });
        }

        console.log(`  Fetched ${allPayments.length} payments...`);
        offset += pageSize;

        if (payments.length < pageSize) break;
    }

    console.log(`✅ Total requestedPayments fetched: ${allPayments.length}`);
    return allPayments;
}

async function fetchFailedBillingItems(): Promise<BillingItem[]> {
    const pageSize = 100;
    let offset = 0;
    const allItems: BillingItem[] = [];

    // IMPORTANT: billingItems uses "sender" for PATIENT (who pays)
    // This is REVERSED from requestedPayments where "recipient" = PATIENT
    const query = `query GetFailedBillingItems($offset: Int, $page_size: Int) {
    billingItems(offset: $offset, page_size: $page_size, status: "failed") {
      id
      state
      failure_reason
      stripe_error
      amount_paid
      is_recurring
      created_at
      sender { id full_name email }
    }
  }`;

    console.log('📥 Fetching failed billingItems from Healthie...');

    while (true) {
        const data = await healthieQuery<{ billingItems: any[] }>(query, { offset, page_size: pageSize });
        const items = data.billingItems || [];

        if (items.length === 0) break;

        for (const item of items) {
            allItems.push({
                id: item.id,
                state: item.state?.toLowerCase() || null,
                failure_reason: item.failure_reason || null,
                stripe_error: item.stripe_error || null,
                amount_paid: item.amount_paid || null,
                is_recurring: item.is_recurring ?? null,
                created_at: item.created_at || null,
                sender_id: item.sender?.id || null,
                sender_name: item.sender?.full_name || null,
                sender_email: item.sender?.email || null,
            });
        }

        console.log(`  Fetched ${allItems.length} failed billing items...`);
        offset += pageSize;

        if (items.length < pageSize) break;
    }

    console.log(`✅ Total failed billingItems fetched: ${allItems.length}`);
    return allItems;
}

async function loadPatientMappings(): Promise<Map<string, PatientMapping>> {
    // Get all patients with Healthie client IDs
    const rows = await dbQuery<{
        patient_id: string;
        full_name: string;
        healthie_client_id: string;
        status_key: string | null;
    }>(`
    SELECT p.patient_id::text, p.full_name, hc.healthie_client_id, p.status_key
    FROM patients p
    JOIN healthie_clients hc ON p.patient_id::text = hc.patient_id
    WHERE hc.healthie_client_id IS NOT NULL
  `);

    const map = new Map<string, PatientMapping>();
    for (const row of rows) {
        map.set(row.healthie_client_id, {
            patient_id: row.patient_id,
            full_name: row.full_name,
            healthie_client_id: row.healthie_client_id,
            current_status_key: row.status_key,
        });
    }

    console.log(`📋 Loaded ${map.size} patient-Healthie mappings`);
    return map;
}

async function setPatientToPaymentHold(patientId: string, patientName: string, reason: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const noteEntry = `[${timestamp.split('T')[0]}] AUTO-SYNC: ${reason}`;

    await dbQuery(`
    UPDATE patients
    SET 
      status_key = 'hold_payment_research',
      alert_status = 'Hold - Payment Research',
      notes = CASE 
        WHEN notes IS NULL OR notes = '' THEN $2
        ELSE notes || E'\\n' || $2
      END,
      last_modified = NOW()
    WHERE patient_id = $1
      AND status_key NOT IN ('hold_payment_research', 'inactive')
  `, [patientId, noteEntry]);
}

async function reactivatePatient(patientId: string, patientName: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const noteEntry = `[${timestamp.split('T')[0]}] AUTO-SYNC: Payment succeeded - reactivated from hold.`;

    await dbQuery(`
    UPDATE patients
    SET 
      status_key = 'active',
      alert_status = 'Active',
      notes = CASE 
        WHEN notes IS NULL OR notes = '' THEN $2
        ELSE notes || E'\\n' || $2
      END,
      last_modified = NOW()
    WHERE patient_id = $1
      AND status_key = 'hold_payment_research'
  `, [patientId, noteEntry]);
}

async function main() {
    if (!HEALTHIE_API_KEY) {
        console.error('❌ Missing HEALTHIE_API_KEY');
        process.exit(1);
    }

    console.log('🔄 Starting Healthie Failed Payments Sync...\n');

    // Track results
    const results = {
        failedPayments: [] as { name: string; status: string; amount: string; source: string }[],
        patientsMarkedHold: [] as string[],
        patientsReactivated: [] as string[],
        unmapped: [] as { name: string; email: string | null; healthieId: string }[],
    };

    // Load patient mappings
    const patientMap = await loadPatientMappings();

    // ================================================================
    // PART 1: Check requestedPayments (one-time invoice payments)
    // Note: "recipient" = PATIENT for requestedPayments
    // ================================================================
    const payments = await fetchAllRequestedPayments();

    // Group payments by recipient (get most recent status per patient)
    const latestPaymentByRecipient = new Map<string, RequestedPayment>();
    for (const payment of payments) {
        if (!payment.recipient_id) continue;

        const existing = latestPaymentByRecipient.get(payment.recipient_id);
        if (!existing) {
            latestPaymentByRecipient.set(payment.recipient_id, payment);
        } else {
            // Keep the more recent one
            const existingDate = existing.updated_at || existing.created_at || '';
            const paymentDate = payment.updated_at || payment.created_at || '';
            if (paymentDate > existingDate) {
                latestPaymentByRecipient.set(payment.recipient_id, payment);
            }
        }
    }

    console.log(`\n📊 Processing ${latestPaymentByRecipient.size} unique patients from requestedPayments...\n`);

    for (const [healthieClientId, payment] of latestPaymentByRecipient) {
        const patient = patientMap.get(healthieClientId);
        const status = payment.status || '';

        if (FAILED_STATUSES.has(status)) {
            results.failedPayments.push({
                name: payment.recipient_name || 'Unknown',
                status,
                amount: payment.price || '0',
                source: 'requestedPayment',
            });

            if (patient) {
                if (patient.current_status_key !== 'hold_payment_research' && patient.current_status_key !== 'inactive') {
                    await setPatientToPaymentHold(
                        patient.patient_id,
                        patient.full_name,
                        `Payment ${status}: $${payment.price || '?'} (requestedPayment)`
                    );
                    results.patientsMarkedHold.push(patient.full_name);
                    console.log(`  ⚠️  ${patient.full_name}: Set to HOLD (${status}) [requestedPayment]`);
                }
            } else {
                results.unmapped.push({
                    name: payment.recipient_name || 'Unknown',
                    email: payment.recipient_email,
                    healthieId: healthieClientId,
                });
            }
        } else if (PAID_STATUSES.has(status)) {
            if (patient && patient.current_status_key === 'hold_payment_research') {
                await reactivatePatient(patient.patient_id, patient.full_name);
                results.patientsReactivated.push(patient.full_name);
                console.log(`  ✅ ${patient.full_name}: REACTIVATED (payment succeeded) [requestedPayment]`);
            }
        }
    }

    // ================================================================
    // PART 2: Check billingItems (recurring/subscription CC failures)
    // Note: "sender" = PATIENT for billingItems (REVERSED from requestedPayments)
    // ================================================================
    const failedBillingItems = await fetchFailedBillingItems();

    // Track patients already processed from Part 1 to avoid double-processing
    const processedPatientIds = new Set<string>();
    for (const name of results.patientsMarkedHold) processedPatientIds.add(name);

    // Load previously processed billing item IDs to avoid reprocessing stale failures
    const processedBillingItems = loadProcessedBillingItems();
    console.log(`📋 Loaded ${processedBillingItems.size} previously processed billing item IDs`);

    console.log(`\n📊 Processing ${failedBillingItems.length} failed billing items...\n`);

    // Only process recent failures (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    for (const item of failedBillingItems) {
        const createdAt = new Date(item.created_at || 0);
        if (createdAt < thirtyDaysAgo) continue;

        // DEDUP: Skip billing items we've already processed
        if (processedBillingItems.has(item.id)) {
            continue;
        }

        const healthieClientId = item.sender_id;
        if (!healthieClientId) continue;

        const patient = patientMap.get(healthieClientId);
        const status = item.state || 'failed';
        const amount = item.amount_paid ? `${(Number(item.amount_paid) / 100).toFixed(2)}` : 'unknown';

        results.failedPayments.push({
            name: item.sender_name || 'Unknown',
            status,
            amount,
            source: 'billingItem',
        });

        console.log(`  🔴 ${item.sender_name || 'Unknown'}: ${status} - $${amount} (${item.failure_reason || item.stripe_error || 'no reason'}) [billingItem]`);

        if (patient && !processedPatientIds.has(patient.full_name)) {
            if (patient.current_status_key !== 'hold_payment_research' && patient.current_status_key !== 'inactive') {
                await setPatientToPaymentHold(
                    patient.patient_id,
                    patient.full_name,
                    `Recurring payment ${status}: $${amount} - ${item.failure_reason || item.stripe_error || 'CC declined'} (billingItem)`
                );
                results.patientsMarkedHold.push(patient.full_name);
                processedPatientIds.add(patient.full_name);
                console.log(`  ⚠️  ${patient.full_name}: Set to HOLD (${status}) [billingItem]`);
            }
        } else if (!patient) {
            results.unmapped.push({
                name: item.sender_name || 'Unknown',
                email: item.sender_email,
                healthieId: healthieClientId,
            });
        }

        // Mark as processed regardless of whether we acted on it
        processedBillingItems.set(item.id, Date.now());
    }

    // Save processed IDs for next run
    saveProcessedBillingItems(processedBillingItems);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SYNC SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total requestedPayments fetched: ${payments.length}`);
    console.log(`Unique patients from requestedPayments: ${latestPaymentByRecipient.size}`);
    console.log(`Failed billingItems fetched: ${failedBillingItems.length}`);
    console.log(`Total failed payments detected: ${results.failedPayments.length}`);
    const rpFailed = results.failedPayments.filter(f => f.source === 'requestedPayment').length;
    const biFailed = results.failedPayments.filter(f => f.source === 'billingItem').length;
    console.log(`  ↳ From requestedPayments: ${rpFailed}`);
    console.log(`  ↳ From billingItems: ${biFailed}`);
    console.log(`Patients set to HOLD: ${results.patientsMarkedHold.length}`);
    console.log(`Patients REACTIVATED: ${results.patientsReactivated.length}`);
    console.log(`Unmapped Healthie patients: ${results.unmapped.length}`);

    if (results.patientsMarkedHold.length > 0) {
        console.log('\n🚨 Patients set to Payment Hold:');
        results.patientsMarkedHold.forEach(name => console.log(`   - ${name}`));
    }

    if (results.patientsReactivated.length > 0) {
        console.log('\n✅ Patients Reactivated:');
        results.patientsReactivated.forEach(name => console.log(`   - ${name}`));
    }

    if (results.unmapped.length > 0) {
        console.log('\n⚠️  Unmapped Healthie patients with failed payments (need dashboard link):');
        results.unmapped.forEach(p => console.log(`   - ${p.name} (${p.email || 'no email'}) [Healthie ID: ${p.healthieId}]`));
    }

    console.log('\n🎉 Sync complete!');
}

main().catch(err => {
    console.error('❌ Sync failed:', err);
    process.exit(1);
});
