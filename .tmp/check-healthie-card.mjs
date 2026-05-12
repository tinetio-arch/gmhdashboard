import fs from 'node:fs';
const env = fs.readFileSync('.env.local', 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const URL = 'https://api.gethealthie.com/graphql';
const KEY = process.env.HEALTHIE_API_KEY;
async function gql(query, variables = {}) {
  const r = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Basic ${KEY}`, AuthorizationSource: 'API' }, body: JSON.stringify({ query, variables }) });
  return r.json();
}
const q = `query U($id: ID) { user(id: $id) { id full_name email phone_number dob archived_at stripe_customer_detail { last_four } } }`;
for (const id of ['12212961', '12741471']) {
  const r = await gql(q, { id });
  console.log(`Healthie ${id}:`, JSON.stringify(r.data?.user || r.errors));
}
