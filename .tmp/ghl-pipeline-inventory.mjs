#!/usr/bin/env node
// Inventory GHL pipelines (separate from workflows) across the 4 sub-accounts.
// Read-only.

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const envPath = join(process.cwd(), '.env.local');
const envText = readFileSync(envPath, 'utf8');
const env = {};
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
}

const subAccounts = [
  { name: "Men's Health", key: env.GHL_MENS_HEALTH_API_KEY, locationId: env.GHL_MENS_HEALTH_LOCATION_ID },
  { name: 'Primary Care', key: env.GHL_PRIMARY_CARE_API_KEY, locationId: env.GHL_PRIMARY_CARE_LOCATION_ID },
  { name: 'ABXTac', key: env.GHL_ABXTAC_API_KEY, locationId: env.GHL_ABXTAC_LOCATION_ID },
  { name: 'Longevity', key: env.GHL_LONGEVITY_API_KEY, locationId: env.GHL_LONGEVITY_LOCATION_ID },
];

const results = {};
for (const sub of subAccounts) {
  console.log(`\n=== ${sub.name} ===`);
  const url = `https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${sub.locationId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${sub.key}`, Version: '2021-07-28', Accept: 'application/json' },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
  if (res.status !== 200) {
    console.log(`  HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    results[sub.name] = { status: res.status, body };
    continue;
  }
  const pipelines = body.pipelines || [];
  console.log(`  ${pipelines.length} pipelines`);
  for (const p of pipelines) {
    const stages = (p.stages || []).map(s => s.name).join(' → ');
    console.log(`    [${p.id?.slice(0, 8)}] ${p.name}  (${(p.stages || []).length} stages)`);
    if (stages) console.log(`        ${stages}`);
  }
  results[sub.name] = { count: pipelines.length, pipelines };
}

writeFileSync('/tmp/ghl-pipeline-inventory.json', JSON.stringify(results, null, 2));
console.log('\nFull JSON written to /tmp/ghl-pipeline-inventory.json');
