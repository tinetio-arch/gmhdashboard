import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const WC_URL = process.env.ABXTAC_WC_URL || 'https://abxtac.com';
const WC_KEY = process.env.ABXTAC_CONSUMER_KEY || '';
const WC_SECRET = process.env.ABXTAC_CONSUMER_SECRET || '';

// Peptide-keyword regex matches the existing dashboard CEO query so we count the same set of orders.
const PEPTIDE_KEYWORD_REGEX = /(bpc|tb.?500|cjc|ipamorelin|tesamorelin|semaglutide|tirzepatide|retatrutide|liraglutide|aod|ghk|semax|selank|dsip|mots|wolverine|peptide|blend|glp)/i;

// Stuck thresholds (hours)
const STUCK_NO_WC = 24;        // charged > 24h, no WC order
const STUCK_WC_PROCESSING = 48; // WC processing > 48h, no tracking
const STUCK_NO_TRACKING = 72;   // shipped flag but no tracking_number > 72h
const STUCK_INHOUSE = 72;       // in-house charged, no dispense >72h

interface WcMeta { key: string; value: string }
interface WcOrder {
    id: number;
    number?: string;
    status: string;
    date_modified?: string;
    date_completed?: string | null;
    meta_data?: WcMeta[];
}

function wcAuthHeader(): string {
    return 'Basic ' + Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString('base64');
}

async function fetchWcOrder(orderId: number): Promise<WcOrder | null> {
    if (!WC_KEY || !WC_SECRET) return null;
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(`${WC_URL}/wp-json/wc/v3/orders/${orderId}`, {
            headers: { Authorization: wcAuthHeader() },
            signal: ctrl.signal,
        });
        clearTimeout(t);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

interface WcOrderNote { id: number; note: string; date_created: string; customer_note: boolean }

async function fetchWcOrderNotes(orderId: number): Promise<WcOrderNote[]> {
    if (!WC_KEY || !WC_SECRET) return [];
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(`${WC_URL}/wp-json/wc/v3/orders/${orderId}/notes?per_page=20`, {
            headers: { Authorization: wcAuthHeader() },
            signal: ctrl.signal,
        });
        clearTimeout(t);
        if (!res.ok) return [];
        return await res.json();
    } catch {
        return [];
    }
}

// ShipStation writes tracking back to WC as a customer note in the format:
//   "<product> x N shipped via USPS on April 27, 2026 with tracking number 9405550106151032925551."
// There is no _tracking_number meta on these orders — the note IS the source of truth.
const TRACKING_NOTE_REGEX = /shipped via\s+([A-Za-z][A-Za-z0-9\- ]*?)\s+on\s+(.+?)\s+with tracking number\s+(\S+?)\.?\s*$/i;

function carrierTrackingUrl(carrier: string, num: string): string | null {
    const c = carrier.toUpperCase();
    if (c.includes('USPS')) return `https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=${num}`;
    if (c.includes('UPS')) return `https://www.ups.com/track?tracknum=${num}`;
    if (c.includes('FEDEX')) return `https://www.fedex.com/fedextrack/?trknbr=${num}`;
    return null;
}

async function extractTracking(order: WcOrder): Promise<{ number: string | null; carrier: string | null; url: string | null; shippedAt: string | null }> {
    const meta = order.meta_data || [];
    const get = (k: string) => meta.find(m => m.key === k)?.value || null;
    let number = get('_tracking_number') || get('_wc_shipment_tracking_items') || null;
    let carrier = get('_tracking_carrier') || null;
    let url = get('_tracking_url') || null;
    let shippedAt: string | null = null;

    if (!number) {
        const notes = await fetchWcOrderNotes(order.id);
        for (const n of notes) {
            if (!n.customer_note) continue;
            const m = n.note.match(TRACKING_NOTE_REGEX);
            if (m) {
                carrier = m[1].trim();
                number = m[3];
                shippedAt = n.date_created || null;
                url = carrierTrackingUrl(carrier, number);
                break;
            }
        }
    }
    return { number, carrier, url, shippedAt };
}

