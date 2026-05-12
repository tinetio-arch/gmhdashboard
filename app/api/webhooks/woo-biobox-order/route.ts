import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { writeFile, unlink } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import crypto from 'crypto';

const execAsync = promisify(exec);

/**
 * POST /api/webhooks/woo-biobox-order
 *
 * WooCommerce webhook handler for BioBox at-home lab kit orders placed on
 * abxtac.com. Fires on `order.completed` (payment confirmed).
 *
 * Flow:
 *   1. Validate WC webhook HMAC signature (WOO_BIOBOX_WEBHOOK_SECRET env)
 *   2. Parse order, extract BioBox line items (SKU matching /^B0\d\d$/)
 *   3. For each BioBox item:
 *      a. Check customer eligibility (must have consult in last 365 days)
 *      b. If eligible → insert lab_orders row + submit to Access Labs via
 *         existing order_lab.py script (clinic 22937, Dr. Whitten NMD)
 *      c. If NOT eligible → insert lab_orders row with status='held_ineligible',
 *         skip Access Labs submission, alert staff. No silent fail.
 *
 * IMPORTANT: This webhook assumes payment has cleared. The pre-payment
 * eligibility gate lives on the WooCommerce checkout side (WP plugin hook).
 * This handler's defensive check catches any customer who bypassed the gate.
 *
 * Env vars required:
 *   - WOO_BIOBOX_WEBHOOK_SECRET: HMAC secret configured in WC webhook settings
 *   - JARVIS_SHARED_SECRET: for calling lab-eligibility endpoint
 *   - NEXT_PUBLIC_SITE_URL or similar: base URL for internal API calls
 */

// BioBox kit SKUs (from PDF catalog — 14 panels)
const BIOBOX_SKUS = new Set([
    'B001', 'B002', 'B003', 'B004', 'B005', 'B006', 'B007',
    'B009', 'B010', 'B011', 'B013', 'B014', 'B015', 'B017',
]);

// Hardcoded per business rule: all BioBox orders go through Tri-City Men's Health,
// ordering provider Dr. Whitten NMD.
const BIOBOX_CLINIC_ID = '22937';
const BIOBOX_PROVIDER_NAME = 'Dr. Whitten NMD';
const BIOBOX_PROVIDER_NPI = '1366037806';

interface WooLineItem {
    id: number;
    name: string;
    product_id: number;
    sku: string;
    quantity: number;
    price: number;
    total: string;
}

interface WooWebhookOrder {
    id: number;
    status: string;
    customer_id: number;
    billing: {
        first_name: string;
        last_name: string;
        address_1: string;
        address_2?: string;
        city: string;
        state: string;
        postcode: string;
        country: string;
        email: string;
        phone: string;
    };
    shipping: {
        first_name: string;
        last_name: string;
        address_1: string;
        address_2?: string;
        city: string;
        state: string;
        postcode: string;
    };
    line_items: WooLineItem[];
    meta_data?: Array<{ key: string; value: string }>;
}

function extractHealthieIdFromOrder(order: WooWebhookOrder): string | null {
    // Healthie ID may be stored in customer meta or order meta depending on
    // how WC checkout was configured. Check both common locations.
    const meta = order.meta_data || [];
    const healthieMeta = meta.find(m => m.key === '_healthie_patient_id' || m.key === 'healthie_id');
    if (healthieMeta && healthieMeta.value) return String(healthieMeta.value);
    return null;
}

async function checkEligibility(healthieId: string | null, email: string): Promise<{
    eligible: boolean;
    reason: string;
    tier: string | null;
}> {
    const baseUrl = process.env.DASHBOARD_INTERNAL_URL || 'https://nowoptimal.com';
    const params = new URLSearchParams();
    if (healthieId) params.set('healthieId', healthieId);
    if (email) params.set('email', email);

    try {
        const res = await fetch(`${baseUrl}/ops/api/jarvis/lab-eligibility?${params.toString()}`, {
            headers: {
                'x-jarvis-secret': process.env.JARVIS_SHARED_SECRET || '',
            },
        });
        if (!res.ok) {
            return { eligible: false, reason: 'eligibility_check_failed', tier: null };
        }
        const data = await res.json();
        return {
            eligible: !!data.eligible,
            reason: data.reason || 'unknown',
            tier: data.tier || null,
        };
    } catch (err) {
        console.error('[WooBioBox] Eligibility check failed:', err);
        return { eligible: false, reason: 'eligibility_check_error', tier: null };
    }
}

