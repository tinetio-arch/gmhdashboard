/* eslint-disable */
require('dotenv').config({ path: '/home/ec2-user/gmhdashboard/.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const HEALTHIE_URL = 'https://api.gethealthie.com/graphql';
const API_KEY = process.env.HEALTHIE_API_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gql(query, variables) {
  const r = await fetch(HEALTHIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + API_KEY, 'AuthorizationSource': 'API' },
    body: JSON.stringify({ query, variables })
  });
  return await r.json();
}

const PATIENTS = [
  ['David Bandy',          '12743210'],
  ['Heather Ramirez',      '12747095'],
  ['Jessica Leick',        '14561291'],
  ['Jesus Cris Acosta',    '12741471'],
  ['Jordan Miller',        '12743575'],
  ['Paul Peterson',        '14420645'],
  ['Stan Goligoski',       '12746619'],
  ['Susan Crane',          '12741767'],
  ['Susan Krause',         '12745281'],
  ['Tamara Yount',         '12743826'],
  ['Tiffany Boehle',       '12744129'],
];

// Try richer fields incl. group_name + active/archived
const Q = `
  query($id: ID!) {
    user(id: $id) {
      id
      first_name
      last_name
      email
      gender
      group_name
      user_group { name }
      active
      archived_at
      patient_tags { id name }
    }
  }
`;

(async () => {
  for (const [name, id] of PATIENTS) {
    process.stdout.write(`${name.padEnd(25)} (${id}) … `);
    const j = await gql(Q, { id });
    if (j.errors) {
      console.log('ERR:', JSON.stringify(j.errors).slice(0,150));
    } else {
      const u = j.data?.user;
      if (!u) { console.log('no user returned'); }
      else {
        const tags = (u.patient_tags || []).map(t => t.name).join('|') || '—';
        console.log(`group_name=${u.group_name||'—'} | user_group=${u.user_group?.name||'—'} | tags=${tags} | gender=${u.gender||'?'} | active=${u.active} | archived=${u.archived_at||'no'}`);
      }
    }
    await sleep(1500);
  }
})();
