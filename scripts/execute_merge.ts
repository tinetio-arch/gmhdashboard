
import { config } from 'dotenv';
config({ path: '.env.local' });
import { executeSnowflakeQuery } from '../lib/snowflakeClient';
import { HealthieClient } from '../lib/healthie';

const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;
if (!HEALTHIE_API_KEY) {
    console.error('HEALTHIE_API_KEY not found');
    process.exit(1);
}

const healthie = new HealthieClient({ apiKey: HEALTHIE_API_KEY });
const IS_DRY_RUN = !process.argv.includes('--execute');
const SLEEP_MS = 500; // Sleep between api calls to avoid rate limits

interface Patient {
    HEALTHIE_ID: string;
    FIRST_NAME: string;
    LAST_NAME: string;
    EMAIL: string;
    DOB: string;
    CREATED_AT: string;
}

interface EnrichedPatient extends Patient {
    stripeId?: string;
    userGroupId?: string;
    isActive?: boolean;
    dataRichness?: {
        score: number;
        details: {
            documents: number;
            forms: number;
            medications: number;
            allergies: number;
            prescriptions: number;
        };
    };
    score: number;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function executeMerge() {
    console.log(`🚀 Starting Smart Merge Process (${IS_DRY_RUN ? 'DRY RUN' : 'EXECUTION MODE'})...`);
    console.log('📊 Using data richness scoring (documents priority)\n');

    // 1. Fetch Candidates
    console.log('Fetching patients...');
    const patients = await executeSnowflakeQuery<Patient>(`
        SELECT 
            HEALTHIE_ID, FIRST_NAME, LAST_NAME, EMAIL, TO_CHAR(DOB, 'YYYY-MM-DD') as DOB, CREATED_AT
        FROM GMH_CLINIC.PATIENT_DATA.HEALTHIE_PATIENTS
        WHERE HEALTHIE_ID IS NOT NULL
    `);

    const clusters = new Map<string, Patient[]>();
    patients.forEach(p => {
        if (!p.FIRST_NAME || !p.LAST_NAME) return;
        const key = `${p.FIRST_NAME.trim().toLowerCase()}|${p.LAST_NAME.trim().toLowerCase()}|${p.DOB || 'NO_DOB'}`;
        if (!clusters.has(key)) clusters.set(key, []);
        clusters.get(key)?.push(p);
    });

    const duplicateClusters = Array.from(clusters.values()).filter(g => g.length > 1);
    console.log(`Found ${duplicateClusters.length} clusters to process.\n`);

    let mergedCount = 0;
    let skippedCount = 0;
    let alreadyInactiveCount = 0;
    let processed = 0;

    for (const group of duplicateClusters) {
        processed++;
        if (processed % 10 === 0) {
            process.stdout.write('.');
            await sleep(1000); // Backoff every 10 items
        }

        const enriched: EnrichedPatient[] = [];

        for (const p of group) {
            try {
                // Get fresh data
                const user = await healthie.getClient(p.HEALTHIE_ID);
                const metadata = await healthie.getUserMetadata(p.HEALTHIE_ID);
                const dataRichness = await healthie.getPatientDataRichness(p.HEALTHIE_ID);

                const stripeId = metadata['stripe_customer_id'] || metadata['stripe_id'];

                let score = 0;
                // Priority Rules:
                // 1. Stripe ID (+1000)
                // 2. Active Status (+800) - Prefer keeping active ones
                // 3. Group Membership (+500)
                // 4. Data Richness (+variable, PRIMARY per user request)
                // 5. Age (+fraction)

                if (stripeId) score += 1000;
                if (user.active) score += 800;
                if (user.user_group_id) score += 500;
                score += dataRichness.score; // Documents * 10 + Forms * 5 + etc

                const createdTime = new Date(p.CREATED_AT).getTime();
                score += (Number.MAX_SAFE_INTEGER - createdTime) / 100000000000;

                enriched.push({
                    ...p,
                    stripeId,
                    userGroupId: user.user_group_id,
                    isActive: user.active,
                    dataRichness,
                    score
                });

                await sleep(SLEEP_MS); // Rate limit per patient fetch
            } catch (e) {
                console.error(`Error fetching ${p.HEALTHIE_ID}`, e);
            }
        }

        if (enriched.length < 2) continue;

        // Sort by score descending (Master first)
        enriched.sort((a, b) => b.score - a.score);

        const master = enriched[0];
        const duplicates = enriched.slice(1);

        // Debug output for complex cases only
        const hasStripe = enriched.some(p => p.stripeId);
        const hasActiveConflict = duplicates.some(d => d.isActive);

        // Always log if there's an action to take or conflict
        if (hasStripe || hasActiveConflict) {
            console.log(`\n${'='.repeat(60)}`);
            console.log(`Cluster: ${master.FIRST_NAME} ${master.LAST_NAME}`);
            console.log(`  👑 MASTER: ${master.HEALTHIE_ID}`);
            console.log(`     Active: ${master.isActive} | Group: ${master.userGroupId || 'None'} | Stripe: ${master.stripeId || 'No'}`);
            console.log(`     📊 Data: ${master.dataRichness?.details.documents || 0} docs, ${master.dataRichness?.details.forms || 0} forms, ${master.dataRichness?.details.medications || 0} meds`);
            console.log(`     Score: ${master.score.toFixed(2)}`);
        }

        for (const dup of duplicates) {
            if (hasStripe || hasActiveConflict) {
                console.log(`  🗑️  DUPLICATE: ${dup.HEALTHIE_ID}`);
                console.log(`     Active: ${dup.isActive} | Group: ${dup.userGroupId || 'None'} | Stripe: ${dup.stripeId || 'No'}`);
                console.log(`     📊 Data: ${dup.dataRichness?.details.documents || 0} docs, ${dup.dataRichness?.details.forms || 0} forms, ${dup.dataRichness?.details.medications || 0} meds`);
                console.log(`     Score: ${dup.score.toFixed(2)}`);
            }

            if (dup.stripeId) {
                console.log(`  ⚠️ SKIPPING: Duplicate has Stripe ID!`);
                skippedCount++;
                continue;
            }

            if (!dup.isActive) {
                // Already inactive - no action needed
                alreadyInactiveCount++;
                continue;
            }

            if (IS_DRY_RUN) {
                console.log(`  ✅ [DRY RUN] Would archive ${dup.HEALTHIE_ID} (keeping ${dup.dataRichness?.details.documents || 0} docs with inactive record)`);
            } else {
                try {
                    await healthie.updateClient(dup.HEALTHIE_ID, { active: false });
                    console.log(`  ✅ Archived ${dup.HEALTHIE_ID}`);
                    mergedCount++;
                    await sleep(SLEEP_MS);
                } catch (e) {
                    console.error(`  ❌ Failed to archive ${dup.HEALTHIE_ID}`, e);
                }
            }
        }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Process Complete.`);
    console.log(`Would Archive (Active Duplicates): ${IS_DRY_RUN ? mergedCount : 'N/A'}`);
    console.log(`Actually Archived: ${!IS_DRY_RUN ? mergedCount : 'N/A'}`);
    console.log(`Already Inactive (No Action): ${alreadyInactiveCount}`);
    console.log(`Skipped (Stripe/Safety): ${skippedCount}`);
    console.log(`${'='.repeat(60)}`);
}

executeMerge().catch(console.error);
