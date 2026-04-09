/**
 * Deep dive: Compare duplicate Healthie records for 9 patients.
 * For each pair, pull demographics, payment info, documents, appointments, billing items.
 * 1 request/sec to stay well under rate limits.
 */
import { getHealthieClient } from '../lib/healthie';

const healthie = getHealthieClient();
const apiKey = process.env.HEALTHIE_API_KEY!;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Raw GraphQL for deep comparison (more fields than getClient provides)
async function getFullPatient(id: string) {
  const response = await fetch('https://api.gethealthie.com/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${apiKey}`,
      'AuthorizationSource': 'API',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `query {
        user(id: "${id}") {
          id
          first_name
          last_name
          email
          phone_number
          dob
          gender
          active
          created_at
          updated_at
          user_group_id
          location {
            line1
            line2
            city
            state
            zip
          }
          stripe_customer_detail {
            card_brand
            last_four
            exp_month
            exp_year
          }
          policies {
            id
            name
            insurance_plan {
              payer_name
            }
          }
          tags {
            id
            name
          }
        }
      }`
    }),
  });
  const json = await response.json();
  return json?.data?.user || null;
}

async function getDocCount(id: string): Promise<number> {
  const response = await fetch('https://api.gethealthie.com/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${apiKey}`,
      'AuthorizationSource': 'API',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `query { documents(client_id: "${id}") { id } }`
    }),
  });
  const json = await response.json();
  return json?.data?.documents?.length || 0;
}

async function getBillingItems(id: string): Promise<any[]> {
  const response = await fetch('https://api.gethealthie.com/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${apiKey}`,
      'AuthorizationSource': 'API',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `query { billingItems(client_id: "${id}", offset: 0) { id amount_paid created_at offering { name billing_frequency } } }`
    }),
  });
  const json = await response.json();
  return json?.data?.billingItems || [];
}

async function getAppointments(id: string): Promise<number> {
  const response = await fetch('https://api.gethealthie.com/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${apiKey}`,
      'AuthorizationSource': 'API',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `query { appointments(user_id: "${id}", offset: 0) { id } }`
    }),
  });
  const json = await response.json();
  return json?.data?.appointments?.length || 0;
}

async function getFormAnswers(id: string): Promise<number> {
  const response = await fetch('https://api.gethealthie.com/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${apiKey}`,
      'AuthorizationSource': 'API',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `query { formAnswerGroups(custom_module_form_id: null, user_id: "${id}") { id } }`
    }),
  });
  const json = await response.json();
  return json?.data?.formAnswerGroups?.length || 0;
}

// All 26 active dashboard patients mapped to archived Healthie IDs
// For each, we need to find if there's ANOTHER active Healthie record for the same person
const patients = [
  { name: 'App Tester',         archived: '13648106', active: '' },
  { name: 'Brad Penner',        archived: '12765844', active: '' },
  { name: 'Brian Minor',        archived: '12743763', active: '12182579' },
  { name: 'Bruce French',       archived: '12745786', active: '12765861' },
  { name: 'Cole Johnson',       archived: '12177460', active: '12744193' },
  { name: 'Dale Potter',        archived: '12209123', active: '' },
  { name: 'Donavon Connor',     archived: '12182142', active: '12746762' },
  { name: 'Dominic Milano',     archived: '12208928', active: '' },
  { name: 'Eric Foster',        archived: '12765875', active: '' },
  { name: 'Eric Schroeter',     archived: '12182981', active: '' },
  { name: 'Jakob Woods',        archived: '12182751', active: '12743531' },
  { name: 'Jesus Hurtado',      archived: '12177877', active: '' },
  { name: 'John Doe2',          archived: '13568112', active: '' },
  { name: 'John Stonecipher',   archived: '12183142', active: '' },
  { name: 'Josh Straight',      archived: '12694147', active: '' },
  { name: 'Katie Larson',       archived: '12212054', active: '' },
  { name: 'Keira Gannon',       archived: '12182730', active: '12746078' },
  { name: 'Kenneth Holley',     archived: '12743119', active: '12165146' },
  { name: 'Kevin Hilton',       archived: '12181690', active: '' },
  { name: 'Larry Dorrell',      archived: '12178454', active: '12743526' },
  { name: 'Lynn Ragels',        archived: '12747089', active: '' },
  { name: 'Margaret Maneely',   archived: '12746808', active: '' },
  { name: 'Michele Meyer',      archived: '12743303', active: '' },
  { name: 'Michelle Fox',       archived: '12745662', active: '' },
  { name: 'Mike Kuenzi',        archived: '12182280', active: '' },
  { name: 'Nick Scanlan',       archived: '12743406', active: '12180012' },
  { name: 'Nikolai Freemyer',   archived: '12177176', active: '' },
  { name: 'Phil Joswiak',       archived: '13115382', active: '' },
  { name: 'Randy Schafer',      archived: '12183151', active: '' },
  { name: 'Robert Simpson',     archived: '12182413', active: '' },
  { name: 'Seth Jesson',        archived: '12744145', active: '' },
  { name: 'Shawn Antrim',       archived: '12183034', active: '' },
  { name: 'Tracy Byam',         archived: '12745340', active: '' },
  { name: 'Tyler Ellsworth',    archived: '12177203', active: '' },
  { name: 'Webb Wartelle',      archived: '12182401', active: '12742342' },
];

