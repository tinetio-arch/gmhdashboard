import * as dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/gmhdashboard/.env.local' });
import { healthieGraphQL } from '@/lib/healthieApi';
import * as fs from 'fs';

const DUPES = [
    { name: 'Steve Benjamin',    a: '12182852', b: '12743724' },
    { name: 'Jeffrey Chamblee',  a: '12177838', b: '12746108' },
    { name: 'Matthew Fisher',    a: '12179965', b: '12745295' },
    { name: 'Rich Freeman',      a: '12183013', b: '12745768' },
    { name: 'Bruce French',      a: '12745786', b: '12765861' },
    { name: 'Joe Hugill',        a: '12690358', b: '12875775' },
    { name: 'Michael McCartney', a: '12182822', b: '12742218' },
    { name: 'Marianna Warner',   a: '12742313', b: '14050273' },
    { name: 'John Winn',         a: '12182229', b: '12743211' },
    { name: 'James Womble',      a: '12179578', b: '12743400' },
];

(async () => {
    const data = new Map<string, { appts: number; billCount: number; paidCount: number }>();
    const BATCH = 5;
    for (let i = 0; i < DUPES.length; i += BATCH) {
        const chunk = DUPES.slice(i, i + BATCH);
        const aliases: string[] = [];
        chunk.forEach((p, idx) => {
            for (const side of ['a', 'b'] as const) {
                const hid = p[side];
                aliases.push(
                    `${side}${i + idx}_appts: appointments(filter:"all", user_id:"${hid}", should_paginate:false){ id pm_status }`,
                    `${side}${i + idx}_billCount: billingItemsCount(client_id:"${hid}")`,
                    `${side}${i + idx}_paidCount: billingItemsCount(client_id:"${hid}", status:"paid")`,
                );
            }
        });
        const q = `{ ${aliases.join(' ')} }`;
        const res = await healthieGraphQL<any>(q, {});
        chunk.forEach((p, idx) => {
            for (const side of ['a', 'b'] as const) {
                const hid = p[side];
                data.set(hid, {
                    appts: (res[`${side}${i + idx}_appts`] || []).length,
                    billCount: Number(res[`${side}${i + idx}_billCount`] || 0),
                    paidCount: Number(res[`${side}${i + idx}_paidCount`] || 0),
                });
            }
        });
        await new Promise(r => setTimeout(r, 300));
    }

    const ws: string[] = [];
    ws.push('# Healthie Merge Worksheet (billing-verified)');
    ws.push(`Generated: ${new Date().toISOString()}\n`);
    ws.push('**Activity counts per Healthie ID** — total appts, total billing items, paid billing items.');
    ws.push('');
    ws.push('| # | Name | ID A (appts / bill / paid) | ID B (appts / bill / paid) | Safe merge target |');
    ws.push('|---|---|---|---|---|');
    DUPES.forEach((d, i) => {
        const A = data.get(d.a)!;
        const B = data.get(d.b)!;
        const aScore = A.paidCount * 10 + A.billCount * 5 + A.appts;
        const bScore = B.paidCount * 10 + B.billCount * 5 + B.appts;
        let rec: string;
        if (aScore === 0 && bScore === 0) rec = `🟢 **Either safe** — neither has activity. Keep B (newer).`;
        else if (aScore > 0 && bScore === 0) rec = `✅ **Keep A (${d.a})** — has activity, B has none.`;
        else if (bScore > 0 && aScore === 0) rec = `✅ **Keep B (${d.b})** — has activity, A has none.`;
        else rec = `⚠️ **BOTH HAVE ACTIVITY — do not auto-merge.** Manual review required to avoid losing payments.`;
        ws.push(`| ${i + 1} | ${d.name} | ${d.a} (${A.appts} / ${A.billCount} / ${A.paidCount}) | ${d.b} (${B.appts} / ${B.billCount} / ${B.paidCount}) | ${rec} |`);
    });

    fs.writeFileSync('/home/ec2-user/gmhdashboard/.tmp/healthie-merge-worksheet-with-billing.md', ws.join('\n'));
    console.log('Worksheet written.\n');
    console.log(ws.join('\n'));
    process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
