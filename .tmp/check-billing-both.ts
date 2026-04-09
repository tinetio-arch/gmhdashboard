/**
 * Check billing/package status on BOTH archived and active Healthie records
 * for all 26 patients. Looking for active subscriptions that could break.
 */
const apiKey = process.env.HEALTHIE_API_KEY!;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function gql(query: string) {
  const response = await fetch('https://api.gethealthie.com/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${apiKey}`,
      'AuthorizationSource': 'API',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  return response.json();
}

async function getRecurringBilling(id: string) {
  const result = await gql(`query {
    billingItems(client_id: "${id}", offset: 0) {
      id
      amount_paid
      created_at
      recurring
      stripe_status
      offering {
        name
        billing_frequency
      }
    }
  }`);
  return result?.data?.billingItems || [];
}

async function getRequestedPayments(id: string) {
  const result = await gql(`query {
    requestedPayments(client_id: "${id}", offset: 0, status: "open") {
      id
      price
      status
      created_at
      offering {
        name
        billing_frequency
      }
    }
  }`);
  return result?.data?.requestedPayments || [];
}

async function getStripeInfo(id: string) {
  const result = await gql(`query {
    user(id: "${id}") {
      id
      first_name
      last_name
      active
      stripe_customer_detail {
        card_brand
        last_four
        exp_month
        exp_year
      }
    }
  }`);
  return result?.data?.user || null;
}

// All 26 patients: dashboard is currently pointing to "current" (archived) ID
// "correct" is the active Healthie record we'd remap to
const patients = [
  { name: 'App Tester',         current: '13648106', correct: '' },
  { name: 'Brad Penner',        current: '12765844', correct: '12183130' },
  { name: 'Brian Minor',        current: '12743763', correct: '12182579' },
  { name: 'Bruce French',       current: '12745786', correct: '12765861' },
  { name: 'Cole Johnson',       current: '12177460', correct: '12744193' },
  { name: 'Dale Potter',        current: '12209123', correct: '12746957' },
  { name: 'Donavon Connor',     current: '12182142', correct: '12746762' },
  { name: 'Dominic Milano',     current: '12208928', correct: '12743413' },
  { name: 'Eric Foster',        current: '12765875', correct: '' },
  { name: 'Eric Schroeter',     current: '12182981', correct: '12743720' },
  { name: 'Jakob Woods',        current: '12182751', correct: '12743531' },
  { name: 'Jesus Hurtado',      current: '12177877', correct: '12743700' },
  { name: 'John Doe2',          current: '13568112', correct: '' },
  { name: 'John Stonecipher',   current: '12183142', correct: '12745264' },
  { name: 'Josh Straight',      current: '12694147', correct: '12193931' },
  { name: 'Katie Larson',       current: '12212054', correct: '12745674' },
  { name: 'Keira Gannon',       current: '12182730', correct: '12746078' },
  { name: 'Kenneth Holley',     current: '12743119', correct: '12165146' },
  { name: 'Kevin Hilton',       current: '12181690', correct: '12742906' },
  { name: 'Larry Dorrell',      current: '12178454', correct: '12743526' },
  { name: 'Lynn Ragels',        current: '12747089', correct: '12705139' },
  { name: 'Margaret Maneely',   current: '12746808', correct: '12705170' },
  { name: 'Michele Meyer',      current: '12743303', correct: '12705226' },
  { name: 'Michelle Fox',       current: '12745662', correct: '12705283' },
  { name: 'Mike Kuenzi',        current: '12182280', correct: '12745360' },
  { name: 'Nick Scanlan',       current: '12743406', correct: '12180012' },
  { name: 'Nikolai Freemyer',   current: '12177176', correct: '12745774' },
  { name: 'Phil Joswiak',       current: '13115382', correct: '13113511' },
  { name: 'Randy Schafer',      current: '12183151', correct: '12743499' },
  { name: 'Robert Simpson',     current: '12182413', correct: '12744519' },
  { name: 'Seth Jesson',        current: '12744145', correct: '12705489' },
  { name: 'Shawn Antrim',       current: '12183034', correct: '12742287' },
  { name: 'Tracy Byam',         current: '12745340', correct: '12705544' },
  { name: 'Tyler Ellsworth',    current: '12177203', correct: '12744260' },
  { name: 'Webb Wartelle',      current: '12182401', correct: '12742342' },
];

(async () => {
  const issues: string[] = [];
  const safe: string[] = [];

  console.log('Checking billing status for all patients...\n');

  for (const p of patients) {
    process.stdout.write(`  ${p.name}...`);

    // Check archived (current) record
    const archivedBilling = await getRecurringBilling(p.current); await sleep(800);
    const archivedPayments = await getRequestedPayments(p.current); await sleep(800);
    const archivedUser = await getStripeInfo(p.current); await sleep(800);

    const archivedRecurring = archivedBilling.filter((b: any) => b.recurring || b.offering?.billing_frequency === 'monthly' || b.offering?.billing_frequency === 'Monthly');
    const archivedActiveSubscriptions = archivedBilling.filter((b: any) => b.stripe_status === 'active');
    const archivedCard = archivedUser?.stripe_customer_detail?.last_four;
    const archivedOpenPayments = archivedPayments.length;

    let correctBilling: any[] = [];
    let correctPayments: any[] = [];
    let correctUser: any = null;
    let correctCard: string | null = null;
    let correctActiveSubscriptions: any[] = [];

    if (p.correct) {
      correctBilling = await getRecurringBilling(p.correct); await sleep(800);
      correctPayments = await getRequestedPayments(p.correct); await sleep(800);
      correctUser = await getStripeInfo(p.correct); await sleep(800);
      correctCard = correctUser?.stripe_customer_detail?.last_four || null;
      correctActiveSubscriptions = correctBilling.filter((b: any) => b.stripe_status === 'active');
    }

    // Determine risk
    const hasArchivedCard = !!archivedCard;
    const hasArchivedActiveSub = archivedActiveSubscriptions.length > 0;
    const hasArchivedOpenPayments = archivedOpenPayments > 0;
    const hasCorrectCard = !!correctCard;
    const hasCorrectActiveSub = correctActiveSubscriptions.length > 0;

    let status = '';
    let isIssue = false;

    if (hasArchivedActiveSub) {
      status = `🔴 ARCHIVED HAS ACTIVE SUBSCRIPTION — will lose billing if remapped!`;
      isIssue = true;
    } else if (hasArchivedCard && !hasCorrectCard) {
      status = `🟡 ARCHIVED has card (****${archivedCard}), ACTIVE has NO card — payment method at risk`;
      isIssue = true;
    } else if (hasArchivedOpenPayments) {
      status = `🟡 ARCHIVED has ${archivedOpenPayments} open/pending payments`;
      isIssue = true;
    } else if (!p.correct) {
      status = `⚪ No active record — needs reactivation`;
      isIssue = true;
    } else {
      status = `✅ Safe to remap`;
    }

    const line = `${p.name.padEnd(22)} | Archived(${p.current}): ${archivedBilling.length} billing, ${archivedCard ? '****' + archivedCard : 'no card'}, ${archivedActiveSubscriptions.length} active subs, ${archivedOpenPayments} open pmts | Active(${p.correct || 'NONE'}): ${correctBilling.length} billing, ${correctCard ? '****' + correctCard : 'no card'}, ${correctActiveSubscriptions.length} active subs | ${status}`;

    if (isIssue) {
      issues.push(line);
    } else {
      safe.push(line);
    }

    console.log(` ${status}`);
  }

  console.log(`\n${'='.repeat(120)}`);
  console.log('BILLING SAFETY REPORT');
  console.log(`${'='.repeat(120)}`);

  if (issues.length > 0) {
    console.log(`\n🚨 ISSUES (${issues.length}) — DO NOT REMAP WITHOUT RESOLVING:\n`);
    issues.forEach(i => console.log(`  ${i}`));
  }

  console.log(`\n✅ SAFE TO REMAP (${safe.length}):\n`);
  safe.forEach(s => console.log(`  ${s}`));

  console.log(`\n${'='.repeat(120)}`);
  console.log(`TOTAL: ${safe.length} safe, ${issues.length} need attention`);
  console.log(`${'='.repeat(120)}\n`);

  process.exit(0);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
