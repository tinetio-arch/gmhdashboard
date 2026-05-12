import fs from 'node:fs';

const env = fs.readFileSync('.env.local', 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;

async function gql(query, variables = {}) {
  const r = await fetch(HEALTHIE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${HEALTHIE_API_KEY}`,
      AuthorizationSource: 'API',
    },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
}

const userQ = `query U($id: ID) {
  user(id: $id) {
    id full_name email phone_number dob archived_at
    stripe_customer_detail { card_brand last_four exp_month exp_year }
  }
}`;

const billingQ = `query BI($clientId: ID) {
  billingItems(client_id: $clientId, offset: 0) {
    id amount_paid_string state created_at is_recurring shown_description
    offering { id name price billing_frequency }
    recurring_payment { id is_canceled is_paused start_at amount_to_pay next_payment_date }
  }
}`;

for (const id of ['12212961', '12741471']) {
  console.log(`\n=== Healthie user ${id} ===`);
  const u = await gql(userQ, { id });
  console.log('USER:', JSON.stringify(u.data?.user, null, 2));
  if (u.errors) console.log('user errors:', JSON.stringify(u.errors));
  const b = await gql(billingQ, { clientId: id });
  const items = b.data?.billingItems || [];
  const subs = new Map();
  for (const it of items) {
    const rp = it.recurring_payment;
    if (rp && !subs.has(rp.id)) subs.set(rp.id, { rp, offering: it.offering });
  }
  console.log(`Recurring subs: ${subs.size}`);
  for (const [rid, s] of subs) {
    console.log(`  - rp=${rid} offering="${s.offering?.name}" amount=${s.rp.amount_to_pay} freq=${s.offering?.billing_frequency} canceled=${s.rp.is_canceled} paused=${s.rp.is_paused} next=${s.rp.next_payment_date}`);
  }
  if (b.errors) console.log('billing errors:', JSON.stringify(b.errors));
}