// Backfill payment_transactions.woocommerce_order_id for charges that lack the link.
// The iPad ship-order route (and pre-2026-04-22 mobile checkouts) didn't always persist
// the WC order id back to payment_transactions — but every WC order carries _stripe_charge_id
// in its meta. We list recent WC orders and match them by Stripe charge id.
async function backfillWcOrderIds(): Promise<number> {
    if (!WC_KEY || !WC_SECRET) return 0;
    const missing = await query<{ transaction_id: string; stripe_charge_id: string }>(`
        SELECT transaction_id, stripe_charge_id
        FROM payment_transactions
        WHERE created_at >= NOW() - INTERVAL '60 days'
          AND status = 'succeeded'
          AND woocommerce_order_id IS NULL
          AND stripe_charge_id IS NOT NULL
          AND (description ILIKE 'Mobile:%' OR description ILIKE '%ship-to-patient%')
    `);
    if (missing.length === 0) return 0;

    // Page through last 60d of WC orders and build pi → wc_order_id map.
    const pi2order = new Map<string, number>();
    for (let page = 1; page <= 5; page++) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(
            `${WC_URL}/wp-json/wc/v3/orders?per_page=100&page=${page}&after=${new Date(Date.now() - 60 * 86400000).toISOString()}`,
            { headers: { Authorization: wcAuthHeader() }, signal: ctrl.signal }
        ).catch(() => null);
        clearTimeout(t);
        if (!res || !res.ok) break;
        const orders: WcOrder[] = await res.json();
        for (const o of orders) {
            const pi = (o.meta_data || []).find(m => m.key === '_stripe_charge_id')?.value;
            if (pi) pi2order.set(String(pi), o.id);
        }
        if (orders.length < 100) break;
    }

    let updated = 0;
    for (const tx of missing) {
        const wcId = pi2order.get(tx.stripe_charge_id);
        if (!wcId) continue;
        await query(`UPDATE payment_transactions SET woocommerce_order_id = $1 WHERE transaction_id = $2`,
            [wcId, tx.transaction_id]);
        updated++;
    }
    return updated;
}

export async function POST(request: NextRequest) {
    return runSync(request);
}
export async function GET(request: NextRequest) {
    return runSync(request);
}

