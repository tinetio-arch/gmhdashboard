/**
 * One-off remediation: retire vials that were left stranded below the 2.0 mL
 * retirement threshold because the staged-dose prefill workflow did not surface
 * the retire-vial prompt (fixed in same branch).
 *
 * Behavior:
 *   - SELECT FOR UPDATE every Active vial with 0 < remaining_volume_ml < 2.0
 *   - Call retireVial() for each — same code path as the user-triggered
 *     prompt, so every retirement writes:
 *       • dispenses row (transaction_type = 'waste_retirement')
 *       • dea_transactions row (for controlled-substance vials)
 *       • dispense_history row (event_type = 'vial_retired')
 *     The audit trail labels the actor as admin@nowoptimal.com (Phil) with a
 *     payload reason that names this backfill so the dispense_history event_payload
 *     remains attributable on later review.
 *
 * Usage:
 *   npx ts-node scripts/backfill-retire-stuck-vials.ts           # dry-run (default)
 *   npx ts-node scripts/backfill-retire-stuck-vials.ts --apply   # actually retire
 *
 * Idempotent: a second run finds 0 stuck vials and exits cleanly.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '/home/ec2-user/gmhdashboard/.env.local' });

import { query } from '../lib/db';
import { retireVial } from '../lib/inventoryQueries';
import { RETIREMENT_THRESHOLD_ML } from '../lib/testosterone';

const BACKFILL_ACTOR_EMAIL = 'admin@nowoptimal.com';
const BACKFILL_REASON =
    'Backfill — vial stranded below retirement threshold by staged-dose prefill ' +
    'workflow (see branch claude/claude2/retired-vials-not-working-investigate-op).';

async function main() {
    const apply = process.argv.includes('--apply');

    const actor = await query<{ user_id: string; display_name: string | null; email: string }>(
        `SELECT user_id, display_name, email FROM users WHERE email = $1 AND is_active = true`,
        [BACKFILL_ACTOR_EMAIL]
    );
    if (actor.length === 0) {
        console.error(`Backfill actor ${BACKFILL_ACTOR_EMAIL} not found / inactive — aborting.`);
        process.exit(1);
    }
    const actorRow = actor[0];

    const stuck = await query<{
        external_id: string;
        remaining_volume_ml: string;
        dea_drug_name: string | null;
        controlled_substance: boolean | null;
    }>(
        `SELECT external_id, remaining_volume_ml::text, dea_drug_name, controlled_substance
           FROM vials
          WHERE status = 'Active'
            AND remaining_volume_ml::numeric > 0
            AND remaining_volume_ml::numeric < $1
          ORDER BY updated_at`,
        [RETIREMENT_THRESHOLD_ML]
    );

    console.log(`Found ${stuck.length} stuck vials (remaining > 0 and < ${RETIREMENT_THRESHOLD_ML} mL).`);
    if (stuck.length === 0) {
        console.log('Nothing to do.');
        return;
    }

    const totalWaste = stuck.reduce((acc, r) => acc + parseFloat(r.remaining_volume_ml), 0);
    console.log(
        `Total volume to document as waste: ${totalWaste.toFixed(2)} mL across ${stuck.length} vials.`
    );
    for (const v of stuck) {
        console.log(
            `  ${v.external_id.padEnd(8)} ${parseFloat(v.remaining_volume_ml).toFixed(3)} mL  ` +
            `controlled=${v.controlled_substance ? 'Y' : 'N'}  ${v.dea_drug_name ?? ''}`
        );
    }

    if (!apply) {
        console.log('\nDry-run only. Re-run with --apply to retire these vials.');
        return;
    }

    console.log(`\nActor: ${actorRow.email} (${actorRow.user_id})`);
    console.log(`Reason payload: ${BACKFILL_REASON}\n`);

    let ok = 0;
    let failed = 0;
    for (const v of stuck) {
        try {
            const result = await retireVial(
                v.external_id,
                actorRow.user_id,
                `${actorRow.display_name ?? actorRow.email} [backfill]`
            );
            console.log(
                `  ✓ ${v.external_id} retired — ${result.wastedMl.toFixed(3)} mL documented as waste.`
            );
            ok++;
        } catch (err) {
            failed++;
            console.error(
                `  ✗ ${v.external_id} FAILED:`,
                err instanceof Error ? err.message : err
            );
        }
    }

    console.log(`\nDone. ${ok} retired, ${failed} failed.`);
    if (failed > 0) process.exitCode = 1;
}

main()
    .catch(err => {
        console.error('Backfill aborted:', err);
        process.exit(1);
    })
    .finally(() => {
        // pg pool has lingering handles; force-exit so script doesn't hang
        setTimeout(() => process.exit(process.exitCode ?? 0), 100);
    });
