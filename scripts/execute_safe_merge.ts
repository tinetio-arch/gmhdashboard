
import { config } from 'dotenv';
config({ path: '.env.local' });
import { executeSnowflakeQuery } from '../lib/snowflakeClient';
import { HealthieClient } from '../lib/healthie';
import * as fs from 'fs';

const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;
if (!HEALTHIE_API_KEY) {
    console.error('HEALTHIE_API_KEY not found');
    process.exit(1);
}

const healthie = new HealthieClient({ apiKey: HEALTHIE_API_KEY });

interface Patient {
    HEALTHIE_ID: string;
    FIRST_NAME: string;
    LAST_NAME: string;
    EMAIL: string;
    DOB: string;
    CREATED_AT: string;
    isActive?: boolean;
    hasGroup?: boolean;
    stripeId?: string;
    dataRichness?: {
        score: number;
        details: { documents: number; forms: number; medications: number; allergies: number; prescriptions: number; };
    };
    finalScore?: number;
}

function normalizeEmail(email: string | null): string {
    if (!email) return '';
    return email.trim().toLowerCase();
}

function normalizeName(name: string | null): string {
    if (!name) return '';
    return name.trim().toLowerCase().replace(/[^a-z]/g, '');
}

function levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= str2.length; i++) { matrix[i] = [i]; }
    for (let j = 0; j <= str1.length; j++) { matrix[0][j] = j; }
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
            }
        }
    }
    return matrix[str2.length][str1.length];
}

function areSimilarNames(name1: string, name2: string): boolean {
    if (!name1 || !name2) return false;
    const n1 = normalizeName(name1);
    const n2 = normalizeName(name2);
    if (n1 === n2) return true;
    if (n1.includes(n2) || n2.includes(n1)) return true;
    if (levenshteinDistance(n1, n2) < 3 && Math.min(n1.length, n2.length) > 3) return true;
    return false;
}

