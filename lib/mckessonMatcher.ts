/**
 * Fuzzy matcher: short hand-curated supply names → long McKesson catalog names.
 *
 * Strategy:
 *  1. Normalize both names: lowercase, expand synonyms (cc→ml, ga→gauge, in→inch),
 *     strip stop words, treat numbers as full tokens.
 *  2. Compute a token-overlap score weighted by token rarity (TF-IDF-ish using
 *     inverse document frequency across the McKesson corpus).
 *  3. Numbers must match exactly when present in the curated name (e.g. "31 ga"
 *     in source must appear as "31 gauge" in candidate).
 *  4. Apply boosts: recent purchase date (we actually order this), purchasable=true,
 *     stocked. Apply penalty for items we won't be able to order.
 *
 * Returns ranked candidates per source item with a score in [0, 1+] and a rough
 * confidence label (high / medium / low / none).
 */

export interface CuratedItem {
  id: number;
  name: string;
  category: string | null;
  unit: string | null;
}

export interface McKessonCandidate {
  id: number;
  mckesson_item_id: string;
  name: string;
  category: string | null;
  minor_category: string | null;
  manufacturer: string | null;
  manufacturer_part_number: string | null;
  stock_status: string | null;
  mckesson_unit_of_measure: string | null;
  mckesson_buy_unit_of_measure: string | null;
  mckesson_purchasable: boolean | null;
  mckesson_last_purchase_date: string | null;  // YYYYMMDD
}

export interface ScoredMatch {
  candidate: McKessonCandidate;
  score: number;
  baseScore: number;
  boosts: string[];
  reason: string;
}

// ─── Normalization ───────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'with', 'without',
  'for', 'in', 'on', 'at', 'to', 'from', 'by', 'as',
  'per', 'each', 'inc', 'corp', 'co',
  'brand', 'tm', 'r',
  'mckesson', 'sunmark',  // very common — would otherwise dominate
]);

// Maps source synonym → canonical token. Applied AFTER tokenization.
const SYNONYMS: Record<string, string> = {
  // Volume
  'cc': 'ml',
  'cm3': 'ml',
  'ml': 'ml',
  // Length
  'in': 'inch',
  'inches': 'inch',
  'inch': 'inch',
  '"': 'inch',
  // Gauge
  'ga': 'gauge',
  'g': 'gauge',
  'gauge': 'gauge',
  'gage': 'gauge',
  // Common drug forms
  'tab': 'tablet',
  'tabs': 'tablet',
  'cap': 'capsule',
  'caps': 'capsule',
  // Vials/bottles/etc.
  'btl': 'bottle',
  'bot': 'bottle',
  'amp': 'ampule',
  'amps': 'ampule',
  'vl': 'vial',
  'vls': 'vial',
  // Packaging
  'pkt': 'packet',
  'pkts': 'packet',
  'pk': 'pack',
  'pks': 'pack',
  'bx': 'box',
  'cs': 'case',
  'ct': 'count',
  'ea': 'each',
  'kt': 'kit',
  'rl': 'roll',
  'sl': 'sleeve',
  'cn': 'can',
  'bg': 'bag',
  // Generic vs brand
  'isopropyl': 'isopropyl',
  'iso': 'isopropyl',
  // Misc
  'sterile': 'sterile',
  'nonsterile': 'nonsterile',
  'non': 'non',
};

// Plural-singular collapse for medical terms
const SINGULARIZE: Array<[RegExp, string]> = [
  [/syringes$/, 'syringe'],
  [/needles$/, 'needle'],
  [/tubes$/, 'tube'],
  [/swabs$/, 'swab'],
  [/wipes$/, 'wipe'],
  [/strips$/, 'strip'],
  [/bags$/, 'bag'],
  [/kits$/, 'kit'],
  [/packs$/, 'pack'],
  [/sponges$/, 'sponge'],
  [/masks$/, 'mask'],
  [/sheets$/, 'sheet'],
  [/cups$/, 'cup'],
  [/bandaids$/, 'bandaid'],
  [/wipes$/, 'wipe'],
  [/applicators$/, 'applicator'],
  [/tips$/, 'tip'],
  [/containers$/, 'container'],
  [/tubes$/, 'tube'],
  [/lids$/, 'lid'],
];

