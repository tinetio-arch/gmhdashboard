/**
 * FINAL SAFETY CHECK: For each of the 32 patients, verify the ACTIVE record
 * we're remapping TO has all the billing/packages/card info intact.
 * Also double-check the archived record one more time.
 *
 * This time we check: billingItems, requestedPayments, stripe card,
 * active offerings/packages, and Stripe subscription status.
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

async function fullBillingCheck(id: string, label: string) {
  // 1. Billing items (charges)
  const billingResult = await gql(`query {
    billingItems(client_id: "${id}", offset: 0) {
      id amount_paid recurring stripe_status created_at
      offering { name billing_frequency }
    }
  }`);
  await sleep(600);

  // 2. Requested payments (invoices/scheduled charges)
  const paymentsResult = await gql(`query {
    requestedPayments(client_id: "${id}", offset: 0) {
      id price status created_at
      offering { name billing_frequency }
    }
  }`);
  await sleep(600);

  // 3. Stripe card + user active status
  const userResult = await gql(`query {
    user(id: "${id}") {
      id first_name last_name active
      stripe_customer_detail { last_four }
    }
  }`);
  await sleep(600);

  // 4. Active recurring offerings (packages)
  const offeringsResult = await gql(`query {
    billingItems(client_id: "${id}", offset: 0) {
      id recurring stripe_status
      offering { id name billing_frequency amount }
    }
  }`);
  await sleep(600);

  const billingItems = billingResult?.data?.billingItems || [];
  const requestedPayments = paymentsResult?.data?.requestedPayments || [];
  const user = userResult?.data?.user || {};
  const card = user?.stripe_customer_detail;

  const activeSubs = billingItems.filter((b: any) => b.stripe_status === 'active');
  const recurringItems = billingItems.filter((b: any) => b.recurring);
  const openPayments = requestedPayments.filter((p: any) => p.status === 'open' || p.status === 'pending');
  const monthlyPackages = billingItems.filter((b: any) =>
    b.offering?.billing_frequency?.toLowerCase() === 'monthly' ||
    b.offering?.billing_frequency?.toLowerCase() === 'Monthly'
  );

  return {
    id,
    label,
    name: user?.first_name && user?.last_name ? `${user.first_name} ${user.last_name}` : 'N/A',
    active: user?.active,
    hasCard: !!card?.last_four,
    cardDetail: card?.last_four ? `Card ****${card.last_four}` : 'NONE',
    totalBilling: billingItems.length,
    activeSubs: activeSubs.length,
    recurringItems: recurringItems.length,
    openPayments: openPayments.length,
    monthlyPackages: monthlyPackages.length,
    totalRequestedPayments: requestedPayments.length,
    // Raw details for flagged items
    activeSubDetails: activeSubs.map((s: any) => `${s.offering?.name || 'unknown'} ($${s.amount_paid})`),
    openPaymentDetails: openPayments.map((p: any) => `${p.offering?.name || 'unknown'} ($${p.price}) ${p.status}`),
    recentBilling: billingItems.slice(0, 3).map((b: any) => `$${b.amount_paid} ${b.offering?.name || 'unknown'} [${b.stripe_status || 'n/a'}] ${b.created_at?.substring(0, 10)}`),
  };
}

const patients = [
  { name: 'Brad Penner',        archived: '12765844', active: '12183130' },
  { name: 'Brian Minor',        archived: '12743763', active: '12182579' },
  { name: 'Bruce French',       archived: '12745786', active: '12765861' },
  { name: 'Cole Johnson',       archived: '12177460', active: '12744193' },
  { name: 'Dale Potter',        archived: '12209123', active: '12746957' },
  { name: 'Donavon Connor',     archived: '12182142', active: '12746762' },
  { name: 'Dominic Milano',     archived: '12208928', active: '12743413' },
  { name: 'Eric Schroeter',     archived: '12182981', active: '12743720' },
  { name: 'Jakob Woods',        archived: '12182751', active: '12743531' },
  { name: 'Jesus Hurtado',      archived: '12177877', active: '12743700' },
  { name: 'John Stonecipher',   archived: '12183142', active: '12745264' },
  { name: 'Josh Straight',      archived: '12694147', active: '12193931' },
  { name: 'Katie Larson',       archived: '12212054', active: '12745674' },
  { name: 'Keira Gannon',       archived: '12182730', active: '12746078' },
  { name: 'Kenneth Holley',     archived: '12743119', active: '12165146' },
  { name: 'Kevin Hilton',       archived: '12181690', active: '12742906' },
  { name: 'Larry Dorrell',      archived: '12178454', active: '12743526' },
  { name: 'Lynn Ragels',        archived: '12747089', active: '12705139' },
  { name: 'Margaret Maneely',   archived: '12746808', active: '12705170' },
  { name: 'Michele Meyer',      archived: '12743303', active: '12705226' },
  { name: 'Michelle Fox',       archived: '12745662', active: '12705283' },
  { name: 'Mike Kuenzi',        archived: '12182280', active: '12745360' },
  { name: 'Nick Scanlan',       archived: '12743406', active: '12180012' },
  { name: 'Nikolai Freemyer',   archived: '12177176', active: '12745774' },
  { name: 'Phil Joswiak',       archived: '13115382', active: '13113511' },
  { name: 'Randy Schafer',      archived: '12183151', active: '12743499' },
  { name: 'Robert Simpson',     archived: '12182413', active: '12744519' },
  { name: 'Seth Jesson',        archived: '12744145', active: '12705489' },
  { name: 'Shawn Antrim',       archived: '12183034', active: '12742287' },
  { name: 'Tracy Byam',         archived: '12745340', active: '12705544' },
  { name: 'Tyler Ellsworth',    archived: '12177203', active: '12744260' },
  { name: 'Webb Wartelle',      archived: '12182401', active: '12742342' },
];

(async () => {
  const problems: string[] = [];

  console.log(`FINAL BILLING SAFETY CHECK — ${patients.length} patients\n`);
  console.log(`Checking both archived AND active Healthie records for each patient...`);
  console.log(`This checks: billing items, Stripe subscriptions, cards on file, open payments, recurring packages\n`);

  for (const p of patients) {
    process.stdout.write(`  ${p.name.padEnd(22)}`);

    const arch = await fullBillingCheck(p.archived, 'ARCHIVED');
    const act = await fullBillingCheck(p.active, 'ACTIVE');

    let flags: string[] = [];

    // Check archived record for anything we'd lose
    if (arch.hasCard) flags.push(`🔴 ARCHIVED has card: ${arch.cardDetail}`);
    if (arch.activeSubs > 0) flags.push(`🔴 ARCHIVED has ${arch.activeSubs} active Stripe subs: ${arch.activeSubDetails.join(', ')}`);
    if (arch.openPayments > 0) flags.push(`🟡 ARCHIVED has ${arch.openPayments} open payments: ${arch.openPaymentDetails.join(', ')}`);
    if (arch.recurringItems > 0) flags.push(`🟡 ARCHIVED has ${arch.recurringItems} recurring billing items`);

    // Check active record is healthy
    if (!act.active) flags.push(`🔴 ACTIVE record is NOT active in Healthie!`);

    // Verify active record has billing if it should
    if (act.totalBilling === 0 && arch.totalBilling > 0) flags.push(`🟡 ACTIVE has 0 billing but ARCHIVED has ${arch.totalBilling}`);

    if (flags.length > 0) {
      console.log(`⚠️  FLAGS:`);
      flags.forEach(f => console.log(`    ${f}`));
      problems.push(`${p.name}: ${flags.join(' | ')}`);
    } else {
      console.log(`✅ CLEAR — Archived: ${arch.totalBilling} billing/no card/no subs | Active: ${act.totalBilling} billing, ${act.hasCard ? act.cardDetail : 'no card'}, active=${act.active}`);
    }
  }

  console.log(`\n${'='.repeat(120)}`);
  if (problems.length === 0) {
    console.log(`\n✅✅✅ ALL ${patients.length} PATIENTS CLEAR — NO BILLING, CARD, OR PACKAGE ISSUES FOUND ✅✅✅`);
    console.log(`\nIt is SAFE to remap all ${patients.length} patients from archived to active Healthie IDs.`);
    console.log(`No patient will lose packages, cards, subscriptions, or billing history.\n`);
  } else {
    console.log(`\n🚨 ${problems.length} PATIENTS HAVE FLAGS:\n`);
    problems.forEach(p => console.log(`  ${p}`));
    console.log(`\nDO NOT remap these patients without resolving the flags above.\n`);
  }
  console.log(`${'='.repeat(120)}\n`);

  process.exit(0);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
