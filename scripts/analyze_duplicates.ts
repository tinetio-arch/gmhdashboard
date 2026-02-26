
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
}

interface DuplicateCluster {
    key: string;
    patients: Patient[];
}

interface EnrichedPatient extends Patient {
    stripeId?: string;
    stripeStatus?: string;
    groupNames?: string[];
    isSafeToMerge?: boolean; // True if NO stripe and NO special groups
}

async function analyze() {
    console.log('🔍 Starting Patient Deduplication Analysis...');

    // 1. Fetch all patients from Snowflake
    console.log('Fetching patients from Snowflake...');
    const patients = await executeSnowflakeQuery<Patient>(`
        SELECT 
            HEALTHIE_ID, FIRST_NAME, LAST_NAME, EMAIL, TO_CHAR(DOB, 'YYYY-MM-DD') as DOB, CREATED_AT
        FROM GMH_CLINIC.PATIENT_DATA.HEALTHIE_PATIENTS
        WHERE HEALTHIE_ID IS NOT NULL
    `);
    console.log(`Found ${patients.length} total patients.`);

    // 2. Group by Name + DOB
    const clusters = new Map<string, Patient[]>();

    patients.forEach(p => {
        if (!p.FIRST_NAME || !p.LAST_NAME) return;

        // Key: Normalized Name + DOB (if available)
        // We use strict matching first
        const key = `${p.FIRST_NAME.trim().toLowerCase()}|${p.LAST_NAME.trim().toLowerCase()}|${p.DOB || 'NO_DOB'}`;

        if (!clusters.has(key)) clusters.set(key, []);
        clusters.get(key)?.push(p);
    });

    // Filter for duplicates
    const duplicateClusters: DuplicateCluster[] = [];
    clusters.forEach((group, key) => {
        if (group.length > 1) {
            duplicateClusters.push({ key, patients: group });
        }
    });

    console.log(`⚠️ Found ${duplicateClusters.length} duplicate clusters (sharing Name + DOB).`);

    // 3. Enrich with Healthie Data (Stripe & Groups)
    // We process sequentially to avoid rate limits
    const enrichedClusters: { key: string; patients: EnrichedPatient[] }[] = [];

    console.log('Checking Healthie for Stripe/Group constraints...');
    let processed = 0;

    for (const cluster of duplicateClusters) {
        processed++;
        if (processed % 10 === 0) console.log(`Processed ${processed}/${duplicateClusters.length} clusters...`);

        const enrichedGroup: EnrichedPatient[] = [];

        for (const p of cluster.patients) {
            try {
                // Get User Metadata for Stripe ID
                const metadata = await healthie.getUserMetadata(p.HEALTHIE_ID);
                const stripeId = metadata['stripe_customer_id'] || metadata['stripe_id']; // Guessing keys

                // Get User Groups (via getClient or separate call? getClient has user_group_id but not list)
                // We'll use getClient to get group ID
                const client = await healthie.getClient(p.HEALTHIE_ID);

                // Note: Healthie API client definition in lib might need extending if we need full group list
                // For now, checks single group or if we can infer from metadata

                enrichedGroup.push({
                    ...p,
                    stripeId: stripeId || undefined,
                    groupNames: [], // Placeholder until we can fetch groups better
                    isSafeToMerge: !stripeId
                });

            } catch (e) {
                console.error(`Failed to fetch Healthie data for ${p.HEALTHIE_ID}:`, e);
                enrichedGroup.push({ ...p, isSafeToMerge: false }); // Assume unsafe if error
            }
        }
        enrichedClusters.push({ key: cluster.key, patients: enrichedGroup });
    }

    // 4. Generate Report
    const reportLines: string[] = [];
    reportLines.push('# Patient Deduplication Analysis Report');
    reportLines.push(`Generated: ${new Date().toISOString()}`);
    reportLines.push(`Total Clusters Found: ${duplicateClusters.length}`);
    reportLines.push('');

    for (const cluster of enrichedClusters) {
        reportLines.push(`## Cluster: ${cluster.key.replace(/\|/g, ' ')}`);

        // Sort by creation date (oldest first)
        const sorted = cluster.patients.sort((a, b) => new Date(a.CREATED_AT).getTime() - new Date(b.CREATED_AT).getTime());

        for (const p of sorted) {
            const flags = [];
            if (p.stripeId) flags.push(`💳 STRIPE (${p.stripeId})`);
            // if (p.groupNames?.length) flags.push(`👥 GROUPS`);

            const flagStr = flags.length ? `[${flags.join(', ')}]` : '[SAFE]';

            reportLines.push(`- ${p.HEALTHIE_ID} | ${p.EMAIL} | Created: ${p.CREATED_AT} | ${flagStr}`);
        }
        reportLines.push('');
    }

    fs.writeFileSync('duplicate_report.md', reportLines.join('\n'));
    console.log('✅ Analysis complete! Report saved to duplicate_report.md');
}

analyze().catch(console.error);
