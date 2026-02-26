
const fs = require('fs');

const userList = [
    { name: "2x blend CJC 1295 no DAC (5mg)/ Ipamorelin (5mg)", price: 140.00, category: "Growth Hormone" },
    { name: "2x blend Tesamorelin (10mg)/ Ipamorelin (5mg)", price: 160.00, category: "Growth Hormone" },
    { name: "2x blend Tesamorelin (5mg)/ Ipamorelin (5mg)", price: 140.00, category: "Growth Hormone" },
    { name: "3x blend Tesamorelin (5mg)/ MGF (500mcg)/ Ipamorelin (2.5mg)", price: 150.00, category: "Growth Hormone" },
    { name: "4x blend GHRP-2 (5mg)/ Tesamorelin (5mg)/ MGF (500mcg)/ Ipamorelin (2.5mg)", price: 160.00, category: "Growth Hormone" },
    { name: "AOD 9604 (3mg)", price: 150.00, category: "Weight Management" },
    { name: "AOD 9604 (5mg)", price: 150.00, category: "Weight Management" },
    { name: "BPC-157 (10mg)", price: 130.00, category: "Wound Healing" },
    { name: "BPC-157 (10mg) / TB 500 ( 10mg)", price: 196.00, category: "Wound Healing" },
    { name: "BPC-157 (20mg)", price: 180.00, category: "Wound Healing" },
    { name: "BPC-157 (5mg)", price: 120.00, category: "Wound Healing" },
    { name: "CJC-1295 with Ipamorelin (5mg)", price: 140.00, category: "Growth Hormone" },
    { name: "CJC 1295 without DAC (10mg)", price: 150.00, category: "Growth Hormone" },
    { name: "CJC w/ DAC (10mg)", price: 170.00, category: "Growth Hormone" },
    { name: "GHRP-6 (5mg)", price: 90.00, category: "Growth Hormone" },
    { name: "Gonadorelin (10mg)", price: 150.00, category: "Sexual Health" },
    { name: "Gonadorelin (5mg)", price: 120.00, category: "Sexual Health" },
    { name: "HCG ( 10,000 iu)", price: 198.00, category: "Sexual Health" },
    { name: "HCG (5000) IU", price: 128.00, category: "Sexual Health" }, // Normalized "5000iu" to "5000) IU" based on one DB entry variation or standardized name
    { name: "Ipamorelin (10mg)", price: 120.00, category: "Growth Hormone" },
    { name: "PT 141 (10 mg)", price: 130.00, category: "Sexual Health" },
    { name: "PT 141 (5mg)", price: 110.00, category: "Sexual Health" },
    { name: "Retatrutide (12 mg)", price: 410.00, category: "Weight Management" },
    { name: "Retatrutide (24 mg)", price: 664.00, category: "Weight Management" },
    { name: "Semax (30mg)", price: 120.00, category: "Cognitive" },
    { name: "Semorelin (10mg)", price: 160.00, category: "Growth Hormone" },
    { name: "Semorelin (5mg)", price: 120.00, category: "Growth Hormone" },
    { name: "Staff 2x CJC/Ipamorelin", price: 75.00, category: "Other" },
    { name: "TB500 Thymosin Beta 4 (10mg)", price: 150.00, category: "Wound Healing" },
    { name: "TB500 Thymosin Beta 4 (5mg)", price: 130.00, category: "Wound Healing" },
    { name: "Tesamorelin (10mg)", price: 160.00, category: "Growth Hormone" },
    { name: "Tesamorelin (10mg) / Ipamorelin (5mg)", price: 160.00, category: "Growth Hormone" },
    { name: "Tesamorelin (8mg)", price: 148.00, category: "Growth Hormone" }
];

// Helper to normalize names for loose matching
function normalize(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/peptide\s*-?\s*/g, '').replace(/[\(\)\s\/]/g, '').trim();
}

