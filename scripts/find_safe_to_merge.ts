
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
    userGroupId?: string;
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

async function findUngroupedActiveDuplicates() {
    console.log('🔍 Finding UNGROUPED Active Duplicates (NO Healthie Groups)');
    console.log('Fetching ALL patients from Snowflake...\n');

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

    // Find duplicates by name similarity
    console.log('📋 Finding duplicates by name + DOB...');
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
    console.log(`   Found ${duplicateGroups.length} groups\n`);

    // Find duplicates by email
    console.log('📧 Finding duplicates by email...');
    const emailMap = new Map<string, Patient[]>();
    for (const p of patients) {
        const email = normalizeEmail(p.EMAIL);
        if (!email || email.includes('@gethealthie.com')) continue;
        if (!emailMap.has(email)) emailMap.set(email, []);
        emailMap.get(email)!.push(p);
    }

    let emailDupes = 0;
    Array.from(emailMap.entries()).forEach(([email, group]) => {
        if (group.length > 1) {
            const alreadyGrouped = duplicateGroups.some(dg =>
                dg.some(p => group.some(gp => gp.HEALTHIE_ID === p.HEALTHIE_ID))
            );
            if (!alreadyGrouped) {
                duplicateGroups.push(group);
                emailDupes++;
            }
        }
    });
    console.log(`   Found ${emailDupes} additional groups\n`);
    console.log(`Total potential: ${duplicateGroups.length}\n`);

    console.log('🔍 Checking: Active status + Group membership...\n');

    const safeToMergeGroups: Patient[][] = [];
    let checkedGroups = 0;

    for (const group of duplicateGroups) {
        checkedGroups++;
        if (checkedGroups % 50 === 0) {
            console.log(`   Checked ${checkedGroups}/${duplicateGroups.length}...`);
        }

        for (const patient of group) {
            try {
                const user = await healthie.getClient(patient.HEALTHIE_ID);
                patient.isActive = user?.active ?? false;
                patient.hasGroup = !!user?.user_group_id;
                patient.userGroupId = user?.user_group_id;
            } catch (e) {
                patient.isActive = false;
                patient.hasGroup = false;
            }
        }

        const activeCount = group.filter(p => p.isActive).length;
        const hasGroupedPatient = group.some(p => p.hasGroup);

        // ONLY include if: 2+ active AND NO grouped patients
        if (activeCount >= 2 && !hasGroupedPatient) {
            safeToMergeGroups.push(group);
        }
    }

    console.log(`\n✅ Filtering complete!\n`);
    console.log('='.repeat(80));
    console.log(`SAFE TO MERGE (Ungrouped Only): ${safeToMergeGroups.length}`);
    console.log('='.repeat(80));

    let totalActive = 0;
    let totalToArchive = 0;

    let report = `# Safe-to-Merge Duplicate Report (UNGROUPED ONLY)\n\n`;
    report += `**Generated:** ${new Date().toISOString()}\n`;
    report += `**Criteria:**\n`;
    report += `- ✅ 2+ Active patients in cluster\n`;
    report += `- ✅ NO Healthie group memberships (user_group_id)\n`;
    report += `- ✅ NO Stripe payments (checked during merge)\n\n`;
    report += `**Total Patients:** ${patients.length}\n`;
    report += `**Potential Duplicates:** ${duplicateGroups.length}\n`;
    report += `**SAFE TO MERGE:** ${safeToMergeGroups.length}\n\n`;
    report += `---\n\n`;

    for (let i = 0; i < safeToMergeGroups.length; i++) {
        const group = safeToMergeGroups[i];
        const activeInGroup = group.filter(p => p.isActive);
        totalActive += activeInGroup.length;
        totalToArchive += activeInGroup.length - 1;

        report += `## Cluster ${i + 1}: ${group[0].FIRST_NAME} ${group[0].LAST_NAME}\n\n`;
        report += `**Active:** ${activeInGroup.length} | **Group Membership:** None ✅\n\n`;

        for (const p of group) {
            const status = p.isActive ? '✅ ACTIVE' : '💤 Inactive';
            report += `- ${status} **ID:** \`${p.HEALTHIE_ID}\`\n`;
            report += `  - Email: ${p.EMAIL || 'N/A'}\n`;
            report += `  - DOB: ${p.DOB || 'N/A'}\n`;
            report += `  - Created: ${p.CREATED_AT}\n\n`;
        }
        report += `---\n\n`;
    }

    report += `\n## Summary\n\n`;
    report += `- **Safe Clusters:** ${safeToMergeGroups.length}\n`;
    report += `- **Active Duplicates:** ${totalActive}\n`;
    report += `- **To Archive:** ${totalToArchive}\n`;

    fs.writeFileSync('safe_to_merge_report.md', report);
    console.log('\n✅ Report: safe_to_merge_report.md');
    console.log(`\n📊 Summary:`);
    console.log(`   - ${safeToMergeGroups.length} safe ungrouped clusters`);
    console.log(`   - ${totalActive} active ungrouped duplicates`);
    console.log(`   - ${totalToArchive} records to archive\n`);
}

findUngroupedActiveDuplicates().catch(console.error);
