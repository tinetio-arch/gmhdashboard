
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
}

function normalizeEmail(email: string | null): string {
    if (!email) return '';
    return email.trim().toLowerCase();
}

function normalizeName(name: string | null): string {
    if (!name) return '';
    return name.trim().toLowerCase()
        .replace(/[^a-z]/g, ''); // Remove non-letters for fuzzy matching
}

function levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
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

async function findActiveDuplicates() {
    console.log('🔍 Finding ACTIVE Duplicates Only (NO RATE LIMITING)');
    console.log('Fetching ALL patients from Snowflake...\n');

    const patients = await executeSnowflakeQuery<Patient>(`
        SELECT 
            HEALTHIE_ID,
            FIRST_NAME,
            LAST_NAME,
            EMAIL,
            TO_CHAR(DOB, 'YYYY-MM-DD') as DOB,
            CREATED_AT
        FROM GMH_CLINIC.PATIENT_DATA.HEALTHIE_PATIENTS
        WHERE HEALTHIE_ID IS NOT NULL
        ORDER BY LAST_NAME, FIRST_NAME
    `);

    console.log(`✅ Loaded ${patients.length} patients\n`);
    console.log('Finding potential duplicates...\n');

    const duplicateGroups: Patient[][] = [];
    const processed = new Set<number>();

    // Strategy 1: Same Last Name + DOB + Similar First Name
    console.log('📋 Strategy 1: Same Last Name + DOB + Similar First Name');
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

    // Strategy 2: Same Email
    console.log('📧 Strategy 2: Same Email Address');
    const emailMap = new Map<string, Patient[]>();
    for (const p of patients) {
        const email = normalizeEmail(p.EMAIL);
        if (!email || email.includes('@gethealthie.com')) continue;

        if (!emailMap.has(email)) {
            emailMap.set(email, []);
        }
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
    console.log(`   Found ${emailDupes} additional groups by email\n`);

    console.log(`Total potential duplicate groups: ${duplicateGroups.length}\n`);
    console.log('🔍 Checking Healthie API for ACTIVE status (this may take a few minutes)...\n');

    // Now check active status for each group
    const activeDuplicateGroups: Patient[][] = [];
    let checkedGroups = 0;

    for (const group of duplicateGroups) {
        checkedGroups++;
        if (checkedGroups % 50 === 0) {
            console.log(`   Checked ${checkedGroups}/${duplicateGroups.length} groups...`);
        }

        // Fetch active status for each patient in group
        for (const patient of group) {
            try {
                const user = await healthie.getClient(patient.HEALTHIE_ID);
                patient.isActive = user?.active ?? false;
            } catch (e) {
                console.error(`   Error checking ${patient.HEALTHIE_ID}:`, (e as Error).message);
                patient.isActive = false; // Assume inactive if can't fetch
            }
        }

        // Count active patients in group
        const activeCount = group.filter(p => p.isActive).length;

        // Only include groups with 2+ active patients
        if (activeCount >= 2) {
            activeDuplicateGroups.push(group);
        }
    }

    console.log(`\n✅ Active status check complete!\n`);

    // Generate Report
    console.log('='.repeat(80));
    console.log(`ACTIONABLE DUPLICATE GROUPS: ${activeDuplicateGroups.length}`);
    console.log('='.repeat(80));

    let totalActiveRecords = 0;
    let totalToArchive = 0;

    let report = `# Active Duplicate Detection Report\n\n`;
    report += `**Generated:** ${new Date().toISOString()}\n`;
    report += `**Total Patients Analyzed:** ${patients.length}\n`;
    report += `**Potential Duplicate Groups:** ${duplicateGroups.length}\n`;
    report += `**ACTIONABLE Groups (2+ Active):** ${activeDuplicateGroups.length}\n\n`;
    report += `> ⚠️ This report ONLY shows groups with 2+ ACTIVE patients. Already-resolved duplicates are excluded.\n\n`;
    report += `---\n\n`;

    for (let i = 0; i < activeDuplicateGroups.length; i++) {
        const group = activeDuplicateGroups[i];
        const activeInGroup = group.filter(p => p.isActive);
        totalActiveRecords += activeInGroup.length;
        totalToArchive += activeInGroup.length - 1; // Keep 1, archive rest

        report += `## Group ${i + 1}: ${group[0].FIRST_NAME} ${group[0].LAST_NAME}\n\n`;
        report += `**Active Count:** ${activeInGroup.length} ⚠️\n\n`;

        for (const p of group) {
            const statusIcon = p.isActive ? '✅ ACTIVE' : '💤 Inactive';
            report += `- ${statusIcon} **ID:** \`${p.HEALTHIE_ID}\`\n`;
            report += `  - Email: ${p.EMAIL || 'N/A'}\n`;
            report += `  - DOB: ${p.DOB || 'N/A'}\n`;
            report += `  - Created: ${p.CREATED_AT}\n`;
            report += `\n`;
        }
        report += `---\n\n`;
    }

    report += `\n## Summary\n\n`;
    report += `- **Actionable Groups:** ${activeDuplicateGroups.length}\n`;
    report += `- **Total Active Duplicates:** ${totalActiveRecords}\n`;
    report += `- **Records to Archive:** ${totalToArchive} (keeping 1 per group)\n`;

    fs.writeFileSync('active_duplicates_report.md', report);
    console.log('\n✅ Report saved to: active_duplicates_report.md');
    console.log(`\n📊 ACTIONABLE Summary:`);
    console.log(`   - ${activeDuplicateGroups.length} groups with 2+ active patients`);
    console.log(`   - ${totalActiveRecords} total active duplicate records`);
    console.log(`   - ${totalToArchive} records need archiving\n`);
}

findActiveDuplicates().catch(console.error);
