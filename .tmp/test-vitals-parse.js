// Behavioral test for vitals dictation parsing.
// Extracts _wordsToDigits + parseDictatedVitalsToFields, replaces the DOM with a
// stub, and asserts that each scenario maps to the expected fields.

const fs = require('fs');
const src = fs.readFileSync('/home/ec2-user/gmhdashboard/public/ipad/app.js', 'utf8');

function extract(name) {
    const re = new RegExp(`function ${name}\\b[\\s\\S]*?\\n\\}\\n`, 'm');
    const m = src.match(re);
    if (!m) throw new Error('cannot find ' + name);
    return m[0];
}

const code =
    extract('_wordsToDigits') + '\n' +
    extract('parseDictatedVitalsToFields') + '\n';

function makeFields() {
    const ids = ['vBP','vPulse','vTemp','vRR','vSpO2','vHeight','vWeight','vBMI'];
    const els = {};
    ids.forEach(id => { els[id] = { value: '', dataset: {} }; });
    return els;
}

function run(input) {
    const els = makeFields();
    const ctx = {
        document: { getElementById: (id) => els[id] || null },
        calcBMI: () => {},
        console,
    };
    const fn = new Function('document','calcBMI', code + '\nreturn parseDictatedVitalsToFields;');
    const parse = fn(ctx.document, ctx.calcBMI);
    parse(input);
    const out = {};
    Object.keys(els).forEach(k => { if (els[k].value) out[k] = els[k].value; });
    return out;
}

const cases = [
    ['BP 120 over 80, pulse 72',     { vBP: '120/80', vPulse: '72' }],
    ['weight 185',                   { vWeight: '185' }],
    ['BP one twenty over eighty',    { vBP: '120/80' }],
    ['blood pressure is 120 over 80, heart rate 72, temp 98.6, sat 98, weight 185',
                                     { vBP: '120/80', vPulse: '72', vTemp: '98.6', vSpO2: '98', vWeight: '185' }],
    ['temperature ninety eight point six',
                                     { vTemp: '98.6' }],
    ['BP 120 to 80',                 { vBP: '120/80' }],
    ['respiratory rate 18',          { vRR: '18' }],
    ['respirations 16',              { vRR: '16' }],
    ['oxygen saturation 97 percent', { vSpO2: '97' }],
    ['height five foot ten',         { vHeight: '70' }],
    ['height 70 inches, weight 185 pounds, pulse 72 bpm, BP 120/80',
                                     { vBP: '120/80', vPulse: '72', vHeight: '70', vWeight: '185' }],
    ['blood pressure for the patient is 118 over 76',
                                     { vBP: '118/76' }],
    ['',                             {}],
    // Height variants — the bug Phil hit on 2026-05-07
    ["patient is 5'9\"",             { vHeight: '69' }],
    ["patient is 5'9",               { vHeight: '69' }],
    ["patient is 5’9”",    { vHeight: '69' }],   // curly quotes (iPad smart-format)
    ['patient is 5 foot 9',          { vHeight: '69' }],
    ['patient is five foot nine',    { vHeight: '69' }],
    ['height is 5’9”',     { vHeight: '69' }],   // labeled, curly quotes
    ['height 70 inches',             { vHeight: '70' }],
    ['height 5',                     {}],                   // 5 inches isn't a real height — reject
    // Should NOT trigger height: a bare "5'" with no inches still says feet only
    ["patient stands 6'",            { vHeight: '72' }],
];

let pass = 0, fail = 0;
for (const [input, expected] of cases) {
    const got = run(input);
    const expectedKeys = Object.keys(expected);
    const ok = expectedKeys.every(k => got[k] === expected[k]);
    // Also flag unexpected fields that were set
    const unexpected = Object.keys(got).filter(k => !(k in expected));
    if (ok && unexpected.length === 0) {
        console.log('PASS:', JSON.stringify(input));
        pass++;
    } else {
        console.log('FAIL:', JSON.stringify(input));
        console.log('  expected:', JSON.stringify(expected));
        console.log('  got:     ', JSON.stringify(got));
        if (unexpected.length) console.log('  unexpected fields:', unexpected);
        fail++;
    }
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