function normalizeNumber(s: string): string {
  // ".5" → "0.5", "31" stays "31"
  if (/^\.\d/.test(s)) return '0' + s;
  return s;
}

export function tokenize(s: string): string[] {
  if (!s) return [];
  // Lowercase, replace ™/®, treat slash/hyphen/x as separators when between numbers
  let normalized = s.toLowerCase()
    .replace(/[™®]/g, '')
    .replace(/[®™]/g, '')
    // "10x12" → "10 x 12"
    .replace(/(\d)x(\d)/g, '$1 x $2')
    // "31g" → "31 g", "10mL" → "10 ml"
    .replace(/(\d)([a-z]+)/g, '$1 $2')
    .replace(/([a-z]+)(\d)/g, '$1 $2')
    // strip parentheticals like "(office)" — keep contents though, often useful
    .replace(/[()[\]]/g, ' ')
    // collapse whitespace and punctuation (preserve ".") into spaces
    .replace(/[/\\,;:!?"'’`+&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const rawTokens = normalized.split(/[\s\-_]+/).filter(Boolean);
  const out: string[] = [];
  for (let t of rawTokens) {
    // numbers
    if (/^\.?\d+(\.\d+)?$/.test(t) || /^\d+\.\d+$/.test(t)) {
      out.push(normalizeNumber(t));
      continue;
    }
    // synonyms
    if (SYNONYMS[t]) { out.push(SYNONYMS[t]); continue; }
    // singularize
    let singularized = t;
    for (const [re, repl] of SINGULARIZE) {
      if (re.test(singularized)) { singularized = singularized.replace(re, repl); break; }
    }
    if (STOP_WORDS.has(singularized)) continue;
    if (singularized.length === 0) continue;
    out.push(singularized);
  }
  return out;
}

// Extract any numeric+unit pairs from tokens — these are "must-match" specs.
// e.g. ["31", "gauge"] → "31gauge"; ["1", "ml"] → "1ml".
const PAIR_UNITS = new Set(['ml', 'inch', 'gauge', 'mg', 'mcg', 'oz', 'lb', 'mm', 'cm']);
export function extractSpecs(tokens: string[]): string[] {
  const specs: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const num = parseFloat(tokens[i]);
    if (!isNaN(num) && PAIR_UNITS.has(tokens[i + 1])) {
      specs.push(`${num}${tokens[i + 1]}`);
    }
  }
  return specs;
}

/**
 * The "primary noun" of a source name — the type of thing it actually is.
 * Found by walking from the right: skip numbers, single-letter tokens, and
 * common modifiers; first real noun is the primary. Used as a hard guardrail:
 * if a candidate doesn't contain this noun, it's not a real match.
 *
 * Examples:
 *   "5 cc syringes" → "syringe"
 *   "Sharps lids" → "lid"
 *   "23 ga x 1 in needles" → "needle"
 *   "Tongue depressors" → "depressor"
 *   "Lidocaine vials" → "vial"
 */
const NOUN_BLACKLIST = new Set([
  'kit', 'kits', 'each', 'box', 'boxes', 'pack', 'packs', 'set', 'sets',
  'bag', 'bags', 'bottle', 'bottles', 'tube', 'tubes', 'roll', 'rolls',
  'can', 'cans', 'inch', 'gauge', 'ml', 'mg', 'mcg', 'oz', 'lb',
  // Skip these as primary nouns — they're modifiers/sizes, not types.
  'small', 'medium', 'large', 'adult', 'pediatric', 'sterile', 'nonsterile',
  // Skip generic count terms that don't pin down a type
  'count',
]);
export function primaryNoun(tokens: string[]): string | null {
  // Walk right-to-left; pick the first token that's word-like and not blacklisted.
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (!/^[a-z]+$/.test(t)) continue;     // skip numbers and mixed
    if (t.length < 3) continue;            // skip "ga", "in", "a"
    if (NOUN_BLACKLIST.has(t)) continue;
    return t;
  }
  return null;
}