async function executeSafeMerge() {
    console.log('🚀 EXECUTING Safe Duplicate Merge');
    console.log('Fetching ungrouped active duplicates from Snowflake...\n');

    const patients = await executeSnowflakeQuery<Patient>(`
        SELECT 
            HEALTHIE_ID, FIRST_NAME, LAST_NAME, EMAIL,
            TO_CHAR(DOB, 'YYYY-MM-DD') as DOB, CREATED_AT
        FROM GMH_CLINIC.PATIENT_DATA.HEALTHIE_PATIENTS
        WHERE HEALTHIE_ID IS NOT NULL
        ORDER BY LAST_NAME, FIRST_NAME
    `);

    console.log(`✅ Loaded ${patients.length} patients\n`);

    const duplicateGroups: Patient[][] = [];
    const processed = new Set<number>();

    // Find duplicates (same logic as before)
    for (let i = 0; i < patients.length; i++) {
        if (processed.has(i)) continue;
        const p1 = patients[i];
        if (!p1.LAST_NAME || !p1.DOB) continue;
        const group: Patient[] = [p1];
        for (let j = i + 1; j < patients.length; j++) {
            if (processed.has(j)) continue;
            const p2 = patients[j];
            if (!p2.LAST_NAME || !p2.DOB) continue;
            if (normalizeName(p1.LAST_NAME) !== normalizeName(p2.LAST_NAME)) continue;
            if (p1.DOB !== p2.DOB) continue;
            if (areSimilarNames(p1.FIRST_NAME, p2.FIRST_NAME)) {
                group.push(p2);
                processed.add(j);
            }
        }
        if (group.length > 1) {
            duplicateGroups.push(group);
            processed.add(i);
        }
    }

    const emailMap = new Map<string, Patient[]>();
    for (const p of patients) {
        const email = normalizeEmail(p.EMAIL);
        if (!email || email.includes('@gethealthie.com')) continue;
        if (!emailMap.has(email)) emailMap.set(email, []);
        emailMap.get(email)!.push(p);
    }

    Array.from(emailMap.entries()).forEach(([email, group]) => {
        if (group.length > 1) {
            const alreadyGrouped = duplicateGroups.some(dg =>
                dg.some(p => group.some(gp => gp.HEALTHIE_ID === p.HEALTHIE_ID))
            );
            if (!alreadyGrouped) {
                duplicateGroups.push(group);
            }
        }
    });

    console.log(`Found ${duplicateGroups.length} potential duplicate clusters\n`);
    console.log('🔍 Enriching with: Active, Group, Stripe, Data Richness...\n');

    const safeToMergeGroups: Patient[][] = [];
    let checkedGroups = 0;

    for (const group of duplicateGroups) {
        checkedGroups++;
        if (checkedGroups % 50 === 0) {
            console.log(`   Enriched ${checkedGroups}/${duplicateGroups.length}...`);
        }

        for (const patient of group) {
            try {
                const [user, metadata, richness] = await Promise.all([
                    healthie.getClient(patient.HEALTHIE_ID),
                    healthie.getUserMetadata(patient.HEALTHIE_ID),
                    healthie.getPatientDataRichness(patient.HEALTHIE_ID)
                ]);

                patient.isActive = user?.active ?? false;
                patient.hasGroup = !!user?.user_group_id;
                patient.stripeId = metadata['stripe_customer_id'] || metadata['stripe_id'];
                patient.dataRichness = richness;

                // Final scoring: Stripe > Active > Data Richness > Age
                let score = 0;
                if (patient.stripeId) score += 10000;
                if (patient.isActive) score += 1000;
                score += richness.score; // Documents * 10 + Forms * 5 + etc
                const createdTime = new Date(patient.CREATED_AT).getTime();
                score += (Number.MAX_SAFE_INTEGER - createdTime) / 100000000000;

                patient.finalScore = score;
            } catch (e) {
                console.error(`   Error enriching ${patient.HEALTHIE_ID}:`, (e as Error).message);
                patient.isActive = false;
                patient.hasGroup = false;
                patient.finalScore = 0;
            }
        }

        const activeCount = group.filter(p => p.isActive).length;
        const hasGroupedPatient = group.some(p => p.hasGroup);

        if (activeCount >= 2 && !hasGroupedPatient) {
            safeToMergeGroups.push(group);
        }
    }

    console.log(`\n✅ Found ${safeToMergeGroups.length} safe clusters to process\n`);
    console.log('='.repeat(80));
    console.log('🔥 BEGINNING MERGE EXECUTION');
    console.log('='.repeat(80));

    let archived = 0;
    let skipped = 0;
    const log: string[] = [];

    for (let i = 0; i < safeToMergeGroups.length; i++) {
        const group = safeToMergeGroups[i];

        // Sort by finalScore descending (master first)
        group.sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));

        const master = group[0];
        const duplicates = group.filter(p => p.HEALTHIE_ID !== master.HEALTHIE_ID && p.isActive);

        console.log(`\n[${i + 1}/${safeToMergeGroups.length}] ${master.FIRST_NAME} ${master.LAST_NAME}`);
        console.log(`  👑 MASTER: ${master.HEALTHIE_ID}`);
        console.log(`     Stripe: ${master.stripeId || 'None'} | Docs: ${master.dataRichness?.details.documents || 0} | Forms: ${master.dataRichness?.details.forms || 0}`);

        log.push(`\n## Cluster ${i + 1}: ${master.FIRST_NAME} ${master.LAST_NAME}`);
        log.push(`- **Master:** \`${master.HEALTHIE_ID}\` (Stripe: ${master.stripeId || 'None'}, Docs: ${master.dataRichness?.details.documents || 0})`);

        for (const dup of duplicates) {
            console.log(`  🗑️  DUPLICATE: ${dup.HEALTHIE_ID}`);
            console.log(`     Stripe: ${dup.stripeId || 'None'} | Docs: ${dup.dataRichness?.details.documents || 0}`);

            if (dup.stripeId) {
                console.log(`     ⚠️ SKIPPING: Has Stripe ID!`);
                log.push(`- **Skipped:** \`${dup.HEALTHIE_ID}\` (Has Stripe: ${dup.stripeId})`);
                skipped++;
                continue;
            }

            try {
                await healthie.updateClient(dup.HEALTHIE_ID, { active: false });
                console.log(`     ✅ ARCHIVED`);
                log.push(`- **Archived:** \`${dup.HEALTHIE_ID}\``);
                archived++;
            } catch (e) {
                console.log(`     ❌ FAILED: ${(e as Error).message}`);
                log.push(`- **Failed:** \`${dup.HEALTHIE_ID}\` - ${(e as Error).message}`);
            }
        }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ MERGE COMPLETE');
    console.log('='.repeat(80));
    console.log(`Clusters Processed: ${safeToMergeGroups.length}`);
    console.log(`Records Archived: ${archived}`);
    console.log(`Records Skipped (Stripe): ${skipped}`);

    const report = `# Merge Execution Log\n\n**Date:** ${new Date().toISOString()}\n**Clusters:** ${safeToMergeGroups.length}\n**Archived:** ${archived}\n**Skipped:** ${skipped}\n\n---\n\n${log.join('\n')}`;
    fs.writeFileSync('merge_execution_log.md', report);
    console.log('\n📄 Log saved: merge_execution_log.md\n');
}

executeSafeMerge().catch(console.error);
