#!/usr/bin/env node
/**
 * poll-usps-tracking.js — USPS delivery-status fallback for the `woo` peptide channel.
 *
 * WHY: The ShipStation webhook (app/api/webhooks/shipstation/route.ts) is the
 * primary real delivery signal. This poller is the belt-and-suspenders fallback
 * for orders where the webhook never fired (relay down, mis-config, ShipStation
 * native webhook can't be signed, etc.). It is the same job the pipeline cron
 * deliberately does NOT do — that cron leaves delivered_at NULL "until a real
 * delivery source exists" (see app/api/cron/peptide-pipeline-sync/route.ts
 * ~line 238). This script + the webhook ARE that source.
 *
 * WHAT IT DOES:
 *   1. SELECT woo orders that are shipped, have a USPS tracking number, and are
 *      NOT yet delivered (delivered_at IS NULL) within a recent window.
 *   2. For each, call the USPS Web Tools TrackV2 API (USERID = USPS_API_USER).
 *   3. If USPS reports delivered, UPDATE peptide_order_tracking SET delivered_at
 *      (= the carrier delivery timestamp when parseable, else now), stage =
 *      'wc_delivered'. Dedup by only touching delivered_at IS NULL rows.
 *
 * IDEMPOTENT: re-running never re-delivers an already-delivered order, and never
 * fabricates a delivery for an order USPS hasn't reported delivered.
 *
 * TARGET TABLE: peptide_order_tracking (NOT peptide_dispenses — woo orders have
 * no peptide_dispenses row; see SOT module 30 and the webhook header note).
 *
 * ── CRON-STOMP HAZARD ────────────────────────────────────────────────────────
 * peptide-pipeline-sync UPSERTs delivered_at = EXCLUDED.delivered_at (NULL) every
 * 15 min. The companion COALESCE fix staged in that route preserves writes from
 * this poller and the webhook. Without it, this poller's writes are erased
 * within 15 min. DO NOT enable the hourly cron until that fix ships.
 *
 * CRON CANDIDATE (do NOT install until Phil approves — see morning report):
 *   # USPS delivery poll — hourly fallback for woo peptide orders
 *   0 * * * * /home/ec2-user/scripts/cron-alert.sh "USPS Tracking Poll" \
 *     "cd /home/ec2-user/gmhdashboard && node scripts/poll-usps-tracking.js >> /home/ec2-user/logs/usps-poll.log 2>&1"
 *
 * ENV (loaded from .env.production like the other scripts/*.js):
 *   DATABASE_HOST / DATABASE_USER / DATABASE_PASSWORD / DATABASE_NAME
 *   USPS_API_USER  — USPS Web Tools registered USERID (NOT a password; Web Tools
 *                    auth is the USERID alone over HTTPS).
 *
 * USAGE:
 *   node scripts/poll-usps-tracking.js            # live (writes delivered_at)
 *   node scripts/poll-usps-tracking.js --dry-run  # report only, no DB writes
 *   LOOKBACK_DAYS=45 node scripts/poll-usps-tracking.js
 */

const { Pool } = require('pg');
const https = require('https');
require('dotenv').config({ path: '.env.production' });

const DRY_RUN = process.argv.includes('--dry-run');
const LOOKBACK_DAYS = parseInt(process.env.LOOKBACK_DAYS || '30', 10);
const USPS_USERID = process.env.USPS_API_USER;
const USPS_HOST = 'secure.shippingapis.com';

const pool = new Pool({
    host: process.env.DATABASE_HOST,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    port: 5432,
    ssl: { rejectUnauthorized: false },
});

function xmlEscape(s) {
    return String(s).replace(/[<>&'"]/g, (c) => (
        { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]
    ));
}

/**
 * Call USPS Web Tools TrackV2. Returns the raw XML string.
 * Web Tools auth = the USERID alone in the query string over HTTPS.
 */
function uspsTrackRequest(trackingNumber) {
    const xml =
        `<TrackFieldRequest USERID="${xmlEscape(USPS_USERID)}">` +
        `<Revision>1</Revision>` +
        `<ClientIp>127.0.0.1</ClientIp>` +
        `<SourceId>GMH</SourceId>` +
        `<TrackID ID="${xmlEscape(trackingNumber)}"></TrackID>` +
        `</TrackFieldRequest>`;
    const path = `/ShippingAPI.dll?API=TrackV2&XML=${encodeURIComponent(xml)}`;

    return new Promise((resolve, reject) => {
        const reqId = setTimeout(() => reject(new Error('USPS request timeout')), 10000);
        https.get({ host: USPS_HOST, path, headers: { Accept: 'application/xml' } }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => { clearTimeout(reqId); resolve(data); });
        }).on('error', (err) => { clearTimeout(reqId); reject(err); });
    });
}