// ─── Scoring ─────────────────────────────────────────────────────

/**
 * Build IDF (inverse document frequency) for the corpus so common tokens
 * weigh less than rare ones.
 */
export function buildIDF(corpus: { tokens: string[] }[]): Map<string, number> {
  const docFreq = new Map<string, number>();
  for (const doc of corpus) {
    const seen = new Set(doc.tokens);
    for (const t of seen) docFreq.set(t, (docFreq.get(t) || 0) + 1);
  }
  const N = corpus.length;
  const idf = new Map<string, number>();
  for (const [t, df] of docFreq) {
    idf.set(t, Math.log((N + 1) / (df + 1)) + 1);  // smoothed IDF, min ~0
  }
  return idf;
}

export interface MatcherOptions {
  // Item must be currently available (not Discontinued); enforce by caller via
  // SQL filter, but we still penalize purchasable=false here.
  recentPurchaseBoost?: number;
  purchasableBoost?: number;
  stockedBoost?: number;
  notPurchasablePenalty?: number;
  specMismatchPenalty?: number;
  categoryMatchBoost?: number;
}

const DEFAULT_OPTS: Required<MatcherOptions> = {
  recentPurchaseBoost: 0.20,
  purchasableBoost: 0.10,
  stockedBoost: 0.05,
  notPurchasablePenalty: 0.08,
  specMismatchPenalty: 0.50,
  categoryMatchBoost: 0.05,
};

/**
 * Score a single candidate against a curated source.
 *
 * Hard guardrails (any failure → score collapses):
 *   - Primary noun must appear in candidate (or in candidate's minor_category)
 *   - Every source spec must appear in candidate (else multiplicative penalty)
 *
 * Past those gates, we apply soft boosts for recent purchase, purchasable,
 * stocked status, and category overlap.
 */
