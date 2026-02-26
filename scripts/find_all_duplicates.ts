
import { config } from 'dotenv';
config({ path: '.env.local' });
import { executeSnowflakeQuery } from '../lib/snowflakeClient';
import * as fs from 'fs';

interface Patient {
    HEALTHIE_ID: string;
    FIRST_NAME: string;
    LAST_NAME: string;
    EMAIL: string;
    DOB: string;
    CREATED_AT: string;
}

function normalizePhone(phone: string | null): string {
    if (!phone) return '';
    return phone.replace(/\D/g, '');
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
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
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

    // Exact match
    if (n1 === n2) return true;

    // One is substring of the other (e.g., "Greg" in "Gregory")
    if (n1.includes(n2) || n2.includes(n1)) return true;

    // Levenshtein distance < 3 (allows for 1-2 typos)
    if (levenshteinDistance(n1, n2) < 3 && Math.min(n1.length, n2.length) > 3) return true;

    return false;
}

async function findAllDuplicates() {
    console.log('🔍 COMPREHENSIVE Duplicate Detection (NO RATE LIMITING)');
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
    console.log('Finding duplicates by multiple criteria...\n');

    const duplicateGroups: Patient[][] = [];
    const processed = new Set<number>();

    // Strategy 1: Exact Last Name + DOB + Similar First Name
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

            // Same last name (exact)
            if (normalizeName(p1.LAST_NAME) !== normalizeName(p2.LAST_NAME)) continue;

            // Same DOB
            if (p1.DOB !== p2.DOB) continue;

            // Similar first name (handles Greg/Gregory, typos)
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

    // Strategy 2: Same Email (non-empty)
    console.log('📧 Strategy 2: Same Email Address');
    const emailMap = new Map<string, Patient[]>();
    for (const p of patients) {
        const email = normalizeEmail(p.EMAIL);
        if (!email || email.includes('@gethealthie.com')) continue; // Skip placeholder emails

        if (!emailMap.has(email)) {
            emailMap.set(email, []);
        }
        emailMap.get(email)!.push(p);
    }

    let emailDupes = 0;
    Array.from(emailMap.entries()).forEach(([email, group]) => {
        if (group.length > 1) {
            // Check if already found by name
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

    // Generate Report
    console.log('='.repeat(80));
    console.log(`TOTAL DUPLICATE GROUPS FOUND: ${duplicateGroups.length}`);
    console.log('='.repeat(80));

    let totalDuplicateRecords = 0;
    let report = `# Comprehensive Duplicate Detection Report\n\n`;
    report += `**Generated:** ${new Date().toISOString()}\n`;
    report += `**Total Patients Analyzed:** ${patients.length}\n`;
    report += `**Duplicate Groups Found:** ${duplicateGroups.length}\n\n`;
    report += `---\n\n`;

    for (let i = 0; i < duplicateGroups.length; i++) {
        const group = duplicateGroups[i];
        totalDuplicateRecords += group.length;

        report += `## Group ${i + 1}: ${group[0].FIRST_NAME} ${group[0].LAST_NAME}\n\n`;

        for (const p of group) {
            report += `- **ID:** \`${p.HEALTHIE_ID}\`\n`;
            report += `  - Email: ${p.EMAIL || 'N/A'}\n`;
            report += `  - DOB: ${p.DOB || 'N/A'}\n`;
            report += `  - Created: ${p.CREATED_AT}\n`;
            report += `\n`;
        }
        report += `---\n\n`;
    }

    report += `\n**Total Duplicate Records:** ${totalDuplicateRecords}\n`;
    report += `**Records to Archive:** ${totalDuplicateRecords - duplicateGroups.length} (keeping 1 per group)\n`;

    fs.writeFileSync('comprehensive_duplicates_report.md', report);
    console.log('\n✅ Report saved to: comprehensive_duplicates_report.md');
    console.log(`\n📊 Summary:`);
    console.log(`   - ${duplicateGroups.length} duplicate groups`);
    console.log(`   - ${totalDuplicateRecords} total duplicate records`);
    console.log(`   - ${totalDuplicateRecords - duplicateGroups.length} records to archive\n`);
}

findAllDuplicates().catch(console.error);
