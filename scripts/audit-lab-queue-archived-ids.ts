#!/usr/bin/env npx tsx
/**
 * Audit Lab Review Queue for Archived Healthie IDs
 *
 * Scans pending lab_review_queue rows and verifies each row's healthie_id
 * is still active in Healthie. Flags rows whose healthie_id is archived
 * (the same pattern that broke approval for Antrim/Freemyer/Schafer on 2026-05-12).
 *
 * On stuck rows: prints a report and sends a Telegram alert.
 *
 * Usage:
 *   npx tsx scripts/audit-lab-queue-archived-ids.ts            # report-only
 *   npx tsx scripts/audit-lab-queue-archived-ids.ts --quiet    # silent if all clean
 *
 * Cron (suggested, runs at 6:15am MST alongside other dailies):
 *   15 13 * * * /home/ec2-user/scripts/cron-alert.sh "Lab Queue Archived-ID Audit" \
 *     "cd /home/ec2-user/gmhdashboard && npx tsx scripts/audit-lab-queue-archived-ids.ts --quiet"
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
// Load env before any module that reads process.env at import time
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: '/home/ec2-user/.env' });

import { query } from '../lib/db';

const HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql';

async function sendTelegram(text: string): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
        console.error('[Audit] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — skipping alert.');
        return;
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
        console.error('[Audit] Telegram send failed:', res.status, await res.text());
    }
}

interface QueueRow {
    id: string;
    patient_name: string;
    healthie_id: string;
    created_at: string;
}

interface HealthieUser {
    id: string;
    first_name: string;
    last_name: string;
    active: boolean;
    archived_at: string | null;
}

interface StuckRow extends QueueRow {
    healthie_first_name: string;
    healthie_last_name: string;
    healthie_archived_at: string | null;
    active_dup_id?: string;
}

async function fetchHealthieUser(id: string): Promise<HealthieUser | null> {
    const apiKey = process.env.HEALTHIE_API_KEY;
    if (!apiKey) throw new Error('HEALTHIE_API_KEY not configured');

    const res = await fetch(HEALTHIE_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${apiKey}`,
            'AuthorizationSource': 'API',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            query: `query { user(id: "${id}") { id first_name last_name active archived_at } }`,
        }),
    });
    const data = await res.json();
    return data?.data?.user || null;
}

async function findActiveDuplicate(name: string): Promise<string | null> {
    const apiKey = process.env.HEALTHIE_API_KEY;
    if (!apiKey) return null;

    const searchName = name.includes(',')
        ? name.split(',').reverse().join(' ').trim()
        : name;

    const res = await fetch(HEALTHIE_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${apiKey}`,
            'AuthorizationSource': 'API',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            query: `query { users(keywords: "${searchName.replace(/"/g, '\\"')}") { id first_name last_name active archived_at } }`,
        }),
    });
    const data = await res.json();
    const users: HealthieUser[] = data?.data?.users || [];
    const active = users.find(u => u.active === true && !u.archived_at);
    return active?.id || null;
}

async function main() {
    const quiet = process.argv.includes('--quiet');

    const rows = await query<QueueRow>(
        `SELECT id, patient_name, healthie_id::text, created_at::text
         FROM lab_review_queue
         WHERE status = 'pending_review'
           AND healthie_id IS NOT NULL
         ORDER BY created_at DESC`
    );

    if (!quiet) console.log(`Auditing ${rows.length} pending lab queue rows...`);

    const stuck: StuckRow[] = [];

    // De-dupe by healthie_id to minimize API calls
    const uniqueIds = Array.from(new Set(rows.map(r => r.healthie_id)));
    const userById: Record<string, HealthieUser | null> = {};
    for (const id of uniqueIds) {
        try {
            userById[id] = await fetchHealthieUser(id);
        } catch (e) {
            console.error(`[Audit] Failed to fetch Healthie user ${id}:`, e);
            userById[id] = null;
        }
    }

    for (const row of rows) {
        const user = userById[row.healthie_id];
        if (!user) continue; // can't verify, skip (avoid false alerts)
        if (user.active === false || user.archived_at) {
            const activeDup = await findActiveDuplicate(row.patient_name);
            stuck.push({
                ...row,
                healthie_first_name: user.first_name,
                healthie_last_name: user.last_name,
                healthie_archived_at: user.archived_at,
                active_dup_id: activeDup || undefined,
            });
        }
    }

    if (stuck.length === 0) {
        if (!quiet) console.log('✅ All pending lab queue rows point at active Healthie patients.');
        process.exit(0);
    }

    const lines = stuck.map(s =>
        `• ${s.patient_name} — queue ${s.id.slice(0, 8)} → archived Healthie ${s.healthie_id}` +
        (s.active_dup_id ? ` (active dup: ${s.active_dup_id})` : ' (no active dup found)')
    );

    const summary =
        `🚨 Lab queue: ${stuck.length} pending row(s) point at archived Healthie patients.\n\n` +
        lines.join('\n') +
        `\n\nTo fix: UPDATE lab_review_queue SET healthie_id=<active_dup>, healthie_document_id=NULL, upload_status='pending' WHERE id=...`;

    console.error(summary);
    await sendTelegram(summary);

    // Exit 0: script handled its own alerting. cron-alert.sh's failure path
    // is reserved for true errors (DB down, Healthie API down, crash).
    process.exit(0);
}

main().catch(err => {
    console.error('[Audit] Fatal error:', err);
    process.exit(1);
});