async function runSync(request: NextRequest) {
    if (request.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const startedAt = Date.now();
    const stats = { scanned: 0, woo_synced: 0, inhouse_synced: 0, stuck: 0, errors: 0, backfilled: 0 };

    // 0. Backfill missing payment_transactions.woocommerce_order_id by matching
    //    the WC order's _stripe_charge_id meta against our stripe_charge_id.
    try {
        stats.backfilled = await backfillWcOrderIds();
    } catch (err) {
        console.error('[peptide-pipeline-sync] backfill error:', err);
    }

    // 1. Pull last-30d peptide-related payment_transactions (both channels).
    //    Mobile orders carry "Mobile:" prefix; iPad ship-orders contain "ship-to-patient";
    //    everything else matching the peptide regex is treated as in-house.
    const txns = await query<any>(`
        SELECT pt.transaction_id, pt.patient_id, pt.amount, pt.description, pt.status,
               pt.stripe_charge_id, pt.created_at, pt.woocommerce_order_id,
               EXTRACT(EPOCH FROM (NOW() - pt.created_at))/3600 AS age_hours
        FROM payment_transactions pt
        WHERE pt.created_at >= NOW() - INTERVAL '30 days'
          AND pt.status = 'succeeded'
          AND (
              pt.description ILIKE 'Mobile:%'
              OR pt.description ILIKE '%ship-to-patient%'
              OR pt.description ~* $1
          )
    `, [PEPTIDE_KEYWORD_REGEX.source]);

    stats.scanned = txns.length;

    for (const tx of txns) {
        try {
            const ageHours = Math.floor(Number(tx.age_hours) || 0);
            const desc = String(tx.description || '');
            const isWcChannel = !!tx.woocommerce_order_id || /^Mobile:/i.test(desc) || /ship-to-patient/i.test(desc);
            const channel = isWcChannel ? 'woo' : 'inhouse';

            let stage = 'charged';
            let wcOrderNumber: string | null = null;
            let wcStatus: string | null = null;
            let trackingNumber: string | null = null;
            let trackingCarrier: string | null = null;
            let trackingUrl: string | null = null;
            let shippedAt: string | null = null;
            let deliveredAt: string | null = null;
            let dispenseIds: string[] = [];
            let educationComplete: boolean | null = null;
            let receivedDate: string | null = null;
            let stuckReason: string | null = null;

            if (channel === 'woo') {
                if (!tx.woocommerce_order_id) {
                    // Mobile/ship Stripe charge with NO WC order — silent failure case (Toms 4/22).
                    stage = ageHours >= STUCK_NO_WC ? 'stuck' : 'charged';
                    if (stage === 'stuck') stuckReason = 'no_wc_order_24h';
                } else {
                    const wc = await fetchWcOrder(tx.woocommerce_order_id);
                    if (wc) {
                        wcOrderNumber = wc.number ? String(wc.number) : String(wc.id);
                        wcStatus = wc.status;
                        const t = await extractTracking(wc);
                        trackingNumber = t.number;
                        trackingCarrier = t.carrier;
                        trackingUrl = t.url;

                        if (wc.status === 'completed' || trackingNumber) {
                            stage = 'wc_shipped';
                            shippedAt = t.shippedAt || wc.date_modified || null;
                            if (wc.date_completed) deliveredAt = wc.date_completed;
                        } else if (wc.status === 'processing') {
                            stage = 'wc_pending';
                            if (ageHours >= STUCK_WC_PROCESSING) {
                                stage = 'stuck';
                                stuckReason = 'wc_processing_48h';
                            }
                        } else if (wc.status === 'cancelled' || wc.status === 'refunded' || wc.status === 'failed') {
                            stage = 'refunded';
                        } else {
                            stage = 'wc_pending';
                        }

                        if (stage === 'wc_shipped' && !trackingNumber && ageHours >= STUCK_NO_TRACKING) {
                            stage = 'stuck';
                            stuckReason = 'no_tracking_72h';
                        }
                    } else {
                        // WC unreachable — keep prior row, just bump synced timestamp.
                        stage = 'wc_pending';
                    }
                }
                stats.woo_synced++;
            } else {
                // In-house: join peptide_dispenses by stripe_payment_intent_id.
                const dispenses = await query<any>(`
                    SELECT sale_id, product_id, status, education_complete, received_date
                    FROM peptide_dispenses
                    WHERE stripe_payment_intent_id = $1
                `, [tx.stripe_charge_id]).catch(() => [] as any[]);

                if (Array.isArray(dispenses) && dispenses.length > 0) {
                    dispenseIds = dispenses.map((d: any) => d.sale_id).filter(Boolean);
                    educationComplete = dispenses.every((d: any) => d.education_complete === true);
                    const allPickedUp = dispenses.every((d: any) => d.received_date != null);
                    if (allPickedUp) {
                        stage = 'picked_up';
                        receivedDate = dispenses[0]?.received_date || null;
                    } else if (educationComplete && dispenses.every((d: any) => d.status === 'Paid')) {
                        stage = 'dispensed';
                    } else {
                        stage = 'inhouse_pending';
                    }
                } else {
                    stage = 'inhouse_pending';
                    if (ageHours >= STUCK_INHOUSE) {
                        stage = 'stuck';
                        stuckReason = 'no_dispense_3d';
                    }
                }
                stats.inhouse_synced++;
            }

            if (stage === 'stuck') stats.stuck++;

            await query(`
                INSERT INTO peptide_order_tracking
                  (payment_id, patient_id, channel, stage,
                   wc_order_id, wc_order_number, wc_status,
                   tracking_number, tracking_carrier, tracking_url,
                   shipped_at, delivered_at,
                   dispense_ids, education_complete, received_date,
                   stuck_reason, age_hours, last_synced_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, NOW())
                ON CONFLICT (payment_id) DO UPDATE SET
                  channel = EXCLUDED.channel,
                  stage = EXCLUDED.stage,
                  wc_order_id = EXCLUDED.wc_order_id,
                  wc_order_number = EXCLUDED.wc_order_number,
                  wc_status = EXCLUDED.wc_status,
                  tracking_number = EXCLUDED.tracking_number,
                  tracking_carrier = EXCLUDED.tracking_carrier,
                  tracking_url = EXCLUDED.tracking_url,
                  shipped_at = EXCLUDED.shipped_at,
                  delivered_at = EXCLUDED.delivered_at,
                  dispense_ids = EXCLUDED.dispense_ids,
                  education_complete = EXCLUDED.education_complete,
                  received_date = EXCLUDED.received_date,
                  stuck_reason = EXCLUDED.stuck_reason,
                  age_hours = EXCLUDED.age_hours,
                  last_synced_at = NOW()
            `, [
                tx.transaction_id, tx.patient_id, channel, stage,
                tx.woocommerce_order_id || null, wcOrderNumber, wcStatus,
                trackingNumber, trackingCarrier, trackingUrl,
                shippedAt, deliveredAt,
                dispenseIds.length ? dispenseIds : null, educationComplete, receivedDate,
                stuckReason, ageHours,
            ]);
        } catch (err) {
            stats.errors++;
            console.error('[peptide-pipeline-sync] tx error:', tx.transaction_id, err);
        }
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(`[peptide-pipeline-sync] done in ${elapsedMs}ms`, stats);
    return NextResponse.json({ success: true, elapsedMs, ...stats });
}