async function searchByName(name: string): Promise<any[]> {
  const response = await fetch('https://api.gethealthie.com/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${apiKey}`,
      'AuthorizationSource': 'API',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `query { users(keywords: "${name}", offset: 0, active_status: "Active", sort_by: "LAST_NAME_ASC") { id first_name last_name email active } }`
    }),
  });
  const json = await response.json();
  return json?.data?.users || [];
}

(async () => {
  // First pass: for patients without a known active ID, search Healthie for an active match
  for (const p of patients) {
    if (!p.active) {
      const results = await searchByName(p.name);
      await sleep(1000);
      if (results.length > 0) {
        // Find best match (same name, active)
        const match = results.find((r: any) => r.active && r.id !== p.archived);
        if (match) {
          p.active = match.id;
          console.log(`[Search] ${p.name}: found active Healthie match ${match.id} (${match.first_name} ${match.last_name})`);
        } else {
          console.log(`[Search] ${p.name}: NO active Healthie match found — only archived record exists`);
        }
      } else {
        console.log(`[Search] ${p.name}: no Healthie results at all`);
      }
    }
  }

  for (const p of patients) {
    console.log(`\n${'='.repeat(100)}`);
    console.log(`  ${p.name.toUpperCase()}`);
    console.log(`${'='.repeat(100)}`);

    // Fetch data for archived record
    const archivedUser = await getFullPatient(p.archived); await sleep(1000);

    // If no active ID found, report and skip comparison
    if (!p.active) {
      console.log(`  ARCHIVED (${p.archived}) — NO ACTIVE DUPLICATE FOUND`);
      console.log(`  This patient only has an archived Healthie record.`);
      console.log(`  Forms: ${await getFormAnswers(p.archived)}, Billing: ${(await getBillingItems(p.archived)).length}`);
      await sleep(2000);
      console.log(`\n  RECOMMENDATION:`);
      console.log(`  >>> REACTIVATE archived record ${p.archived} in Healthie, or create new active record and remap dashboard.`);
      continue;
    }

    const activeUser = await getFullPatient(p.active); await sleep(1000);
    const archivedDocs = await getDocCount(p.archived); await sleep(1000);
    const activeDocs = await getDocCount(p.active); await sleep(1000);
    const archivedBilling = await getBillingItems(p.archived); await sleep(1000);
    const activeBilling = await getBillingItems(p.active); await sleep(1000);
    const archivedAppts = await getAppointments(p.archived); await sleep(1000);
    const activeAppts = await getAppointments(p.active); await sleep(1000);
    const archivedForms = await getFormAnswers(p.archived); await sleep(1000);
    const activeForms = await getFormAnswers(p.active); await sleep(1000);

    const fmt = (label: string, a: string, b: string) => {
      const flag = a !== b ? ' <<<' : '';
      console.log(`  ${label.padEnd(22)} ${(a || '—').padEnd(38)} ${(b || '—')}${flag}`);
    };

    console.log(`  ${''.padEnd(22)} ${'ARCHIVED (' + p.archived + ')'.padEnd(38)} ACTIVE (${p.active})`);
    console.log(`  ${'-'.repeat(98)}`);
    fmt('Name',
      `${archivedUser?.first_name} ${archivedUser?.last_name}`,
      `${activeUser?.first_name} ${activeUser?.last_name}`);
    fmt('Email', archivedUser?.email, activeUser?.email);
    fmt('Phone', archivedUser?.phone_number, activeUser?.phone_number);
    fmt('DOB', archivedUser?.dob, activeUser?.dob);
    fmt('Gender', archivedUser?.gender, activeUser?.gender);
    fmt('Active?', String(archivedUser?.active), String(activeUser?.active));
    fmt('Created', archivedUser?.created_at?.substring(0, 10), activeUser?.created_at?.substring(0, 10));
    fmt('Updated', archivedUser?.updated_at?.substring(0, 10), activeUser?.updated_at?.substring(0, 10));
    fmt('Group ID', archivedUser?.user_group_id, activeUser?.user_group_id);

    const aLoc = archivedUser?.location;
    const bLoc = activeUser?.location;
    fmt('Address',
      aLoc ? [aLoc.line1, aLoc.city, aLoc.state, aLoc.zip].filter(Boolean).join(', ') : '—',
      bLoc ? [bLoc.line1, bLoc.city, bLoc.state, bLoc.zip].filter(Boolean).join(', ') : '—');

    const aCard = archivedUser?.stripe_customer_detail;
    const bCard = activeUser?.stripe_customer_detail;
    fmt('Card on File',
      aCard?.last_four ? `${aCard.card_brand || 'Card'} ****${aCard.last_four} (${aCard.exp_month}/${aCard.exp_year})` : 'NONE',
      bCard?.last_four ? `${bCard.card_brand || 'Card'} ****${bCard.last_four} (${bCard.exp_month}/${bCard.exp_year})` : 'NONE');

    fmt('Tags',
      (archivedUser?.tags || []).map((t: any) => t.name).join(', ') || '—',
      (activeUser?.tags || []).map((t: any) => t.name).join(', ') || '—');

    fmt('Insurance',
      (archivedUser?.policies || []).map((p: any) => p.insurance_plan?.payer_name || p.name).join(', ') || '—',
      (activeUser?.policies || []).map((p: any) => p.insurance_plan?.payer_name || p.name).join(', ') || '—');

    fmt('Documents', String(archivedDocs), String(activeDocs));
    fmt('Appointments', String(archivedAppts), String(activeAppts));
    fmt('Form Answers', String(archivedForms), String(activeForms));
    fmt('Billing Items', String(archivedBilling.length), String(activeBilling.length));

    // Billing detail
    if (archivedBilling.length > 0) {
      console.log(`\n  Archived billing detail:`);
      for (const b of archivedBilling.slice(0, 5)) {
        console.log(`    $${b.amount_paid || '?'} — ${b.offering?.name || 'unknown'} (${b.offering?.billing_frequency || '?'}) — ${b.created_at?.substring(0, 10)}`);
      }
      if (archivedBilling.length > 5) console.log(`    ... +${archivedBilling.length - 5} more`);
    }
    if (activeBilling.length > 0) {
      console.log(`\n  Active billing detail:`);
      for (const b of activeBilling.slice(0, 5)) {
        console.log(`    $${b.amount_paid || '?'} — ${b.offering?.name || 'unknown'} (${b.offering?.billing_frequency || '?'}) — ${b.created_at?.substring(0, 10)}`);
      }
      if (activeBilling.length > 5) console.log(`    ... +${activeBilling.length - 5} more`);
    }

    // Recommendation
    const activeHasCard = !!bCard?.last_four;
    const archivedHasCard = !!aCard?.last_four;
    const activeHasMoreData = (activeDocs + activeAppts + activeForms + activeBilling.length) >= (archivedDocs + archivedAppts + archivedForms + archivedBilling.length);

    console.log(`\n  RECOMMENDATION:`);
    if (activeHasCard && activeHasMoreData) {
      console.log(`  >>> KEEP ACTIVE (${p.active}) — has card + more data. Remap labs and leave archived alone.`);
    } else if (archivedHasCard && !activeHasCard) {
      console.log(`  >>> ⚠️  ARCHIVED has card but ACTIVE does not. Need to move payment method before remapping.`);
    } else if (!activeHasMoreData) {
      console.log(`  >>> ⚠️  ARCHIVED has more data. Review carefully — may need to migrate data before remapping.`);
    } else {
      console.log(`  >>> KEEP ACTIVE (${p.active}) — remap labs. Archived has no card or meaningful data advantage.`);
    }
  }

  console.log(`\n${'='.repeat(100)}`);
  console.log('AUDIT COMPLETE');
  console.log(`${'='.repeat(100)}\n`);
  process.exit(0);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