/**
 * Parse the TrackV2 XML for a delivery signal. Returns
 *   { delivered: boolean, deliveredAt: Date|null, summary: string|null, error: string|null }
 * Kept regex-based (no XML dep) to match the lightweight scripts/*.js convention.
 */
function parseUspsTracking(xml) {
    if (!xml) return { delivered: false, deliveredAt: null, summary: null, error: 'empty_response' };

    const errMatch = xml.match(/<Error>[\s\S]*?<Description>([\s\S]*?)<\/Description>/i);
    if (errMatch) return { delivered: false, deliveredAt: null, summary: null, error: errMatch[1].trim() };

    const statusMatch = xml.match(/<Status>([\s\S]*?)<\/Status>/i);
    const status = statusMatch ? statusMatch[1].trim() : '';
    const summaryMatch = xml.match(/<StatusSummary>([\s\S]*?)<\/StatusSummary>/i);
    const summary = summaryMatch ? summaryMatch[1].trim() : status;

    // USPS reports delivered via <Status>Delivered</Status> (and category in newer
    // responses). Be conservative: require the word "Delivered" in the status.
    const delivered = /delivered/i.test(status);

    let deliveredAt = null;
    if (delivered) {
        // First (most recent) TrackSummary / TrackDetail carries EventDate + EventTime.
        const evDate = (xml.match(/<EventDate>([\s\S]*?)<\/EventDate>/i) || [])[1];
        const evTime = (xml.match(/<EventTime>([\s\S]*?)<\/EventTime>/i) || [])[1];
        if (evDate) {
            const parsed = new Date(`${evDate} ${evTime || '00:00'}`.trim());
            if (!isNaN(parsed.getTime())) deliveredAt = parsed;
        }
    }
    return { delivered, deliveredAt, summary, error: null };
}

async function main() {
    if (!USPS_USERID) {
        console.error('[usps-poll] USPS_API_USER not set — cannot poll. Exiting.');
        process.exit(1);
    }

    const client = await pool.connect();
    const stats = { scanned: 0, delivered: 0, pending: 0, errors: 0, skipped_non_usps: 0 };
    try {
        const { rows } = await client.query(
            `SELECT tracking_id, payment_id, tracking_number, tracking_carrier, shipped_at
               FROM peptide_order_tracking
              WHERE channel = 'woo'
                AND delivered_at IS NULL
                AND tracking_number IS NOT NULL
                AND tracking_number <> ''
                AND COALESCE(shipped_at, created_at) >= NOW() - INTERVAL '${LOOKBACK_DAYS} days'`
        );
        stats.scanned = rows.length;
        console.log(`[usps-poll] ${DRY_RUN ? '[DRY-RUN] ' : ''}scanning ${rows.length} undelivered woo order(s)`);

        for (const row of rows) {
            const carrier = (row.tracking_carrier || '').toUpperCase();
            // Only poll USPS here. UPS has lib/ups.ts trackShipment(); FedEx is out of scope.
            if (carrier && !carrier.includes('USPS')) {
                stats.skipped_non_usps++;
                continue;
            }
            try {
                const xml = await uspsTrackRequest(row.tracking_number);
                const result = parseUspsTracking(xml);
                if (result.error) {
                    stats.errors++;
                    console.warn(`[usps-poll] ${row.tracking_number}: USPS error: ${result.error}`);
                    continue;
                }
                if (!result.delivered) {
                    stats.pending++;
                    continue;
                }

                const deliveredAt = result.deliveredAt || new Date();
                if (DRY_RUN) {
                    stats.delivered++;
                    console.log(`[usps-poll] [DRY-RUN] would mark delivered: ${row.tracking_number} @ ${deliveredAt.toISOString()} (${result.summary})`);
                    continue;
                }

                // Dedup: only flip rows still NULL (another process may have won the race).
                const upd = await client.query(
                    `UPDATE peptide_order_tracking
                        SET delivered_at = $1, stage = 'wc_delivered', updated_at = NOW()
                      WHERE tracking_id = $2 AND delivered_at IS NULL`,
                    [deliveredAt.toISOString(), row.tracking_id]
                );
                if (upd.rowCount > 0) {
                    stats.delivered++;
                    console.log(`[usps-poll] marked delivered: ${row.tracking_number} @ ${deliveredAt.toISOString()}`);
                }
            } catch (err) {
                stats.errors++;
                console.error(`[usps-poll] ${row.tracking_number}: ${err.message}`);
            }
            // Gentle pacing — USPS Web Tools rate-limits aggressive callers.
            await new Promise((r) => setTimeout(r, 250));
        }
    } finally {
        client.release();
        await pool.end();
    }

    console.log(`[usps-poll] done: ${JSON.stringify(stats)}`);
}

main().catch((err) => {
    console.error('[usps-poll] fatal:', err);
    process.exit(1);
});
