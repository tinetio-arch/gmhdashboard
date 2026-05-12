/* eslint-disable */
/**
 * Deep-dive on the 11 skipped patients — pull Healthie group_name, tags,
 * and packages so we can classify them too. Read-only.
 */

require('dotenv').config({ path: '/home/ec2-user/gmhdashboard/.env.local' });
const { Pool } = require('pg');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const HEALTHIE_URL = 'https://api.gethealthie.com/graphql';
const API_KEY = process.env.HEALTHIE_API_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gql(query, variables) {
  const r = await fetch(HEALTHIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + API_KEY, 'AuthorizationSource': 'API' },
    body: JSON.stringify({ query, variables })
  });
  const j = await r.json();
  return j.data || {};
}

const SKIPPED_HEALTHIE_IDS = [
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

const Q = `
  query($id: ID!) {
    user(id: $id) {
      id
      first_name
      last_name
      gender
      groups { id name }
      tags { id name }
    }
  }
`;

(async () => {
  console.log('Deep dive on 11 skipped patients (Healthie group/tags + memberships)…\n');
  for (const [name, id] of SKIPPED_HEALTHIE_IDS) {
    process.stdout.write(`${name.padEnd(25)} (${id}) … `);
    try {
      const data = await gql(Q, { id });
      const u = data.user || {};
      const groups = (u.groups || []).map(g => g.name).join(' | ') || '—';
      const tags = (u.tags || []).map(t => t.name).join(' | ') || '—';
      console.log(`groups=[${groups}] tags=[${tags}] gender=${u.gender||'?'}`);
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
    await sleep(1500);
  }
  await pool.end();
})();
