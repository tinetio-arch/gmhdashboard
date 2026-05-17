#!/usr/bin/env node
// Regression test for iPad block-date parsing.
//
// Loads public/ipad/app.js, extracts parseHealthieDate + getPhoenixBlockParts
// by brace-counting, evaluates them in a fresh VM context, and asserts that
// every Healthie/server wire format we have ever shipped maps back to the
// correct Phoenix-local wall clock.
//
// This test exists because of the 2026-05-17 incident: a server-side date
// normalization (a644c80, May 12) flipped block.date from
//   "2026-05-17 07:00:00 -0700"  →  "2026-05-17T14:00:00.000Z"
// and five iPad client-side regex parsers silently broke. A 7am AZ block
// rendered as "2 PM – 2 AM" and the day-grid hid blocks entirely. We had no
// test to catch the regression at build time. We do now.
//
// Exit: 0 = all assertions pass, 1 = any failure.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_JS = path.join(__dirname, '..', '..', 'public', 'ipad', 'app.js');

function extractFunction(source, name) {
    const startRe = new RegExp(`function\\s+${name}\\s*\\(`);
    const m = startRe.exec(source);
    if (!m) throw new Error(`Function ${name} not found in ${APP_JS}`);
    const braceStart = source.indexOf('{', m.index);
    if (braceStart < 0) throw new Error(`No opening brace for ${name}`);
    let depth = 1;
    let i = braceStart + 1;
    while (i < source.length && depth > 0) {
        const c = source[i];
        if (c === '{') depth++;
        else if (c === '}') depth--;
        i++;
    }
    if (depth !== 0) throw new Error(`Unbalanced braces for ${name}`);
    return source.slice(m.index, i);
}

const src = fs.readFileSync(APP_JS, 'utf8');
const code = [
    extractFunction(src, 'parseHealthieDate'),
    extractFunction(src, 'getPhoenixBlockParts'),
].join('\n\n');

const ctx = vm.createContext({ Date, Intl, String, parseInt, isNaN });
vm.runInContext(code, ctx);
const { getPhoenixBlockParts } = ctx;

const cases = [
    // [label, input, expected]
    ['ISO UTC, 7am AZ',
        '2026-05-17T14:00:00.000Z',
        { dateStr: '2026-05-17', hour: 7, minute: 0 }],
    ['ISO UTC, noon AZ',
        '2026-05-17T19:00:00.000Z',
        { dateStr: '2026-05-17', hour: 12, minute: 0 }],
    ['ISO UTC, 7pm AZ (UTC wraps to next day — must stay on Phoenix day)',
        '2026-05-18T02:00:00.000Z',
        { dateStr: '2026-05-17', hour: 19, minute: 0 }],
    ['Legacy Healthie space format, 7am AZ',
        '2026-05-17 07:00:00 -0700',
        { dateStr: '2026-05-17', hour: 7, minute: 0 }],
    ['Legacy Healthie space format, 7pm AZ',
        '2026-05-17 19:00:00 -0700',
        { dateStr: '2026-05-17', hour: 19, minute: 0 }],
    ['ISO UTC, half-hour',
        '2026-05-17T19:30:00.000Z',
        { dateStr: '2026-05-17', hour: 12, minute: 30 }],
    ['Empty string returns null',
        '',
        null],
    ['Garbage returns null',
        'not a date',
        null],
];

let pass = 0, fail = 0;
const failures = [];

for (const [label, input, expected] of cases) {
    const got = getPhoenixBlockParts(input);
    const ok = JSON.stringify(got) === JSON.stringify(expected);
    if (ok) {
        pass++;
    } else {
        fail++;
        failures.push(`  ✗ ${label}\n      input:    ${JSON.stringify(input)}\n      expected: ${JSON.stringify(expected)}\n      got:      ${JSON.stringify(got)}`);
    }
}

// Full Day end-time sanity (the original symptom): 7am start + 720min = 7pm,
// not 2am. Catches arithmetic regressions even if the parser is OK.
const bp = getPhoenixBlockParts('2026-05-17T14:00:00.000Z');
const fullDayLengthMin = 720;
const totalEnd = bp.hour * 60 + bp.minute + fullDayLengthMin;
const endHour = Math.floor(totalEnd / 60) % 24;
const endMinute = totalEnd % 60;
if (endHour === 19 && endMinute === 0) {
    pass++;
} else {
    fail++;
    failures.push(`  ✗ Full Day end calc — expected 19:00, got ${endHour}:${String(endMinute).padStart(2, '0')}`);
}

if (fail === 0) {
    console.log(`  ipad date parser: ${pass}/${pass} cases pass`);
    process.exit(0);
} else {
    console.error(`  ipad date parser: ${fail} FAIL, ${pass} pass`);
    for (const f of failures) console.error(f);
    process.exit(1);
}
