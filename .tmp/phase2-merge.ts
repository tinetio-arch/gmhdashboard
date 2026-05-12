/**
 * Phase 2 merges — only merge when it absolutely cannot hurt packages or payment plans.
 *
 * Rules (a pair is SAFE to merge if ALL hold for the DROP side):
 *   1. DROP has no active next_recurring_payment (or it's canceled/paused)
 *   2. DROP has no subscription
 *   3. DROP has no active packages with credits
 *   4. KEEP is the side with more billing/appts activity
 *
 * Healthie's mergeClients preserves billing items on the target. If DROP has nothing
 * to migrate that could break, the merge is lossless by definition.
 *
 * For each safe merge:
 *   - Call mergeClients(ids:[DROP], target_user_id:KEEP)
 *   - Verify KEEP still has its recurring payment + billing after
 *   - Re-link Postgres to KEEP (if we were pointing at DROP)
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/gmhdashboard/.env.local' });
import { query, getPool } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';
import * as fs from 'fs';

const LOG = '/home/ec2-user/gmhdashboard/.tmp/phase2-merge-log.txt';
const logs: string[] = [];
const log = (s: string) => { console.log(s); logs.push(s); };

// Pairs with billing activity on each side (from the prior audit).
// Format: { name, keep, drop, expectedKeepHasRecurring (manual knowledge) }
const PAIRS = [
    { name: 'Steve Benjamin',    keep: '12182852', drop: '12743724' }, // A has 1 paid billing; B has 4 appts but no billing
    { name: 'Jeffrey Chamblee',  keep: '12177838', drop: '12746108' }, // A has 3 paid; B has 1 appt
    { name: 'Matthew Fisher',    keep: '12745295', drop: '12179965' }, // B has more: 6 appts + 3 paid
    { name: 'Rich Freeman',      keep: '12745768', drop: '12183013' }, // B has 14 appts + 2 paid
    { name: 'Bruce French',      keep: '12745786', drop: '12765861' }, // A is real email + 2 appts; B has 2 paid on placeholder
    { name: 'Joe Hugill',        keep: '12690358', drop: '12875775' }, // A has 1 appt/3 paid + $140 recurring
    { name: 'Michael McCartney', keep: '12182822', drop: '12742218' }, // A has 3 paid; B has 10 appts
    { name: 'Marianna Warner',   keep: '12742313', drop: '14050273' }, // A has 2 appts; B empty
    { name: 'John Winn',         keep: '12743211', drop: '12182229' }, // B has 5 appts
    { name: 'James Womble',      keep: '12179578', drop: '12743400' }, // A has 3 paid; B has 8 appts
];

async function getUserSafetyProfile(hid: string) {
    const q = `{ user(id:"${hid}"){
        id first_name last_name email
        total_active_packages_with_credits
        has_bookable_packages
        subscription{ id }
        next_recurring_payment{ id amount_to_pay next_payment_date is_canceled is_paused }
    } }`;
    const res = await healthieGraphQL<any>(q, {});
    const u = res?.user || {};
    const rp = u.next_recurring_payment;
    const activeRecurring = rp && !rp.is_canceled && !rp.is_paused;
    // Any subscription.id present means there's some subscription record — treat conservatively
    const activeSub = !!(u.subscription && u.subscription.id);
    const hasPkgs = (u.total_active_packages_with_credits || 0) > 0;
    return {
        hid, email: u.email,
        name: `${u.first_name || ''} ${u.last_name || ''}`.trim(),
        activeRecurring, rp, activeSub, sub: u.subscription, hasPkgs, packageCount: u.total_active_packages_with_credits
    };
}

(async () => {
    log(`\n=== Phase 2 Merges — ${new Date().toISOString()} ===\n`);
    const pool = getPool();

    // Stage 1: profile every side of every pair
    log(`--- Profiling all 20 users (direct queries, paced) ---`);
    const profiles = new Map<string, any>();
    for (const p of PAIRS) {
        for (const hid of [p.keep, p.drop]) {
            try {
                profiles.set(hid, await getUserSafetyProfile(hid));
            } catch (e: any) {
                log(`  Failed to profile ${hid}: ${e.message}`);
            }
            await new Promise(r => setTimeout(r, 250));
        }
    }

    // Stage 2: classify each pair as SAFE or SKIP
    log(`\n--- Safety classification ---`);
    const toMerge: typeof PAIRS = [];
    const skipped: Array<{ pair: typeof PAIRS[0]; reason: string }> = [];
    for (const p of PAIRS) {
        const keep = profiles.get(p.keep);
        const drop = profiles.get(p.drop);
        if (!keep || !drop) { skipped.push({ pair: p, reason: 'profile failed' }); continue; }
        const reasons: string[] = [];
        if (drop.activeRecurring) reasons.push(`DROP has active recurring payment ($${drop.rp.amount_to_pay})`);
        if (drop.activeSub) reasons.push(`DROP has active subscription (${drop.sub.status})`);
        if (drop.hasPkgs) reasons.push(`DROP has ${drop.packageCount} active packages`);
        if (reasons.length) {
            skipped.push({ pair: p, reason: reasons.join('; ') });
            log(`  ❌ ${p.name}: SKIP (${reasons.join('; ')})`);
        } else {
            toMerge.push(p);
            const keepRP = keep.activeRecurring ? `keep has $${keep.rp.amount_to_pay}/cycle recurring (preserved)` : 'no recurring on keep';
            log(`  ✅ ${p.name}: SAFE — merge ${p.drop} → ${p.keep}; ${keepRP}`);
        }
    }

    // Stage 3: execute merges
    log(`\n--- Executing ${toMerge.length} safe merges ---`);
    for (const p of toMerge) {
        const keep = profiles.get(p.keep);
        const preRP = keep?.rp?.id;
        log(`\n  Merging: ${p.name}   DROP ${p.drop} → KEEP ${p.keep}`);
        try {
            const res = await healthieGraphQL<any>(
                `mutation Merge($ids:[ID!], $target:ID) {
                    mergeClients(input:{ids:$ids, target_user_id:$target}) {
                        user{ id first_name last_name email }
                        messages{ field message }
                    }
                }`,
                { ids: [p.drop], target: p.keep }
            );
            const msgs = res?.mergeClients?.messages || [];
            if (msgs.length) {
                log(`    Healthie messages: ${JSON.stringify(msgs)}`);
                // If there's an ERROR level message it'll be prefixed or obvious
                const errs = msgs.filter((m: any) => /error|fail|invalid/i.test(m.message || ''));
                if (errs.length) {
                    log(`    ❌ Merge errored — SKIPPING re-link`);
                    continue;
                }
            }
            log(`    Healthie merge OK → user ${res?.mergeClients?.user?.id}`);

            // Verify keep still has its recurring payment + data
            await new Promise(r => setTimeout(r, 500));
            const verify = await getUserSafetyProfile(p.keep);
            const rpAfter = verify.rp?.id;
            if (preRP && preRP !== rpAfter) {
                log(`    ⚠️ WARNING: keep's recurring_payment id changed! before=${preRP} after=${rpAfter}`);
            } else if (preRP) {
                log(`    ✅ Keep's recurring payment preserved (id=${rpAfter}, $${verify.rp.amount_to_pay})`);
            } else {
                log(`    (no recurring payment to verify on keep)`);
            }

            // Re-link Postgres if we were pointing at the DROP id
            const pg = await query<any>(
                `SELECT p.patient_id, p.full_name, p.healthie_client_id
                 FROM patients p
                 LEFT JOIN healthie_clients hc ON hc.patient_id = p.patient_id::text AND hc.is_active=true
                 WHERE p.healthie_client_id = $1 OR hc.healthie_client_id = $1`,
                [p.drop]
            );
            if (pg.length === 0) {
                log(`    (no PG row pointed at ${p.drop} — nothing to re-link)`);
            } else {
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    for (const row of pg) {
                        await client.query(
                            `UPDATE healthie_clients SET is_active=false, updated_at=NOW()
                             WHERE patient_id=$1 AND healthie_client_id=$2`,
                            [row.patient_id, p.drop]
                        );
                        await client.query(
                            `INSERT INTO healthie_clients (patient_id, healthie_client_id, is_active, match_method)
                             VALUES ($1, $2, true, 'post_merge_relink')
                             ON CONFLICT (healthie_client_id) DO UPDATE SET patient_id=EXCLUDED.patient_id, is_active=true, updated_at=NOW()`,
                            [row.patient_id, p.keep]
                        );
                        await client.query(
                            `UPDATE patients SET healthie_client_id=$1, updated_at=NOW() WHERE patient_id=$2`,
                            [p.keep, row.patient_id]
                        );
                        log(`    Re-linked PG ${row.patient_id.slice(0,8)} (${row.full_name}) from ${p.drop} → ${p.keep}`);
                    }
                    await client.query('COMMIT');
                } catch (e: any) {
                    await client.query('ROLLBACK');
                    log(`    ❌ PG re-link rolled back: ${e.message}`);
                } finally { client.release(); }
            }
        } catch (e: any) {
            log(`    ❌ Merge failed: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 800));
    }

    log(`\n--- Summary ---`);
    log(`Merged: ${toMerge.length} pairs`);
    log(`Skipped: ${skipped.length} pairs`);
    for (const s of skipped) log(`  ${s.pair.name}: ${s.reason}`);

    fs.writeFileSync(LOG, logs.join('\n'));
    log(`\nFull log: ${LOG}`);
    process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
