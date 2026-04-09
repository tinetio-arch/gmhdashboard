/**
 * Audit: Check Healthie active/archived status for all linked dashboard patients.
 * CONSERVATIVE: 1 request per second to avoid rate limits (Healthie limit is 5/s).
 */
import { query } from '../lib/db';
import { getHealthieClient } from '../lib/healthie';

interface PatientRow {
  patient_id: string;
  full_name: string;
  email: string | null;
  phone_primary: string | null;
  healthie_client_id: string;
  status_key: string | null;
}

interface AuditResult {
  dashboardName: string;
  dashboardStatus: string;
  healthieId: string;
  healthieName: string;
  healthieActive: boolean;
  healthieEmail: string;
  mismatch: boolean;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const healthie = getHealthieClient();

  // Get only ACTIVE dashboard patients with Healthie links
  const patients = await query<PatientRow>(`
    SELECT patient_id, full_name, email, phone_primary, healthie_client_id, status_key
    FROM patients
    WHERE healthie_client_id IS NOT NULL AND healthie_client_id != ''
      AND status_key IN ('active', 'active_pending')
    ORDER BY full_name
  `);

  // Deduplicate by Healthie ID
  const uniqueMap = new Map<string, PatientRow[]>();
  for (const p of patients) {
    if (!uniqueMap.has(p.healthie_client_id)) uniqueMap.set(p.healthie_client_id, []);
    uniqueMap.get(p.healthie_client_id)!.push(p);
  }

  const uniqueIds = [...uniqueMap.keys()];
  console.log(`Dashboard patients with Healthie links: ${patients.length}`);
  console.log(`Unique Healthie IDs to check: ${uniqueIds.length}`);
  console.log(`Estimated time: ~${Math.ceil(uniqueIds.length / 1)} seconds (1 req/s)\n`);

  const archived: AuditResult[] = [];
  const notFound: Array<{ healthieId: string; patients: PatientRow[] }> = [];
  const nameMismatches: AuditResult[] = [];
  const errors: Array<{ healthieId: string; error: string; patients: PatientRow[] }> = [];
  let checkedCount = 0;

  for (const hid of uniqueIds) {
    try {
      const client = await healthie.getClient(hid);

      if (!client) {
        notFound.push({ healthieId: hid, patients: uniqueMap.get(hid)! });
      } else {
        const healthieName = `${client.first_name} ${client.last_name}`.trim();
        const dashPatients = uniqueMap.get(hid)!;

        for (const dp of dashPatients) {
          const result: AuditResult = {
            dashboardName: dp.full_name,
            dashboardStatus: dp.status_key || 'null',
            healthieId: hid,
            healthieName,
            healthieActive: !!client.active,
            healthieEmail: client.email || '',
            mismatch: false,
          };

          // Check for archived in Healthie
          if (!client.active) {
            archived.push(result);
          }

          // Check for name mismatch (potential wrong mapping)
          const dName = dp.full_name.toLowerCase().replace(/[^a-z]/g, '');
          const hName = healthieName.toLowerCase().replace(/[^a-z]/g, '');
          if (dName !== hName && !dName.includes(hName) && !hName.includes(dName)) {
            result.mismatch = true;
            nameMismatches.push(result);
          }
        }
      }
    } catch (e: any) {
      const msg = e.message || String(e);
      if (msg.includes('429') || msg.includes('rate')) {
        console.log(`\n⚠️  Rate limited at request ${checkedCount + 1}. Pausing 30s...`);
        await sleep(30000);
        // Skip this one rather than risk more issues
        errors.push({ healthieId: hid, error: 'Rate limited — skipped', patients: uniqueMap.get(hid)! });
      } else {
        errors.push({ healthieId: hid, error: msg, patients: uniqueMap.get(hid)! });
      }
    }

    checkedCount++;
    if (checkedCount % 25 === 0) {
      console.log(`  Progress: ${checkedCount}/${uniqueIds.length}`);
    }

    // 1 request per second — conservative
    await sleep(1000);
  }

  // === REPORT ===
  console.log(`\n${'='.repeat(110)}`);
  console.log('HEALTHIE PATIENT AUDIT RESULTS');
  console.log(`${'='.repeat(110)}`);

  if (archived.length > 0) {
    console.log(`\n🟡 ARCHIVED IN HEALTHIE (${archived.length}) — These patients are deactivated in Healthie but linked in dashboard:`);
    console.log('─'.repeat(110));
    console.log('  Dashboard Name'.padEnd(32) + 'Dash Status'.padEnd(20) + 'Healthie ID'.padEnd(14) + 'Healthie Name'.padEnd(30) + 'Healthie Email');
    console.log('─'.repeat(110));
    for (const a of archived) {
      console.log(
        `  ${a.dashboardName.padEnd(30)} ${a.dashboardStatus.padEnd(20)} ${a.healthieId.padEnd(14)} ${a.healthieName.padEnd(30)} ${a.healthieEmail}`
      );
    }
  } else {
    console.log('\n✅ No archived Healthie patients found.');
  }

  if (nameMismatches.length > 0) {
    console.log(`\n🔴 NAME MISMATCHES (${nameMismatches.length}) — Dashboard name doesn't match Healthie name (possible wrong mapping):`);
    console.log('─'.repeat(110));
    console.log('  Dashboard Name'.padEnd(32) + 'Healthie Name'.padEnd(32) + 'Healthie ID'.padEnd(14) + 'Active?'.padEnd(10) + 'Healthie Email');
    console.log('─'.repeat(110));
    for (const m of nameMismatches) {
      console.log(
        `  ${m.dashboardName.padEnd(30)} ${m.healthieName.padEnd(32)} ${m.healthieId.padEnd(14)} ${(m.healthieActive ? 'yes' : 'NO').padEnd(10)} ${m.healthieEmail}`
      );
    }
  } else {
    console.log('\n✅ No name mismatches found.');
  }

  if (notFound.length > 0) {
    console.log(`\n⚠️  NOT FOUND IN HEALTHIE (${notFound.length}) — Healthie ID returned no data:`);
    console.log('─'.repeat(110));
    for (const nf of notFound) {
      for (const p of nf.patients) {
        console.log(`  ${p.full_name.padEnd(30)} Healthie ID: ${nf.healthieId}  Dash Status: ${p.status_key || 'null'}`);
      }
    }
  }

  if (errors.length > 0) {
    console.log(`\n⚠️  LOOKUP ERRORS (${errors.length}):`);
    for (const e of errors) {
      const names = e.patients.map(p => p.full_name).join(', ');
      console.log(`  Healthie ID: ${e.healthieId} (${names}) → ${e.error.substring(0, 80)}`);
    }
  }

  console.log(`\n${'='.repeat(110)}`);
  console.log('TOTALS:');
  console.log(`  Checked: ${checkedCount}/${uniqueIds.length}`);
  console.log(`  Archived in Healthie: ${archived.length}`);
  console.log(`  Name mismatches: ${nameMismatches.length}`);
  console.log(`  Not found: ${notFound.length}`);
  console.log(`  Errors: ${errors.length}`);
  console.log(`${'='.repeat(110)}\n`);

  process.exit(0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