function matchPeptides() {
    let rawData = fs.readFileSync('/home/ec2-user/gmhdashboard/current_peptides.json', 'utf8');

    // Clean psql output artifacts: remove trailing "+" and newlines, join lines
    rawData = rawData.replace(/\+\n/g, '').replace(/\n/g, '');

    // Also sometimes psql puts a leading space or empty line
    rawData = rawData.trim();

    let dbPeptides = [];
    try {
        dbPeptides = JSON.parse(rawData);
        // Handle if it's wrapped in `[ [ ... ] ]`
        if (Array.isArray(dbPeptides) && dbPeptides.length > 0 && Array.isArray(dbPeptides[0])) {
            dbPeptides = dbPeptides[0];
        }
    } catch (e) {
        console.error("Failed to parse DB JSON", e);
        return { updates: [], missingInDb: [], missingInUserList: [] };
    }

    // Flatten array if needed (the json_agg returns a single row with one column which IS the array)
    if (dbPeptides.length === 1 && Array.isArray(dbPeptides[0])) {
        dbPeptides = dbPeptides[0];
    }

    // Map existing DB peptides for quick lookup
    const dbMap = new Map();
    dbPeptides.forEach(p => {
        dbMap.set(normalize(p.name), p);
    });

    const updates = [];
    const missingInDb = [];
    const missingInUserList = [];

    // Check User List against DB
    userList.forEach(u => {
        const key = normalize(u.name);
        const match = dbMap.get(key);

        if (match) {
            updates.push({
                product_id: match.product_id,
                current_name: match.name,
                new_name: u.name, // Enforce the clean name from user list logic (cleaned of "Peptide -")
                category: u.category,
                sell_price: u.price,
                match_type: 'Exact/Close'
            });
            // Mark as found in DB map
            dbMap.delete(key);
        } else {
            // Try fuzzy match? Or just mark missing
            // Let's do a simple substring check if normalize failed
            let found = false;
            for (let [dbKey, dbVal] of dbMap.entries()) {
                if (dbKey.includes(key) || key.includes(dbKey)) {
                    updates.push({
                        product_id: dbVal.product_id,
                        current_name: dbVal.name,
                        new_name: u.name,
                        category: u.category,
                        sell_price: u.price,
                        match_type: 'Fuzzy'
                    });
                    dbMap.delete(dbKey);
                    found = true;
                    break;
                }
            }
            if (!found) {
                missingInDb.push(u);
            }
        }
    });

    // Remaining in DB map are in DB but not in User List
    for (let [key, val] of dbMap.entries()) {
        missingInUserList.push(val);
    }

    return { updates, missingInDb, missingInUserList };
}

const result = matchPeptides();

console.log("# Peptide Analysis Report\n");

console.log(`## 1. Updates to Existing Inventory (${result.updates.length} items)`);
console.log("These items exist in DB (based on name match) and will be updated with new Category and Price.");
console.log("| Current DB Name | Matched List Name | New Category | New Price |");
console.log("|---|---|---|---|");
result.updates.forEach(u => {
    console.log(`| ${u.current_name} | ${u.new_name} | ${u.category} | $${u.sell_price.toFixed(2)} |`);
});

console.log("\n## 2. New Peptides to Add (" + result.missingInDb.length + " items)");
console.log("These are in your list but NOT found in the current system.");
console.log("| Name | Category | Price |");
console.log("|---|---|---|");
result.missingInDb.forEach(m => {
    console.log(`| ${m.name} | ${m.category} | $${m.price.toFixed(2)} |`);
});

console.log("\n## 3. Unmatched System Inventory (" + result.missingInUserList.length + " items)");
console.log("These are in the system but were NOT in your provided list. Should they be deleted or renamed?");
console.log("| DB Name | Category |");
console.log("|---|---|");
result.missingInUserList.forEach(m => {
    console.log(`| ${m.name} | ${m.category} |`);
});
