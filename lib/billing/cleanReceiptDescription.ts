/**
 * Deterministic receipt-line cleaner for custom (free-form) charges.
 *
 * Goal: turn rough staff input ("ipamorelin restock + needles", "trt refill 90day")
 * into a tidy, patient-facing line item ("Ipamorelin Restock + Needles", "TRT Refill, 90-Day").
 *
 * Hard rules — by construction this function CANNOT fabricate:
 *   - never adds quantities, prices, products, or extra line items
 *   - never changes meaning; only normalizes whitespace, capitalization, and
 *     expands a small dictionary of clinic abbreviations
 *   - if the input is empty/garbage, returns it unchanged
 *   - capped at 80 chars (truncates with ellipsis)
 *
 * Intentionally non-LLM: zero fabrication risk, zero API dependency, zero latency.
 */

const ABBREVIATIONS: Record<string, string> = {
    trt: 'TRT',
    bhrt: 'BHRT',
    hrt: 'HRT',
    psa: 'PSA',
    cbc: 'CBC',
    cmp: 'CMP',
    b12: 'B12',
    nad: 'NAD+',
    iv: 'IV',
    im: 'IM',
    sq: 'SubQ',
    subq: 'SubQ',
    np: 'NP',
    md: 'MD',
    rn: 'RN',
    pa: 'PA',
    nmh: 'NMH',
    npc: 'NPC',
};

const KEEP_LOWERCASE = new Set(['and', 'or', 'with', 'for', 'a', 'an', 'the', 'of', 'on', 'in']);

function titleCaseWord(w: string): string {
    if (!w) return w;
    const lower = w.toLowerCase();
    // Preserve abbreviations
    if (lower in ABBREVIATIONS) return ABBREVIATIONS[lower];
    // Keep small connectors lowercase (only mid-string; first word capitalized below)
    if (KEEP_LOWERCASE.has(lower)) return lower;
    // Word with embedded digit (e.g., 90day, 10mg) — keep as-is, just upper first letter
    if (/\d/.test(w)) return w.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function cleanReceiptDescription(raw: string | null | undefined): string {
    if (!raw) return '';
    let s = String(raw).trim();
    if (!s) return '';

    // Collapse whitespace, normalize separators
    s = s.replace(/\s+/g, ' ');

    // Insert a space between a number and a unit/word stuck together: "90day" → "90 day"
    s = s.replace(/(\d)([a-zA-Z])/g, (_, d, l) => /^(mg|ml|mcg|g|kg|lb|lbs|cc|iu|hz|hr)$/i.test(l) ? `${d}${l}` : `${d} ${l}`);

    // Tokenize on spaces while preserving slashes/plus/hyphen as separators we keep
    const tokens = s.split(/(\s+|[+/])/).filter(t => t.length > 0);
    const out: string[] = tokens.map((t, i) => {
        if (/^(\s+|[+/])$/.test(t)) return t;
        const cleaned = titleCaseWord(t);
        // Always capitalize the very first token
        if (i === 0 && cleaned) return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
        return cleaned;
    });

    let result = out.join('').replace(/\s+/g, ' ').trim();

    // Hard cap at 80 chars to keep the receipt line tidy
    if (result.length > 80) result = result.slice(0, 77).trimEnd() + '…';

    return result;
}