export async function POST(req: NextRequest) {
    // 1. Validate HMAC signature from WooCommerce
    const rawBody = await req.text();
    const signature = req.headers.get('x-wc-webhook-signature') || '';
    const secret = process.env.WOO_BIOBOX_WEBHOOK_SECRET;

    if (!secret) {
        console.error('[WooBioBox] WOO_BIOBOX_WEBHOOK_SECRET not configured');
        return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(rawBody, 'utf8')
        .digest('base64');

    if (expectedSig !== signature) {
        console.warn('[WooBioBox] Invalid webhook signature');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // 2. Parse order
    let order: WooWebhookOrder;
    try {
        order = JSON.parse(rawBody) as WooWebhookOrder;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // 3. Filter for BioBox line items
    const bioboxItems = (order.line_items || []).filter(li => BIOBOX_SKUS.has(li.sku));
    if (bioboxItems.length === 0) {
        // No BioBox items — ignore (this webhook may fire for all orders)
        return NextResponse.json({ success: true, skipped: true, reason: 'no_biobox_items' });
    }

    console.log(`[WooBioBox] Processing order ${order.id}: ${bioboxItems.length} BioBox item(s)`);

    // 4. Eligibility check
    const healthieId = extractHealthieIdFromOrder(order);
    const eligibility = await checkEligibility(healthieId, order.billing.email);

    // 5. Process each BioBox item
    const results: Array<{ sku: string; order_id?: number; status: string; error?: string }> = [];

    for (const item of bioboxItems) {
        const shipTo = order.shipping.address_1 ? order.shipping : order.billing;
        const patientData = {
            first_name: order.billing.first_name,
            last_name: order.billing.last_name,
            address: shipTo.address_1,
            address_2: shipTo.address_2 || '',
            city: shipTo.city,
            state: shipTo.state,
            zip: shipTo.postcode,
            phone: order.billing.phone,
            email: order.billing.email,
            // DOB/gender must come from Healthie — we don't collect at WC checkout
            dob: null as string | null,
            gender: null as string | null,
        };

        // Enrich with Healthie-sourced DOB + gender if we have healthieId
        if (healthieId) {
            try {
                const client = await getPool().connect();
                try {
                    const { rows } = await client.query(
                        `SELECT dob, gender FROM patients WHERE healthie_client_id = $1 LIMIT 1`,
                        [healthieId]
                    );
                    if (rows.length > 0) {
                        patientData.dob = rows[0].dob || null;
                        patientData.gender = rows[0].gender || null;
                    }
                } finally {
                    client.release();
                }
            } catch (err) {
                console.error('[WooBioBox] Failed to enrich patient data:', err);
            }
        }

        // Determine status based on eligibility
        const isEligible = eligibility.eligible;
        const initialStatus = isEligible ? 'submitted' : 'held_ineligible';

        // Insert lab_orders row
        const client = await getPool().connect();
        let labOrderId: number | null = null;
        try {
            const insertRes = await client.query(
                `INSERT INTO lab_orders (
                    clinic_id, order_type, biobox_kit_sku, woo_order_id,
                    patient_first_name, patient_last_name, patient_dob, patient_gender,
                    patient_address, patient_address_2, patient_city, patient_state, patient_zip,
                    patient_phone, patient_email,
                    ordering_provider, ordering_provider_npi,
                    test_codes, status, approval_required, created_at
                ) VALUES ($1, 'biobox', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, false, NOW())
                RETURNING id`,
                [
                    BIOBOX_CLINIC_ID,
                    item.sku,
                    order.id,
                    patientData.first_name,
                    patientData.last_name,
                    patientData.dob,
                    patientData.gender,
                    patientData.address,
                    patientData.address_2,
                    patientData.city,
                    patientData.state,
                    patientData.zip,
                    patientData.phone,
                    patientData.email,
                    BIOBOX_PROVIDER_NAME,
                    BIOBOX_PROVIDER_NPI,
                    JSON.stringify([item.sku]),
                    initialStatus,
                ]
            );
            labOrderId = insertRes.rows[0].id;
        } catch (err: any) {
            console.error(`[WooBioBox] DB insert failed for order ${order.id}, SKU ${item.sku}:`, err);
            results.push({ sku: item.sku, status: 'failed', error: 'db_insert_failed' });
            client.release();
            continue;
        }
        client.release();

        // If not eligible — stop here, alert staff
        if (!isEligible) {
            console.warn(
                `[WooBioBox] ⚠️ Order ${order.id} held: customer ${order.billing.email} ineligible ` +
                `(${eligibility.reason}). SKU ${item.sku}. Lab order #${labOrderId} marked 'held_ineligible'.`
            );
            results.push({
                sku: item.sku,
                order_id: labOrderId!,
                status: 'held_ineligible',
                error: eligibility.reason,
            });
            continue;
        }

        // Eligible — submit to Access Labs via existing order_lab.py
        try {
            const orderData = {
                clinic_id: BIOBOX_CLINIC_ID,
                external_id: `BIOBOX-${labOrderId}`,
                patient: patientData,
                tests: [item.sku],
                provider: {
                    name: BIOBOX_PROVIDER_NAME,
                    npi: BIOBOX_PROVIDER_NPI,
                },
                notes: `BioBox at-home kit. WC order #${order.id}. Ship kit to patient address.`,
                priority: 'ROUTINE',
            };

            const tempFile = path.join('/tmp', `biobox_order_${labOrderId}.json`);
            await writeFile(tempFile, JSON.stringify(orderData));

            const { stdout } = await execAsync(
                `python3 /home/ec2-user/scripts/labs/order_lab.py --from-json ${tempFile}`,
                { maxBuffer: 10 * 1024 * 1024 }
            );
            await unlink(tempFile).catch(() => { /* best-effort */ });

            let submitResult: any;
            try {
                submitResult = JSON.parse(stdout);
            } catch {
                console.error(`[WooBioBox] Invalid JSON from order_lab.py for lab_order #${labOrderId}:`, stdout);
                throw new Error('order_lab.py returned invalid JSON');
            }

            if (submitResult.success) {
                await getPool().query(
                    `UPDATE lab_orders SET status = 'submitted', submitted_at = NOW(), external_order_id = $1 WHERE id = $2`,
                    [submitResult.external_id || submitResult.order_number || `BIOBOX-${labOrderId}`, labOrderId]
                );
                results.push({ sku: item.sku, order_id: labOrderId!, status: 'submitted' });
            } else {
                await getPool().query(
                    `UPDATE lab_orders SET status = 'failed', submission_error = $1 WHERE id = $2`,
                    [submitResult.error || 'Access Labs submission failed', labOrderId]
                );
                results.push({
                    sku: item.sku,
                    order_id: labOrderId!,
                    status: 'failed',
                    error: submitResult.error,
                });
            }
        } catch (err: any) {
            console.error(`[WooBioBox] Submission error for lab_order #${labOrderId}:`, err);
            await getPool().query(
                `UPDATE lab_orders SET status = 'failed', submission_error = $1 WHERE id = $2`,
                [err.message || String(err), labOrderId]
            );
            results.push({
                sku: item.sku,
                order_id: labOrderId!,
                status: 'failed',
                error: err.message,
            });
        }
    }

    return NextResponse.json({
        success: true,
        woo_order_id: order.id,
        eligibility: eligibility,
        processed: results,
    });
}
