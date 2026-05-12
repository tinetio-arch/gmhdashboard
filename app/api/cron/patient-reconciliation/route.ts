/**
 * GET /api/cron/patient-reconciliation
 *
 * Safety net for SCHEDULED patients only. Scans appointments across our providers
 * over a configurable window (default: past 30 days + next 60 days), extracts every
 * unique patient Healthie ID that appears on an appointment, and upserts any that
 * aren't in our Postgres yet.
 *
 * This is NOT a full-roster sync. It only catches patients who actually have or had
 * an appointment with us — the population that actually matters for day-to-day iPad
 * operations. Full-roster sync would touch 5000+ patients, many of whom never
 * interact with our system; this keeps the footprint small (typically a few hundred
 * unique patient IDs per scan) and the risk surface tiny.
 *
 * Alerts via Telegram when the gap is ≥3 or any upsert actually created a row.
 *
 * Auth: x-cron-secret header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';
import { upsertHealthiePatient } from '@/lib/ipad-patient-resolver';
import { sendMessage } from '@/lib/telegram-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PROVIDERS: string[] = [
    process.env.HEALTHIE_PRIMARY_CARE_PROVIDER_ID || '12088269',
    process.env.HEALTHIE_MENS_HEALTH_PROVIDER_ID || '12093125',
];

function verifyCronSecret(request: NextRequest): boolean {
    const cronSecret = request.headers.get('x-cron-secret');
    return cronSecret === process.env.CRON_SECRET;
}

const ALERT_THRESHOLD = 3;

function dateStr(offsetDays: number): string {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

export async function GET(request: NextRequest) {
    if (!verifyCronSecret(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dryRun = request.nextUrl.searchParams.get('dry_run') === 'true';
    const pastDays = parseInt(request.nextUrl.searchParams.get('past_days') || '30', 10);
    const futureDays = parseInt(request.nextUrl.searchParams.get('future_days') || '60', 10);
    const maxToUpsert = parseInt(request.nextUrl.searchParams.get('max') || '50', 10);
    const startedAt = Date.now();

    try {
        // 1. Pull appointments for each provider over [-pastDays, +futureDays], day by day
        // Healthie's appointments query accepts specificDay — we enumerate the window.
        const days: string[] = [];
        for (let i = -pastDays; i <= futureDays; i++) days.push(dateStr(i));

        const uniquePatientIds = new Set<string>();
        for (const providerId of PROVIDERS) {
            // Batch up to 10 days per GraphQL call using aliases
            for (let i = 0; i < days.length; i += 10) {
                const chunk = days.slice(i, i + 10);
                const aliases = chunk.map((day, idx) =>
                    `d${idx}: appointments(filter:"all", provider_id:"${providerId}", specificDay:"${day}", should_paginate:false){ user{ id } }`
                ).join(' ');
                try {
                    const res = await healthieGraphQL<any>(`{ ${aliases} }`, {});
                    for (let idx = 0; idx < chunk.length; idx++) {
                        const appts = res[`d${idx}`] || [];
                        for (const a of appts) {
                            if (a?.user?.id) uniquePatientIds.add(String(a.user.id));
                        }
                    }
                } catch (e: any) {
                    console.warn(`[patient-reconciliation] Provider ${providerId} batch failed:`, e.message);
                }
                await new Promise(r => setTimeout(r, 150));
            }
        }

        // 2. Pull what we already have
        const linked = await query<{ healthie_client_id: string }>(
            `SELECT DISTINCT healthie_client_id FROM healthie_clients WHERE is_active = true AND healthie_client_id IS NOT NULL
             UNION
             SELECT DISTINCT healthie_client_id FROM patients WHERE healthie_client_id IS NOT NULL`
        );
        const localIds = new Set(linked.map(r => String(r.healthie_client_id)));

        // 3. Diff: scheduled patients we don't have
        const missing = Array.from(uniquePatientIds).filter(id => !localIds.has(id));

        // 4. Upsert missing (capped for safety)
        const toProcess = missing.slice(0, maxToUpsert);
        const counts: Record<string, number> = { created: 0, merged: 0, updated: 0, skipped: 0 };
        const createdSamples: Array<{ healthie_id: string; name: string | null }> = [];

        if (!dryRun) {
            for (const hid of toProcess) {
                const r = await upsertHealthiePatient(hid);
                counts[r.action] = (counts[r.action] || 0) + 1;
                if (r.action === 'created' && createdSamples.length < 10) {
                    createdSamples.push({ healthie_id: hid, name: r.fullName });
                }
                await new Promise(res => setTimeout(res, 150));
            }
        }

        const elapsedMs = Date.now() - startedAt;

        // 5. Alert Telegram only when there's something interesting
        const createdCount = counts.created;
        if (missing.length >= ALERT_THRESHOLD || createdCount > 0) {
            const sampleLines = createdSamples.map(s => `  • ${s.name || '(no name)'} [${s.healthie_id}]`).join('\n');
            const msg =
                `📋 *Scheduled-Patient Reconciliation*\n\n` +
                `Window: past ${pastDays}d / next ${futureDays}d (both providers)\n` +
                `Unique scheduled patients: ${uniquePatientIds.size}\n` +
                `Already in Postgres: ${uniquePatientIds.size - missing.length}\n` +
                `Missing from Postgres: ${missing.length}\n\n` +
                (dryRun ? `_(dry run — nothing inserted)_\n\n` : '') +
                `Processed ${toProcess.length}: ${createdCount} created · ${counts.merged} merged · ${counts.updated} updated · ${counts.skipped} skipped\n` +
                (sampleLines ? `\n*New patients added to our DB:*\n${sampleLines}\n` : '') +
                (missing.length > toProcess.length ? `\n_Remaining ${missing.length - toProcess.length} will be picked up next run (cap=${maxToUpsert})._` : '');
            try { await sendMessage(msg); } catch (e) { /* non-fatal */ }
        }

        return NextResponse.json({
            success: true,
            dry_run: dryRun,
            elapsed_ms: elapsedMs,
            window: { past_days: pastDays, future_days: futureDays },
            scheduled_unique_patients: uniquePatientIds.size,
            missing_from_postgres: missing.length,
            processed: toProcess.length,
            counts,
            created_samples: createdSamples,
            remaining: Math.max(0, missing.length - toProcess.length),
        });
    } catch (e: any) {
        console.error('[patient-reconciliation] Failed:', e);
        return NextResponse.json({ error: e.message || 'Failed' }, { status: 500 });
    }
}
