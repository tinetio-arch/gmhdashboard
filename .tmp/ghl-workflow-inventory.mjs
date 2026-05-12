#!/usr/bin/env node
// One-off: list all GHL workflows across the 4 sub-accounts.
// Usage: node .tmp/ghl-workflow-inventory.mjs
// Reads .env.local — does NOT modify anything.

import { readFileSync } from 'fs';
import { join } from 'path';

const envPath = join(process.cwd(), '.env.local');
const envText = readFileSync(envPath, 'utf8');
const env = {};
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
}

const subAccounts = [
  { name: 'Men\'s Health', key: env.GHL_MENS_HEALTH_API_KEY, locationId: env.GHL_MENS_HEALTH_LOCATION_ID },
  { name: 'Primary Care', key: env.GHL_PRIMARY_CARE_API_KEY, locationId: env.GHL_PRIMARY_CARE_LOCATION_ID },
  { name: 'ABXTac', key: env.GHL_ABXTAC_API_KEY, locationId: env.GHL_ABXTAC_LOCATION_ID },
  { name: 'Longevity', key: env.GHL_LONGEVITY_API_KEY, locationId: env.GHL_LONGEVITY_LOCATION_ID },
];

async function listWorkflows(sub) {
  if (!sub.key || !sub.locationId) {
    return { error: 'missing api key or locationId' };
  }
  const url = `https://services.leadconnectorhq.com/workflows/?locationId=${sub.locationId}`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${sub.key}`,
        Version: '2021-07-28',
        Accept: 'application/json',
      },
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
    return { status: res.status, body };
  } catch (e) {
    return { error: e.message };
  }
}

const results = {};
for (const sub of subAccounts) {
  console.log(`\n=== ${sub.name} (locationId=${sub.locationId?.slice(0, 8)}...) ===`);
  const r = await listWorkflows(sub);
  if (r.error) {
    console.log(`  ERROR: ${r.error}`);
    results[sub.name] = r;
    continue;
  }
  if (r.status !== 200) {
    console.log(`  HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    results[sub.name] = r;
    continue;
  }
  const workflows = r.body.workflows || r.body.data || r.body || [];
  const list = Array.isArray(workflows) ? workflows : (workflows.workflows || []);
  console.log(`  ${list.length} workflows`);
  for (const wf of list) {
    const status = wf.status || (wf.published ? 'published' : 'unpublished');
    const lastUpdated = wf.dateUpdated || wf.updatedAt || wf.lastUpdated || '?';
    console.log(`    [${status.padEnd(11)}] ${wf.id?.slice(0, 8) || '?'} ${wf.name || '(unnamed)'}  (updated: ${lastUpdated})`);
  }
  results[sub.name] = { count: list.length, workflows: list };
}

import { writeFileSync } from 'fs';
writeFileSync('/tmp/ghl-workflow-inventory.json', JSON.stringify(results, null, 2));
console.log('\nFull JSON written to /tmp/ghl-workflow-inventory.json');
