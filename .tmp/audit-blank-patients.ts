/**
 * READ-ONLY audit of the 34 "blank" patients (NULL status_key OR client_type_key).
 * Fetches Healthie data per patient, applies classification rules, outputs a
 * markdown report. NO writes to local DB or Healthie. NO merges.
 *
 * Run: cd ~/gmhdashboard && npx tsx .tmp/audit-blank-patients.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { query } from '../lib/db';
import { healthieGraphQL } from '../lib/healthieApi';
import * as fs from 'fs';
import * as path from 'path';

interface BlankPatient {
    patient_id: string;
    full_name: string | null;
    email: string | null;
    phone_primary: string | null;
    dob: string | null;
    healthie_client_id: string;
    status_key: string | null;
    client_type_key: string | null;
    payment_method_key: string | null;
    patient_type: string | null;
    clinic: string | null;
    regimen: string | null;
    date_added: string | null;
}

interface HealthieData {
    user?: any;
    locations?: any[];
    appointments?: any[];
    packages?: any[];
}

interface Suggestion {
    suggested_client_type_key: string | null;
    suggested_clinic: string | null;
    suggested_status_key: string;
    is_recurring: boolean | null;
    rule_fired: string;
    signals: string[];
    needs_manual_review: boolean;
}

const MENS_HEALTH_KEYWORDS = /\b(hrt|trt|mhm|men'?s|male|testosterone|evexipel.*male)\b/i;
const PRIMARY_CARE_KEYWORDS = /\b(primary\s*care|primary_care|annual|physical|wellness|evexipel(?!.*male))\b/i;
const LONGEVITY_KEYWORDS = /\b(longevity|peptide|iv\s*therapy|weight\s*loss)\b/i;
const MENTAL_HEALTH_KEYWORDS = /\b(mental|psych|therapy|counsel)\b/i;
const ABXTAC_KEYWORDS = /\b(abxtac|research\s*peptide)\b/i;

const PRIMARY_CARE_LOCATION_RX = /primary/i;
const MENS_HEALTH_LOCATION_RX = /men.?s\s*health|menshealth/i;

async function fetchHealthie(healthieId: string): Promise<HealthieData> {
    const data: HealthieData = {};
    // Combined demographics + locations + appointments in ONE query (saves rate limit).
    // Healthie schema: location is a scalar; no packages/preferred_name on User.
    try {
        const res = await healthieGraphQL<any>(`
            query GetUserBundle($id: ID, $offset: Int) {
                user(id: $id) {
                    id first_name last_name legal_name
                    email dob gender phone_number
                    locations { id line1 line2 city state zip country }
                    next_appt_date
                }
                appointments(user_id: $id, offset: $offset, should_paginate: true, filter: "all") {
                    id date pm_status location notes
                    appointment_type { id name }
                    provider { id full_name }
                }
            }
        `, { id: healthieId, offset: 0 });
        data.user = res?.user;
        data.locations = res?.user?.locations || [];
        data.packages = []; // not available on User in this schema
        data.appointments = res?.appointments || [];
    } catch (err: any) {
        // Some fields (packages/appointments) may not be queryable for every account — fall back to user-only
        try {
            const res = await healthieGraphQL<any>(`
                query GetUserBasic($id: ID) {
                    user(id: $id) {
                        id first_name last_name email dob gender phone_number
                        locations { id line1 line2 city state zip country }
                    }
                }
            `, { id: healthieId });
            data.user = res?.user;
            data.locations = res?.user?.locations || [];
            (data as any).fetchError = err?.message || String(err);
        } catch (err2: any) {
            (data as any).fetchError = err2?.message || String(err2);
        }
    }
    return data;
}

async function classify(p: BlankPatient, h: HealthieData): Promise<Suggestion> {
    const signals: string[] = [];
    const apptTypes = (h.appointments || []).map(a => a?.appointment_type?.name || '').filter(Boolean);
    const apptTypesStr = apptTypes.join(' | ');
    const locationNames = (h.locations || []).map(l => `${l?.line1 || ''} ${l?.city || ''}`.trim()).filter(Boolean);
    const apptLocations = (h.appointments || []).map(a => (typeof a?.location === 'string' ? a.location : a?.location?.name) || '').filter(Boolean);
    const allLocations = [...locationNames, ...apptLocations].join(' | ');
    const packageNames = (h.packages || []).map(pk => pk?.name || '').filter(Boolean).join(' | ');

    if (apptTypes.length) signals.push(`appts: ${apptTypes.length} (${apptTypesStr.slice(0, 80)})`);
    if (allLocations) signals.push(`locations: ${allLocations.slice(0, 80)}`);
    if (packageNames) signals.push(`packages: ${packageNames.slice(0, 80)}`);

    // Local signals
    const [dispCount] = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM dispenses WHERE patient_id = $1`, [p.patient_id]).catch(() => [{ n: '0' }]);
    const [deaCount]  = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM dea_transactions WHERE patient_id = $1`, [p.patient_id]).catch(() => [{ n: '0' }]);
    const [pepCount]  = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM patient_approved_peptides WHERE healthie_user_id = $1`, [p.healthie_client_id]).catch(() => [{ n: '0' }]);
    const [scribeCount] = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM scribe_sessions WHERE patient_id = $1`, [p.patient_id]).catch(() => [{ n: '0' }]);
    const dispenses = parseInt(dispCount?.n || '0', 10);
    const dea = parseInt(deaCount?.n || '0', 10);
    const peptides = parseInt(pepCount?.n || '0', 10);
    const scribes = parseInt(scribeCount?.n || '0', 10);
    if (dispenses) signals.push(`dispenses=${dispenses}`);
    if (dea) signals.push(`dea=${dea}`);
    if (peptides) signals.push(`peptides=${peptides}`);
    if (scribes) signals.push(`scribes=${scribes}`);
    if (p.regimen) signals.push(`regimen="${p.regimen}"`);

    // Clinic from Healthie location
    let suggestedClinic: string | null = null;
    if (PRIMARY_CARE_LOCATION_RX.test(allLocations)) suggestedClinic = 'nowprimary.care';
    else if (MENS_HEALTH_LOCATION_RX.test(allLocations)) suggestedClinic = 'nowmenshealth.care';

    // Recurring? (only if payment_method present)
    const isRecurring = (h.packages && h.packages.length > 0) ? true : (p.payment_method_key ? false : null);

    // Cascade
    let suggested: string | null = null;
    let rule = '';
    if (ABXTAC_KEYWORDS.test(apptTypesStr) || ABXTAC_KEYWORDS.test(packageNames)) {
        suggested = 'abxtac'; rule = 'matched ABXTac keyword in appts/packages';
    } else if (p.regimen || dispenses > 0 || dea > 0 || MENS_HEALTH_KEYWORDS.test(apptTypesStr)) {
        suggested = 'nowmenshealth'; rule = 'TRT signals (regimen/dispenses/DEA) or HRT/TRT appt';
    } else if (peptides > 0 || LONGEVITY_KEYWORDS.test(apptTypesStr)) {
        suggested = 'nowlongevity'; rule = 'peptide rows or longevity/peptide/IV appt';
    } else if (MENTAL_HEALTH_KEYWORDS.test(apptTypesStr)) {
        suggested = 'nowmentalhealth'; rule = 'mental/psych/therapy appt';
    } else if (suggestedClinic === 'nowprimary.care' || PRIMARY_CARE_KEYWORDS.test(apptTypesStr)) {
        suggested = 'nowprimarycare'; rule = 'primary-care location or appt type';
    } else if (p.patient_type === 'visit' || (apptTypes.length <= 1 && (h.packages || []).length === 0)) {
        suggested = 'sick_visit'; rule = 'patient_type=visit OR ≤1 appt + no packages';
    }

    return {
        suggested_client_type_key: suggested,
        suggested_clinic: suggestedClinic,
        suggested_status_key: 'active',
        is_recurring: isRecurring,
        rule_fired: rule || 'NO RULE MATCHED',
        signals,
        needs_manual_review: !suggested,
    };
}

async function main() {
    const patients = await query<BlankPatient>(`
      SELECT patient_id, full_name, email, phone_primary, dob,
             healthie_client_id, status_key, client_type_key, payment_method_key,
             patient_type, clinic, regimen, date_added::text
      FROM patients
      WHERE (status_key IS NULL OR client_type_key IS NULL)
        AND healthie_client_id IS NOT NULL
      ORDER BY date_added DESC NULLS LAST
    `);
    console.log(`[audit] ${patients.length} blank patients to audit`);

    const results: Array<{ p: BlankPatient; h: HealthieData; s: Suggestion }> = [];
    for (let i = 0; i < patients.length; i++) {
        const p = patients[i];
        process.stdout.write(`[audit] (${i + 1}/${patients.length}) ${p.full_name} (healthie ${p.healthie_client_id})... `);
        const h = await fetchHealthie(p.healthie_client_id);
        const s = await classify(p, h);
        results.push({ p, h, s });
        console.log(`→ ${s.suggested_client_type_key || 'MANUAL'} (${s.rule_fired})`);
    }

    // Build markdown
    const date = new Date().toISOString().slice(0, 10);
    const md: string[] = [];
    md.push(`# Blank Patient Audit — ${date}`);
    md.push('');
    md.push(`**Read-only.** No data was modified. Reviewing ${results.length} patients with NULL status_key or client_type_key.`);
    md.push('');

    const counts = results.reduce((acc, r) => {
        const k = r.s.suggested_client_type_key || 'MANUAL_REVIEW';
        acc[k] = (acc[k] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);
    md.push('## Suggested classification distribution');
    md.push('');
    for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        md.push(`- **${k}**: ${n}`);
    }
    md.push('');

    md.push('## Per-patient findings');
    md.push('');
    for (const { p, h, s } of results) {
        const u = h.user || {};
        const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ') || p.full_name || '(no name)';
        md.push(`### ${fullName} — \`${p.patient_id}\``);
        md.push('');
        md.push(`- **Healthie ID**: ${p.healthie_client_id}`);
        md.push(`- **Local row**: name="${p.full_name || ''}", email="${p.email || ''}", phone="${p.phone_primary || ''}", dob=${p.dob || '—'}, status=${p.status_key || '—'}, type=${p.client_type_key || '—'}, clinic=${p.clinic || '—'}`);
        md.push(`- **Healthie row**: name="${fullName}", email="${u.email || ''}", phone="${u.phone_number || ''}", dob=${u.dob || '—'}, gender=${u.gender || '—'}`);
        if ((h as any).fetchError) md.push(`- **⚠️ Healthie fetch error**: ${(h as any).fetchError}`);
        md.push(`- **Signals**: ${s.signals.length ? s.signals.join('; ') : '_none_'}`);
        md.push(`- **Suggested**: client_type=\`${s.suggested_client_type_key || 'MANUAL'}\`, clinic=\`${s.suggested_clinic || '—'}\`, status=\`${s.suggested_status_key}\`, recurring=${s.is_recurring === null ? '?' : s.is_recurring}`);
        md.push(`- **Rule fired**: ${s.rule_fired}`);
        if (s.needs_manual_review) md.push(`- **🟡 NEEDS MANUAL REVIEW**`);
        md.push('');
    }

    const outPath = path.join(process.cwd(), '.tmp', `blank-patient-audit-${date}.md`);
    fs.writeFileSync(outPath, md.join('\n'));
    console.log(`\n[audit] Wrote ${outPath}`);
    console.log(`[audit] DONE — read-only.`);
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
