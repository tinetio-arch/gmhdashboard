
const fs = require('fs');

const invoiceText = `
Product	SKU	Price	Quantity	Total
Oxytocin (10mg)
Fulfilled January 27, 2026
Track shipment
FedEx #398140595740
OXYTOCIN-10	$55.00	3	$165.00
3X Blend Tesamorelin (5mg) / MGF (500mcg) / Ipamorelin (2.5mg)
Fulfilled January 27, 2026
Track shipment
FedEx #398140595740
3XB-55002.5	$65.00	3	$195.00
Gonadorelin (10mg)
Fulfilled January 27, 2026
Track shipment
FedEx #398140595740
GONAD-10	$60.00	2	$120.00
Wolverine Blend - BPC-157 (10mg) / TB500 (10mg)
Fulfilled January 27, 2026
Track shipment
FedEx #398140595740
WOLV-10	$83.00	5	$415.00
GHK-Cu (100mg) - 6ml vial
Fulfilled January 27, 2026
Track shipment
FedEx #398140595740
GHKCU-100-6ML	$52.00	3	$156.00
GHK-Cu (50mg)
Fulfilled January 27, 2026
Track shipment
FedEx #398140595740
GHKCU-50	$40.00	3	$120.00
Sermorelin (10mg)
Fulfilled January 27, 2026
Track shipment
FedEx #398140595740
SERM-10	$65.00	5	$325.00
2X Blend CJC-1295 No DAC (5mg) / Ipamorelin (5mg)
Fulfilled January 27, 2026
Track shipment
FedEx #398140595740
2XB-CJCIPA-55	$55.00	5	$275.00

Product	SKU	Price	Quantity	Total
4X Blend GHRP-2 (5mg) / Tesamorelin (5mg) / MGF (500mcg) / Ipamorelin (2.5mg)
Fulfilled December 22, 2025
Track shipment
FedEx #397037222178
4XB-555002.5	$70.00	3	$210.00
2X Blend Tesamorelin (10mg) / Ipamorelin (5mg) (5ml Vial)
Fulfilled December 22, 2025
Track shipment
FedEx #397037222178
2XB-105	$70.00	3	$210.00
BPC-157 (20mg)
Fulfilled December 22, 2025
Track shipment
FedEx #397037222178
BPC157-20	$75.00	8	$600.00
GLP-1 R (24mg)
Fulfilled December 22, 2025
Track shipment
FedEx #397037222178
GLP3-24	$250.00	10	$2,500.00
Wolverine Blend - BPC-157 (10mg) / TB500 (10mg)
Fulfilled December 22, 2025
Track shipment
FedEx #397037222178
WOLV-10	$83.00	10	$830.00
GLP-1 R (12mg)
Fulfilled December 3, 2025
Track shipment
FedEx #396180601659
GLP3-12	$125.00	4	$500.00
GLP-1 R (24mg)
Fulfilled December 3, 2025
Track shipment
FedEx #396180601659
GLP3-24	$225.00	5	$1,125.00
2X Blend Tesamorelin (5mg) / Ipamorelin (5mg)
Fulfilled December 3, 2025
Track shipment
FedEx #396180601659
2XB-55	$55.00	3	$165.00
`;

// Helper to normalize names
function normalize(str) {
    if (!str) return '';
    return str.toLowerCase()
        .replace(/peptide/g, '')
        .replace(/blend/g, '')
        .replace(/wolverine/g, '')
        .replace(/loading dose/g, '')
        .replace(/vial/g, '')
        .replace(/no dac/g, 'nodac')
        .replace(/with dac/g, 'wdac')
        .replace(/[^a-z0-9]/g, ''); // Strip everything non-alphanumeric (including dashes, spaces, parens)
}

// Parse Invoice Data
function parseInvoiceData(text) {
    const lines = text.split('\n');
    const products = [];
    let currentProduct = null;

    // The format is a bit weird: "Product Name" line, then "Fulfilled...", then "Track...", then "FedEx...", THEN "SKU Price Qty Total" line
    // Or sometimes matched differently. 
    // Actually the pattern seems to be: 
    // Line 1: Name (e.g. Oxytocin (10mg))
    // Line 2-4: Fulfilled/Track/FedEx
    // Line 5: SKU Price Qty Total (e.g. OXYTOCIN-10 $55.00 3 $165.00)

    // Let's iterate and look for price lines ($xx.xx) which usually contain the SKU at start
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Check for SKU/Price line (e.g. "OXYTOCIN-10 $55.00 3 $165.00")
        // It has a $ amount in it.
        if (line.includes('$')) {
            // This is the data line. The name should be roughly 4 lines above it.
            // But sometimes there are varying lines between.
            // Let's look backwards for the product name.
            // The product name is usually the line that doesn't start with "Fulfilled", "Track", "FedEx", or "Product" header.
            let nameLine = null;
            for (let j = i - 1; j >= 0; j--) {
                const prev = lines[j].trim();
                if (!prev) continue;
                if (prev.startsWith('Fulfilled') || prev.startsWith('Track') || prev.startsWith('FedEx') || prev.startsWith('Product\tSKU')) continue;
                // Found it?
                nameLine = prev;
                break;
            }

            if (nameLine) {
                // Parse SKU and Price from current line
                // "OXYTOCIN-10 $55.00 3 $165.00"
                // Split by tabs or spaces? The text pasted likely has spaces/tabs.
                const parts = line.split(/\s+/);
                const sku = parts[0];
                const priceStr = parts.find(p => p.startsWith('$'));
                const price = priceStr ? parseFloat(priceStr.replace('$', '')) : 0;

                // Add if price found
                if (price > 0) {
                    products.push({
                        name: nameLine,
                        sku: sku,
                        unit_cost: price
                    });
                }
            }
        }
    }
    return products;
}

