/* eslint-disable */
require('dotenv').config({ path: '/home/ec2-user/gmhdashboard/.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const HEALTHIE_URL = 'https://api.gethealthie.com/graphql';
const API_KEY = process.env.HEALTHIE_API_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gql(q, v) {
  const r = await fetch(HEALTHIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + API_KEY, 'AuthorizationSource': 'API' },
    body: JSON.stringify({ query: q, variables: v })
  });
  return await r.json();
}

const Q = `query($id: ID!) {
  appointments(user_id: $id, should_paginate: false, filter: "all") {
    appointment_type { name }
    date
  }
}`;

const PATIENTS = [
  // 6 PC + nowlongevity — disambiguate via appt types
  ['Brandon Boggs',     '15436598'],
  ['Heather Snyder',    '15542923'],
  ['Jacob Vinton',      '15596219'],
  ['Jodi Ellsworth',    '15402217'],
  ['Taylor Murphy',     '15555182'],
  // 4 hard-flag clinic vs dispense conflicts — pull for Phil's evidence
  ['Bob Walker',        '12765833'],
  ['Keira Gannon',      '12182730'],
  ['Jackie Miller',     '12165103'],
  ['Raul Martinez',     '12178886'],
];

(async () => {
  for (const [name, id] of PATIENTS) {
    process.stdout.write(`${name.padEnd(20)} `);
    const j = await gql(Q, { id });
    const appts = j.data?.appointments || [];
    const types = [...new Set(appts.map(a => a.appointment_type?.name).filter(Boolean))];
    console.log(`(${appts.length} appts) ${types.length ? types.join(' | ') : '(none)'}`);
    await sleep(1500);
  }
})();
