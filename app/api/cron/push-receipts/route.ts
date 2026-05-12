/**
 * Push Receipt Poller
 *
 * Expo returns a ticket id synchronously but delivery status only after ~15 min.
 * This cron pulls unresolved tickets from push_send_log, asks Expo for receipts,
 * and flips patient_push_tokens.active = FALSE on DeviceNotRegistered.
 *
 * Run every 15 min.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const EXPO_RECEIPT_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const BATCH_SIZE = 300;

interface PendingRow {
    id: number;
    ticket_id: string;
    expo_token: string;
}

interface ReceiptOk { status: 'ok'; }
interface ReceiptError {
    status: 'error';
    message?: string;
    details?: { error?: string };
}
type Receipt = ReceiptOk | ReceiptError;

export async function GET(request: NextRequest) {
    const cronSecret = request.headers.get('x-cron-secret');
    if (cronSecret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const started = Date.now();
    let checked = 0;
    let ok = 0;
    let errored = 0;
    let unregistered = 0;

    try {
        // Only poll tickets older than 15 min and younger than 24h (Expo retains ~24h).
        const pending = await query<PendingRow>(
            `SELECT id, ticket_id, expo_token
             FROM push_send_log
             WHERE ticket_id IS NOT NULL
               AND receipt_status IS NULL
               AND sent_at < NOW() - INTERVAL '15 minutes'
               AND sent_at > NOW() - INTERVAL '24 hours'
             ORDER BY sent_at ASC
             LIMIT 5000`
        );

        if (pending.length === 0) {
            return NextResponse.json({ success: true, checked: 0, duration_ms: Date.now() - started });
        }

        for (let i = 0; i < pending.length; i += BATCH_SIZE) {
            const batch = pending.slice(i, i + BATCH_SIZE);
            const ids = batch.map(r => r.ticket_id);

            let receipts: Record<string, Receipt> = {};
            try {
                const res = await fetch(EXPO_RECEIPT_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept-encoding': 'gzip, deflate' },
                    body: JSON.stringify({ ids }),
                });
                const json = await res.json();
                receipts = (json?.data as Record<string, Receipt>) || {};
            } catch (err) {
                console.error('[push-receipts] Batch fetch failed:', err);
                continue;
            }

            for (const row of batch) {
                const r = receipts[row.ticket_id];
                if (!r) continue; // Expo hasn't produced a receipt yet
                checked++;

                if (r.status === 'ok') {
                    ok++;
                    await query(
                        `UPDATE push_send_log
                         SET receipt_status = 'ok', receipt_checked_at = NOW()
                         WHERE id = $1`,
                        [row.id]
                    );
                } else {
                    errored++;
                    const errCode = r.details?.error || '';
                    const errMsg = r.message || errCode || 'unknown';
                    await query(
                        `UPDATE push_send_log
                         SET receipt_status = 'error', receipt_error = $2, receipt_checked_at = NOW()
                         WHERE id = $1`,
                        [row.id, errMsg]
                    );
                    if (errCode === 'DeviceNotRegistered') {
                        unregistered++;
                        await query(
                            `UPDATE patient_push_tokens SET active = FALSE, updated_at = NOW() WHERE expo_token = $1`,
                            [row.expo_token]
                        );
                    }
                }
            }
        }

        return NextResponse.json({
            success: true,
            duration_ms: Date.now() - started,
            checked,
            ok,
            errored,
            device_not_registered: unregistered,
        });
    } catch (error) {
        console.error('[push-receipts] Fatal:', error);
        return NextResponse.json(
            { error: 'Cron failed', details: String(error) },
            { status: 500 }
        );
    }
}