const invoiceItems = parseInvoiceData(invoiceText);

// Match with Database
function matchPeptides() {
    let rawData = fs.readFileSync('/home/ec2-user/gmhdashboard/current_peptides.json', 'utf8');
    // Clean psql output artifacts
    rawData = rawData.replace(/\+\n/g, '').replace(/\n/g, '').trim();

    let dbPeptides = [];
    try {
        dbPeptides = JSON.parse(rawData);
        if (Array.isArray(dbPeptides) && dbPeptides.length > 0 && Array.isArray(dbPeptides[0])) {
            dbPeptides = dbPeptides[0];
        }
    } catch (e) {
        console.error("Failed to parse DB JSON", e);
        return;
    }

    const updates = [];
    const missingInDb = [];

    // Prioritize longer matches to avoid "BPC-157" matching "BPC-157 / TB500" incorrectly
    // Sort DB peptides by name length descending? No, just be careful.

    invoiceItems.forEach(item => {
        let bestMatch = null;
        let matchType = '';
        const normItem = normalize(item.name);

        // 1. Try Specific Known Mappings
        if (item.name.toLowerCase().includes('wolverine')) {
            // Look for BPC+TB500 in DB
            bestMatch = dbPeptides.find(p => {
                const n = normalize(p.name);
                return n.includes('bpc') && n.includes('tb500');
            });
            if (bestMatch) matchType = 'Manual (Wolverine)';
        }
        else if (item.name.includes('GLP-1 R') && item.name.includes('12mg')) {
            bestMatch = dbPeptides.find(p => p.name.includes('Retatrutide') && p.name.includes('12'));
            if (bestMatch) matchType = 'Manual (GLP-1 12)';
        }
        else if (item.name.includes('GLP-1 R') && item.name.includes('24mg')) {
            bestMatch = dbPeptides.find(p => p.name.includes('Retatrutide') && p.name.includes('24'));
            if (bestMatch) matchType = 'Manual (GLP-1 24)';
        }
        else if (item.name.includes('Sermorelin')) {
            bestMatch = dbPeptides.find(p => normalize(p.name).includes('semorelin')); // DB has "Semorelin"
            if (bestMatch) matchType = 'Manual (Sermorelintypo)';
        }

        // 2. Try Exact Normalized Match
        if (!bestMatch) {
            bestMatch = dbPeptides.find(p => normalize(p.name) === normItem);
            if (bestMatch) matchType = 'Exact Normalized';
        }

        // 3. Try Contains Match (Item contains DB name OR DB name contains Item name)
        // Be strict: ensure significant overlap.
        if (!bestMatch) {
            // Filter DB to candidates where one contains the other
            const candidates = dbPeptides.filter(p => {
                const dbNorm = normalize(p.name);
                return dbNorm.includes(normItem) || normItem.includes(dbNorm);
            });

            // Pick result with closest length to avoid "BPC" matching "BPC + TB" if possible, 
            // or if Item is "BPC + TB", valid match is "BPC + TB".
            // If item is "BPC", we don't want "BPC + TB".

            // Let's iterate candidates and pick the one with most similarity?
            // Simple heuristic: pick the one with the smallest length difference relative to the match?

            if (candidates.length > 0) {
                // visual check
                bestMatch = candidates[0]; // Just take first for now, usually correct if uniqueness holds
                matchType = 'Partial';
            }
        }

        if (bestMatch) {
            updates.push({
                product_id: bestMatch.product_id,
                current_name: bestMatch.name,
                invoice_name: item.name,
                sku: item.sku,
                unit_cost: item.unit_cost,
                match_type: matchType
            });
        } else {
            missingInDb.push(item);
        }
    });

    return { updates, missingInDb };
}

const result = matchPeptides();

console.log("# Peptide Invoice Match Report\n");
console.log("## 1. Matches to Update (Cost & SKU)");
console.log("| DB Name | Invoice Name | SKU | Unit Cost |");
console.log("|---|---|---|---|");
result.updates.forEach(u => {
    console.log(`| ${u.current_name} | ${u.invoice_name} | ${u.sku} | $${u.unit_cost.toFixed(2)} |`);
});

console.log("\n## 2. Unmatched Invoice Items");
console.log("| Invoice Name | SKU | Cost |");
console.log("|---|---|---|");
result.missingInDb.forEach(m => {
    console.log(`| ${m.name} | ${m.sku} | $${m.unit_cost.toFixed(2)} |`);
});