export function scoreMatch(
  source: { tokens: string[]; specs: string[]; rawName: string; rawCategory?: string | null; primaryNoun: string | null },
  candidate: McKessonCandidate,
  candTokens: string[],
  candSpecs: string[],
  idf: Map<string, number>,
  opts: MatcherOptions = {}
): ScoredMatch {
  const o = { ...DEFAULT_OPTS, ...opts };

  const candSet = new Set(candTokens);
  const sourceSet = new Set(source.tokens);
  const minorTokens = candidate.minor_category ? tokenize(candidate.minor_category) : [];
  const minorSet = new Set(minorTokens);

  // Token-weighted overlap (IDF-weighted Jaccard-ish)
  let sharedWeight = 0;
  let sourceWeight = 0;
  for (const t of sourceSet) {
    const w = idf.get(t) ?? 1;
    sourceWeight += w;
    if (candSet.has(t) || minorSet.has(t)) sharedWeight += w;
  }
  const baseScore = sourceWeight === 0 ? 0 : sharedWeight / sourceWeight;

  let score = baseScore;
  const boosts: string[] = [];

  // ── Hard guardrail #1: primary noun must be in candidate or its category ──
  if (source.primaryNoun) {
    const nounInCand = candSet.has(source.primaryNoun) || minorSet.has(source.primaryNoun);
    if (!nounInCand) {
      // Severely penalize, but not zero — could still be a useful "low" suggestion.
      score *= 0.25;
      boosts.push(`!noun(${source.primaryNoun})`);
    } else {
      boosts.push(`noun✓(${source.primaryNoun})`);
    }
  }

  // ── Hard guardrail #2: spec matching ──
  if (source.specs.length > 0) {
    const candSpecSet = new Set(candSpecs);
    const missing = source.specs.filter((s) => !candSpecSet.has(s));
    if (missing.length > 0) {
      // Multiplicative — every miss is fatal.
      score *= 0.4 ** missing.length;
      boosts.push(`!spec(${missing.join(',')})`);
    } else {
      // Significant boost when EVERY spec lines up
      score += 0.20;
      boosts.push(`specs✓(${source.specs.join(',')})`);
    }
  }

  // Below this threshold we shouldn't apply soft boosts at all — the boosts
  // would otherwise float a no-overlap candidate into "high" range.
  const REAL_OVERLAP_FLOOR = 0.10;
  if (baseScore < REAL_OVERLAP_FLOOR) {
    return {
      candidate,
      score: Math.max(0, score - 0.10),  // damp further
      baseScore,
      boosts,
      reason: boosts.join(' '),
    };
  }

  // ── Soft boosts ──
  if (candidate.mckesson_last_purchase_date && candidate.mckesson_last_purchase_date !== '00000000') {
    score += o.recentPurchaseBoost;
    boosts.push(`ordered(${candidate.mckesson_last_purchase_date})`);
  }
  if (candidate.mckesson_purchasable === true) {
    score += o.purchasableBoost;
    boosts.push('purchasable');
  } else if (candidate.mckesson_purchasable === false) {
    score -= o.notPurchasablePenalty;
    boosts.push('notPurchasable');
  }
  if (candidate.stock_status === 'Stocked') {
    score += o.stockedBoost;
    boosts.push('stocked');
  } else if (candidate.stock_status === 'Discontinued') {
    score -= o.notPurchasablePenalty * 2;
    boosts.push('discontinued');
  }

  // Category overlap — count how many MINOR_CATEGORY tokens hit source name
  let catOverlap = 0;
  for (const t of minorTokens) if (sourceSet.has(t)) catOverlap++;
  if (catOverlap >= 2) {
    score += o.categoryMatchBoost;
    boosts.push('cat✓');
  }

  return {
    candidate,
    score,
    baseScore,
    boosts,
    reason: boosts.join(' '),
  };
}

/**
 * Match a single curated item against a list of candidates. Returns top N.
 */
export function rankMatches(
  source: CuratedItem,
  candidates: McKessonCandidate[],
  idf: Map<string, number>,
  candTokensCache: Map<number, { tokens: string[]; specs: string[] }>,
  topN = 5,
  opts: MatcherOptions = {}
): ScoredMatch[] {
  const sourceTokens = tokenize(source.name);
  const sourceSpecs = extractSpecs(sourceTokens);
  const src = {
    tokens: sourceTokens,
    specs: sourceSpecs,
    rawName: source.name,
    rawCategory: source.category,
    primaryNoun: primaryNoun(sourceTokens),
  };

  const scored = candidates.map((c) => {
    const cached = candTokensCache.get(c.id);
    const candTokens = cached?.tokens ?? tokenize(c.name);
    const candSpecs = cached?.specs ?? extractSpecs(candTokens);
    return scoreMatch(src, c, candTokens, candSpecs, idf, opts);
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

export type Confidence = 'high' | 'medium' | 'low' | 'none';

/**
 * Bucket the top match into a confidence label by:
 *  - score magnitude
 *  - margin over second-best
 */
export function classifyConfidence(top: ScoredMatch | undefined, second: ScoredMatch | undefined): Confidence {
  if (!top) return 'none';
  // Hard requirement: must have actual content overlap, not just boost-driven score
  if (top.baseScore < 0.20) return 'none';
  if (top.score < 0.50) return 'none';

  const margin = top.score - (second?.score ?? 0);
  if (top.score >= 0.95 && margin >= 0.20 && top.baseScore >= 0.50) return 'high';
  if (top.score >= 0.75 && margin >= 0.10 && top.baseScore >= 0.30) return 'medium';
  if (top.score >= 0.55) return 'low';
  return 'none';
}
