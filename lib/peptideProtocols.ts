/**
 * peptideProtocols.ts — clinic-canonical peptide reference for the Ask AI engine.
 *
 * Source of truth: /home/ec2-user/gmhdashboard/ABXTac_Peptide_Protocol_Guide.docx
 * (Phil-approved 2026-05-27) and the matching dosing / reconstitution / goal-
 * playbook data hand-coded in `scripts/generate-wellness-protocols.py`.
 *
 * Why this file exists: the Ask AI system prompt embeds these protocols so the
 * model recommends peptides **from the clinic's own handbook** (specific
 * peptides + clinic dosing + cycle lengths + cautions) rather than refusing,
 * improvising, or pulling generic textbook guidance.
 *
 * Scope: this is the **clinical reference** only — dose ranges, indications,
 * stacks, monitoring flags. It does NOT touch live patient state (that comes
 * from lib/patientChart.ts) and is NOT a per-patient dosing engine (that lives
 * in lib/patientStack.ts + lib/stackAutoAdd.ts).
 *
 * Editing rule: when the handbook changes, edit the docx → re-derive the
 * canonical strings here. Keep entries concise (one peptide ≤ ~6 lines) so the
 * whole block fits comfortably inside the Claude prompt without crowding out
 * the patient chart.
 */

import { STACK_FDA_DISCLAIMER } from './patientStack';

export type PeptideEntry = {
  /** Display name as it appears in the catalog / handbook. */
  name: string;
  /** Therapeutic category — matches lib/peptideCategories.ts buckets. */
  category: string;
  /** One-line indication / what the patient is using it for. */
  indication: string;
  /** Clinic dose range as a single string (matches handbook phrasing). */
  dose: string;
  /** Route: SubQ, intranasal, topical, oral, IM, IV. */
  route: string;
  /** Cycle length / duration guidance from the handbook. */
  cycle: string;
  /** Important provider-facing cautions (interactions, lab flags, contraindications). */
  cautions: string;
};

export type GoalPlaybook = {
  /** Patient-facing goal (e.g. "Performance & Recovery"). */
  goal: string;
  /** Brief description of the typical patient. */
  who: string;
  /** Primary peptide options for this goal. */
  options: string[];
  /** Default starter dosing the clinic uses. */
  starter: string;
  /** Common add-ons / synergistic peptides. */
  addons: string[];
  /** Provider-facing note on monitoring / pitfalls. */
  note: string;
};

/**
 * Pre-built peptide stacks the clinic sells as a unit. Naming matches the
 * patient-facing labels (Wolverine, GLOW, CagriSema, etc.).
 */
export type PeptideStack = {
  name: string;
  components: string;
  indication: string;
};

// ─── Goal-based playbooks ──────────────────────────────────────────────────
// Derived from generate-wellness-protocols.py:639 (PLAYBOOKS). Strings are
// rewritten for a provider audience (the docx version is staff-training
// language). Stripping HTML/HTML-entities so the model sees clean text.

export const CLINIC_GOAL_PLAYBOOKS: GoalPlaybook[] = [
  {
    goal: 'Weight Loss',
    who: 'Patients who want appetite control and steady fat loss; often after diets stopped working.',
    options: [
      'Semaglutide (GLP-1) — well-known once-weekly. Strong appetite suppression, proven, gentlest entry.',
      'Tirzepatide (GLP-1 + GIP) — dual-action; typically greater weight loss than semaglutide, also weekly.',
      'Retatrutide (GLP-1 + GIP + glucagon) — triple-action, most powerful of the GLP class; close provider follow-up.',
      'Cagrilintide — amylin analog; often paired with semaglutide (CagriSema) for added appetite control.',
      'AOD-9604 & MIC/lipotropic blends — gentler, non-GLP fat-metabolism support.',
    ],
    starter:
      'Semaglutide 0.25 mg SubQ once weekly, titrate up every 4 weeks toward 1.0–2.4 mg as tolerated. Pair with protein-forward eating + resistance training to protect muscle.',
    addons: [
      'Tesamorelin or a CJC/Ipamorelin GH stack to preserve lean muscle and target visceral fat during deficit.',
      '5-Amino-1MQ (oral) or MOTS-c for metabolic / fat-oxidation support.',
      'Glutathione + B12 for energy through the deficit.',
    ],
    note:
      'GLP drugs work best with diet and training, not instead of them. Common early side effects: nausea, constipation — usually fade with slow titration. Muscle loss is the #1 mistake; always pair with protein + resistance work.',
  },
  {
    goal: 'Performance & Recovery',
    who: 'Athletes, lifters, weekend warriors, and post-injury/post-op patients who want to train harder and bounce back faster.',
    options: [
      'BPC-157 + TB-500 ("Wolverine") — recovery backbone: tendons, ligaments, muscle, gut.',
      'CJC-1295 + Ipamorelin — GH stack for recovery, body composition, sleep.',
      'IGF-1 LR3 — direct muscle-growth signaling; advanced.',
      'MOTS-c / AICAR / SLU-PP-332 — endurance and exercise-mimetic metabolic support.',
    ],
    starter:
      'Injury / recovery: BPC-157 250–500 mcg SubQ 1–2× daily (often near the site) + TB-500 ~2–2.5 mg SubQ twice weekly for 4–6 weeks. Performance / body-comp: CJC-1295 (no DAC) + Ipamorelin at night before bed.',
    addons: [
      'NAD+ for cellular energy and recovery.',
      'Glutathione for oxidative stress from hard training.',
      'DSIP at bedtime — recovery happens during sleep.',
    ],
    note:
      'Many of these are on WADA / USADA sport anti-doping banned lists (esp. CJC/Ipamorelin, IGF-1, BPC). Disclose proactively when the patient competes.',
  },
  {
    goal: 'Skin, Hair & Beauty',
    who: 'Anti-aging, glow, hair growth, scar/wound healing. A fast-growing segment and a natural cross-sell from weight loss.',
    options: [
      'GHK-Cu (copper peptide) — star: collagen, skin firmness, wound healing, hair growth. Injectable and topical.',
      'GLOW blend (GHK-Cu + BPC + TB) — inside-out glow: skin + healing in one.',
      'KLOW blend (GHK-Cu + KPV + BPC + TB) — adds anti-inflammatory KPV for reactive / irritated skin.',
      'Snap-8 — topical "Botox-in-a-bottle" for expression lines.',
      'Glutathione — antioxidant, skin brightening / even tone.',
      'Epitalon — longevity peptide with skin-quality + sleep benefits.',
    ],
    starter:
      'Entry skincare stack: GHK-Cu (topical serum daily and/or low-dose SubQ) for collagen + glow, plus Glutathione for brightening. Add Snap-8 topically for fine lines.',
    addons: [
      'Melanotan 2 for tanning (set expectations re: freckling / moles).',
      'BPC-157 for scar / wound healing after procedures.',
      'Sermorelin or full GH stack — improved skin thickness/elasticity is a known GH-optimization benefit.',
    ],
    note:
      'Skincare topicals are the easiest "first peptide" for cautious patients. Use as an on-ramp.',
  },
  {
    goal: 'Sexual Health & Libido',
    who: 'Men and women with low libido or arousal concerns.',
    options: [
      'PT-141 (Bremelanotide) — central arousal pathway (not blood flow); works for both sexes. Pre-activity dosing.',
      'Kisspeptin — upstream hormone signaling; libido and fertility support.',
      'Melanotan 2 — libido side-benefit alongside tanning.',
    ],
    starter:
      'PT-141 ~1–2 mg SubQ roughly 45 min before intimacy, not daily. Start low — nausea and flushing are dose-related.',
    addons: [
      'Men: often pairs with the provider\'s TRT or HCG protocol — route hormone-axis questions accordingly.',
      'Kisspeptin for an upstream, more natural-axis approach.',
    ],
    note:
      'PT-141 acts centrally, so it helps patients for whom PDE5 inhibitors (sildenafil/tadalafil) don\'t address the actual issue.',
  },
  {
    goal: 'Focus, Mood & Sleep',
    who: 'Patients wanting sharper focus, calmer mood, less anxiety, or deeper sleep — often busy professionals.',
    options: [
      'Semax — nootropic; focus, mental energy, neuroprotection (intranasal).',
      'Selank — calming / anti-anxiety nootropic without sedation (intranasal).',
      'DSIP — delta sleep-inducing peptide for deeper sleep.',
      'Pinealon / Epitalon — brain and circadian-rhythm support.',
    ],
    starter:
      'Focus: Semax intranasal in the morning. Calm: Selank intranasal as needed. Sleep: DSIP before bed, or Epitalon in cycles for circadian support.',
    addons: [
      'NAD+ for mental clarity and energy.',
      'SS-31 for mitochondrial support in fatigue-driven brain fog.',
    ],
    note:
      'Semax + Selank together is the popular "focused but calm" daytime pairing.',
  },
  {
    goal: 'Longevity & Immune',
    who: 'Proactive health optimizers focused on aging well, energy, and immune resilience.',
    options: [
      'NAD+ — cellular energy and DNA repair; the cornerstone longevity molecule.',
      'Epitalon — telomere / pineal support, sleep, longevity cycles.',
      'MOTS-c — mitochondrial & metabolic longevity.',
      'FOXO4-DRI — senolytic (clears senescent cells); advanced, cyclical.',
      'Thymosin Alpha-1 / Thymalin — immune modulation and thymic support.',
    ],
    starter:
      'Foundational longevity: NAD+ (titrate slowly — fast injection causes flushing) + a cyclical Epitalon course. Immune resilience: Thymosin Alpha-1.',
    addons: [
      'Glutathione as the master antioxidant.',
      'GH stack for the body-composition and recovery aspects of aging.',
    ],
    note:
      'Longevity patients engage with mechanism — depth of explanation pays off.',
  },
];

// ─── Pre-built clinic stacks ──────────────────────────────────────────────
// Source: generate-wellness-protocols.py:1489 (STACKS).

export const CLINIC_PEPTIDE_STACKS: PeptideStack[] = [
  { name: 'Wolverine', components: 'BPC-157 + TB-500', indication: 'Maximal injury & tissue recovery' },
  { name: 'GH Gold-Standard', components: 'CJC-1295 (no DAC) + Ipamorelin', indication: 'GH optimization: muscle, fat loss, sleep' },
  { name: 'GLOW', components: 'GHK-Cu + BPC-157 + TB-500', indication: 'Skin glow + healing (inside-out beauty)' },
  { name: 'KLOW', components: 'GHK-Cu + KPV + BPC-157 + TB-500', indication: 'Reactive / inflamed skin + recovery' },
  { name: 'CagriSema', components: 'Cagrilintide + Semaglutide', indication: 'Enhanced appetite control / weight loss' },
  { name: 'Lean-Cut', components: 'GLP drug + Tesamorelin (or GH stack)', indication: 'Fat loss while preserving muscle' },
  { name: 'Wellness Trio', components: 'Glutathione + B12 + NAD+', indication: 'Energy, antioxidant, cellular health' },
  { name: 'Focused-Calm', components: 'Semax + Selank', indication: 'Daytime focus without anxiety' },
  { name: 'Longevity Base', components: 'NAD+ + Epitalon (cyclical)', indication: 'Cellular energy + telomere support' },
  { name: 'Mito-Recovery', components: 'MOTS-c + SS-31 + NAD+', indication: 'Mitochondrial energy & endurance' },
];

// ─── Per-peptide reference ────────────────────────────────────────────────
// One entry per peptide the clinic stocks. Dose ranges + cycle + cautions
// pulled from the docx; routes and category from lib/peptideCategories.ts +
// the handbook category sections.
//
// Format kept tight on purpose — the AI doesn't need the full reconstitution
// math (that's surfaced separately by patientStack / stackAutoAdd when the
// patient is actually buying). It needs: what is it for, what's the clinic
// dose range, what cycle, what to watch for.

export const CLINIC_PEPTIDES: PeptideEntry[] = [
  // ── Weight Management ──────────────────────────────────────────────────
  {
    name: 'Semaglutide',
    category: 'Weight Management',
    indication: 'Appetite suppression, weight loss (GLP-1 agonist).',
    dose: '0.25 mg SubQ once weekly → titrate every 4 wk toward 1.0–2.4 mg.',
    route: 'SubQ, once weekly',
    cycle: 'Ongoing; titrate up over 16+ weeks. Plateau at tolerated dose.',
    cautions:
      'Nausea / constipation early — fades with slow titration. Pair with protein + resistance training to prevent muscle loss. Hold if severe GI symptoms. Avoid in personal/family hx of medullary thyroid cancer or MEN-2.',
  },
  {
    name: 'Tirzepatide',
    category: 'Weight Management',
    indication: 'Stronger weight loss than semaglutide (GLP-1 + GIP dual agonist).',
    dose: '2.5 mg SubQ once weekly → titrate every 4 wk toward 5–15 mg.',
    route: 'SubQ, once weekly',
    cycle: 'Ongoing; titrate up over 16+ weeks.',
    cautions:
      'GI side effects same family as semaglutide, sometimes more pronounced. Same MTC/MEN-2 caveat. Watch for dehydration.',
  },
  {
    name: 'Retatrutide',
    category: 'Weight Management',
    indication: 'Aggressive weight loss (GLP-1 + GIP + glucagon triple agonist).',
    dose: '2 mg SubQ weekly → titrate toward 8–12 mg over 16+ weeks.',
    route: 'SubQ, once weekly',
    cycle: 'Ongoing; provider-directed titration.',
    cautions:
      'Investigational. Heart-rate increase reported in trials — recheck HR/BP at follow-ups. Same GI / MTC / MEN-2 caveats. Reserve for patients failing semaglutide / tirzepatide.',
  },
  {
    name: 'Cagrilintide',
    category: 'Weight Management',
    indication: 'Amylin analog for added satiety; often stacked with semaglutide (CagriSema).',
    dose: '0.16 mg SubQ weekly → titrate toward 0.6–2.4 mg.',
    route: 'SubQ, once weekly',
    cycle: 'Ongoing; titrate slowly to limit nausea.',
    cautions: 'Stacks additively with GLP drugs for GI side effects — slow titration.',
  },
  {
    name: 'AOD-9604',
    category: 'Weight Management',
    indication: 'Fat-metabolism support (HGH fragment 176-191).',
    dose: '250–500 mcg SubQ daily, fasted AM and/or 30 min pre-exercise.',
    route: 'SubQ, daily',
    cycle: '8–12 week cycles.',
    cautions: 'Mild profile. No appreciable GH/IGF-1 effect, so does not stack with a GH-optimization stack.',
  },

  // ── Healing & Tissue Repair ─────────────────────────────────────────────
  {
    name: 'BPC-157',
    category: 'Healing & Tissue Repair',
    indication: 'Tendon / ligament / muscle / gut repair; anti-inflammatory.',
    dose: '250–500 mcg SubQ 1–2× daily (often near the injury site). Oral form available for gut.',
    route: 'SubQ or oral',
    cycle: '4–6 week cycles, repeat as needed.',
    cautions:
      'Excellent safety profile. On WADA / USADA banned list — disclose for competitive athletes.',
  },
  {
    name: 'TB-500 (Thymosin Beta-4)',
    category: 'Healing & Tissue Repair',
    indication: 'Soft-tissue healing, full-body recovery (Thymosin Beta-4 fragment).',
    dose: 'Loading: 2–4 mg SubQ 2× weekly × 4–6 wk. Maintenance: 2 mg weekly.',
    route: 'SubQ',
    cycle: '4–6 week loading, then maintenance or off-cycle.',
    cautions: 'WADA / USADA banned. Theoretical concern about promoting growth in undiagnosed malignancy — screen accordingly.',
  },
  {
    name: 'Wolverine Blend (BPC-157 + TB-500)',
    category: 'Healing & Tissue Repair',
    indication: 'Combo of the two recovery backbones in one vial.',
    dose: 'Per the blend ratio on the vial — typical dosing: 250 mcg BPC + 2 mg TB SubQ daily or 3×/week.',
    route: 'SubQ',
    cycle: '4–6 week cycles.',
    cautions: 'Same as components. Always check the per-component split on the vial label before drawing.',
  },
  {
    name: 'GHK-Cu (Copper Peptide)',
    category: 'Anti-Aging & Skin',
    indication: 'Collagen synthesis, skin firmness, wound healing, hair growth.',
    dose: 'Systemic: 1–2 mg SubQ 3–5× weekly. Topical: a few drops of reconstituted solution daily.',
    route: 'SubQ or topical',
    cycle: 'Ongoing or 8-week cycles.',
    cautions:
      'Copper accumulation possible at high systemic doses — keep within range. Topical is the lowest-risk on-ramp.',
  },
  {
    name: 'GLOW Blend (GHK-Cu + BPC + TB)',
    category: 'Anti-Aging & Skin',
    indication: 'Skin glow + healing combined.',
    dose: 'Per blend ratio on vial — daily or 3–5×/week SubQ.',
    route: 'SubQ',
    cycle: '8 week cycles.',
    cautions: 'Same as components. Check vial label.',
  },
  {
    name: 'KLOW Blend (GHK-Cu + KPV + BPC + TB)',
    category: 'Anti-Aging & Skin',
    indication: 'Reactive / inflamed skin + recovery; KPV adds anti-inflammatory action.',
    dose: 'Per blend ratio on vial.',
    route: 'SubQ',
    cycle: '8 week cycles.',
    cautions: 'Same as components.',
  },
  {
    name: 'LL-37',
    category: 'Healing & Tissue Repair',
    indication: 'Antimicrobial peptide; chronic infection / biofilm support, wound healing.',
    dose: '100–500 mcg SubQ daily.',
    route: 'SubQ',
    cycle: '14 day cycles, often pulsed.',
    cautions: 'Theoretical pro-inflammatory burst initially — start low.',
  },

  // ── Growth Hormone (secretagogues) ──────────────────────────────────────
  {
    name: 'Sermorelin',
    category: 'Growth Hormone',
    indication: 'GHRH analog; gentle endogenous GH support, sleep quality, body comp.',
    dose: '200–300 mcg SubQ at bedtime nightly (or 5 nights on / 2 off).',
    route: 'SubQ',
    cycle: '3–6 month cycles, off-cycle to maintain pituitary responsiveness.',
    cautions: 'Lighter effect than CJC/Ipamorelin. Best for first-time GH-curious patients.',
  },
  {
    name: 'CJC-1295 (no DAC) + Ipamorelin',
    category: 'Growth Hormone',
    indication: 'Gold-standard GH-optimization stack: GHRH (CJC no DAC) + GHRP (Ipamorelin).',
    dose: 'CJC-1295 (no DAC) 100–300 mcg + Ipamorelin 100–300 mcg SubQ at bedtime; can dose 5×/week.',
    route: 'SubQ',
    cycle: '3–6 month cycles; off for ≥4 weeks between cycles.',
    cautions:
      'Tingling / flushing in early doses (Ipamorelin). Monitor IGF-1 + fasting glucose if running > 3 months. Mild fluid retention possible.',
  },
  {
    name: 'CJC-1295 with DAC',
    category: 'Growth Hormone',
    indication: 'Sustained-release GHRH — once-weekly dosing instead of daily.',
    dose: '1–2 mg SubQ once weekly.',
    route: 'SubQ, weekly',
    cycle: '3 month cycles.',
    cautions:
      'Continuous elevation of GH-stimulating signal rather than pulsatile — more side effects (fluid retention, headache). Most clinics prefer no-DAC + Ipamorelin for the pulsatile pattern.',
  },
  {
    name: 'Ipamorelin',
    category: 'Growth Hormone',
    indication: 'Selective GHRP; does not raise cortisol / prolactin like GHRP-6.',
    dose: '100–300 mcg SubQ 1–3×/day or stacked at bedtime with CJC-1295.',
    route: 'SubQ',
    cycle: '3–6 month cycles.',
    cautions: 'Generally excellent tolerability. Best stacked with a GHRH (CJC / Sermorelin) for pulse amplification.',
  },
  {
    name: 'Tesamorelin',
    category: 'Growth Hormone',
    indication: 'GHRH analog with strongest data for visceral fat reduction (HARS-approved); preserves lean mass in cuts.',
    dose: '1–2 mg SubQ daily at bedtime.',
    route: 'SubQ',
    cycle: '3–6 month cycles.',
    cautions: 'Monitor fasting glucose and IGF-1 quarterly on extended cycles. Stronger than sermorelin — slight risk of carpal-tunnel-like fluid effects at top dose.',
  },
  {
    name: 'IGF-1 LR3',
    category: 'Growth Hormone',
    indication: 'Direct muscle-growth signaling (long-acting IGF-1 analog).',
    dose: '20–100 mcg SubQ daily.',
    route: 'SubQ',
    cycle: '4–6 week cycles only; long-term concerns.',
    cautions:
      'Advanced — provider-directed only. Suppresses endogenous GH axis. Theoretical risk of promoting growth in undiagnosed malignancy. Hypoglycemia possible at higher doses.',
  },
  {
    name: 'GHRP-6 / Hexarelin',
    category: 'Growth Hormone',
    indication: 'GHRPs; older generation, raises hunger (GHRP-6) and stronger pulse (Hexarelin).',
    dose: '100–300 mcg SubQ 1–3×/day.',
    route: 'SubQ',
    cycle: '4–8 week cycles.',
    cautions: 'Raises prolactin and cortisol — Ipamorelin usually preferred unless appetite stimulation is the goal.',
  },
  {
    name: 'HGH Fragment 176-191',
    category: 'Growth Hormone',
    indication: 'Localized fat metabolism without growth effects.',
    dose: '250–500 mcg SubQ fasted AM and/or 30 min pre-exercise.',
    route: 'SubQ',
    cycle: '8–12 week cycles.',
    cautions: 'No appreciable IGF-1 effect.',
  },

  // ── Sexual Health ──────────────────────────────────────────────────────
  {
    name: 'PT-141 (Bremelanotide)',
    category: 'Sexual Health',
    indication: 'Central arousal pathway; libido for men and women.',
    dose: '1–2 mg SubQ ~45 min before intimacy. Not daily.',
    route: 'SubQ, on-demand',
    cycle: 'As needed — limit to ≤8 doses/month.',
    cautions: 'Nausea and flushing dose-related. Transient BP increase — caution in uncontrolled hypertension. Skin hyperpigmentation possible with frequent use.',
  },
  {
    name: 'Kisspeptin-10',
    category: 'Sexual Health',
    indication: 'Upstream HPG-axis signaling; libido and fertility support.',
    dose: '100–400 mcg SubQ daily or pulsed.',
    route: 'SubQ',
    cycle: '4–8 week cycles.',
    cautions: 'Limited human data outside fertility research.',
  },
  {
    name: 'Melanotan 2',
    category: 'Sexual Health',
    indication: 'Tanning + libido side-benefit.',
    dose: '250 mcg SubQ to start, titrate to 500 mcg–1 mg.',
    route: 'SubQ',
    cycle: 'Loading phase then maintenance.',
    cautions: 'New mole / freckle darkening — baseline dermatology screen before starting. Nausea and flushing dose-related.',
  },

  // ── Cognitive & Neuro ──────────────────────────────────────────────────
  {
    name: 'Semax',
    category: 'Cognitive & Neuro',
    indication: 'Focus, mental energy, neuroprotection (Russian ACTH-derived nootropic).',
    dose: 'Intranasal 200–600 mcg 1–2×/day (morning). SubQ alt: 200–500 mcg.',
    route: 'Intranasal preferred; SubQ alt',
    cycle: '2–4 week cycles or continuous.',
    cautions: 'Well-tolerated. Stack with Selank for "focused but calm."',
  },
  {
    name: 'Selank',
    category: 'Cognitive & Neuro',
    indication: 'Anxiolytic without sedation; mood support.',
    dose: 'Intranasal 250–500 mcg 1–3×/day. SubQ alt: 250–500 mcg.',
    route: 'Intranasal preferred; SubQ alt',
    cycle: '2–4 week cycles.',
    cautions: 'Well-tolerated.',
  },
  {
    name: 'SS-31 (Elamipretide)',
    category: 'Cognitive & Neuro',
    indication: 'Mitochondrial cardiolipin support; fatigue-driven brain fog.',
    dose: '1–3 mg SubQ daily.',
    route: 'SubQ',
    cycle: '4–8 week cycles. Protect from light.',
    cautions: 'Investigational.',
  },
  {
    name: 'Pinealon',
    category: 'Cognitive & Neuro',
    indication: 'Pineal bioregulator; cognitive + circadian support.',
    dose: '5–10 mg SubQ daily.',
    route: 'SubQ',
    cycle: '10–20 day cycles, 2–4×/year.',
    cautions: 'Russian bioregulator class — limited Western data.',
  },

  // ── Sleep & Recovery ───────────────────────────────────────────────────
  {
    name: 'DSIP',
    category: 'Sleep & Recovery',
    indication: 'Delta Sleep-Inducing Peptide; deeper sleep architecture.',
    dose: '100–300 mcg SubQ at bedtime.',
    route: 'SubQ, at bedtime',
    cycle: '2–4 week cycles or nightly PRN.',
    cautions: 'Mild profile.',
  },
  {
    name: 'VIP (VIP-10)',
    category: 'Sleep & Recovery',
    indication: 'Vasoactive Intestinal Peptide; CIRS / mast-cell / autonomic support.',
    dose: 'Intranasal per vial label (research dosing).',
    route: 'Intranasal',
    cycle: 'Long, provider-directed cycles.',
    cautions: 'Niche — provider-directed only.',
  },
  {
    name: 'ARA-290 (Cibinetide)',
    category: 'Sleep & Recovery',
    indication: 'EPO-receptor agonist without hematopoietic effect; neuropathy, nerve healing.',
    dose: '1–4 mg SubQ daily.',
    route: 'SubQ',
    cycle: '4 week cycles.',
    cautions: 'Investigational. Does NOT raise hematocrit — verify with the patient that they understand it isn\'t EPO.',
  },

  // ── Anti-Aging & Longevity ──────────────────────────────────────────────
  {
    name: 'Epitalon (Epithalon)',
    category: 'Anti-Aging & Longevity',
    indication: 'Pineal / telomere support; sleep, circadian rhythm.',
    dose: '5–10 mg SubQ daily.',
    route: 'SubQ',
    cycle: '10–20 day cycles, 2–4×/year.',
    cautions: 'Limited Western trial data. Pulse the cycles rather than continuous.',
  },
  {
    name: 'MOTS-c',
    category: 'Anti-Aging & Longevity',
    indication: 'Mitochondrial-derived peptide; metabolic / endurance support.',
    dose: '5–10 mg SubQ 3–5×/week.',
    route: 'SubQ',
    cycle: '4–8 week cycles.',
    cautions: 'Insulin-sensitizing — caution in patients already on aggressive glycemic agents.',
  },
  {
    name: 'NAD+',
    category: 'Anti-Aging & Longevity',
    indication: 'Cellular energy, DNA repair, recovery.',
    dose: '50–250 mg SubQ titrated slowly. IV in-clinic option for higher doses.',
    route: 'SubQ (or IV in clinic) — slow injection',
    cycle: 'Daily or 3×/week.',
    cautions:
      'Inject SLOWLY — rapid injection causes flushing, nausea, chest tightness. Reconstitute with saline (not BAC water).',
  },
  {
    name: 'FOXO4-DRI',
    category: 'Anti-Aging & Longevity',
    indication: 'Senolytic — clears senescent ("zombie") cells.',
    dose: 'Per vial label; advanced cyclical dosing.',
    route: 'SubQ',
    cycle: 'Short pulses, infrequent (every few months).',
    cautions: 'Investigational. Provider-directed only.',
  },

  // ── Immune Support ──────────────────────────────────────────────────────
  {
    name: 'Thymosin Alpha-1 (TA1)',
    category: 'Immune Support',
    indication: 'Thymic peptide; immune modulation, post-viral recovery, oncology supportive.',
    dose: '900 mcg – 1.6 mg SubQ 2× weekly.',
    route: 'SubQ',
    cycle: 'Ongoing or 12-week cycles.',
    cautions: 'Excellent safety profile. Stack with NAD+ + Glutathione for systemic resilience.',
  },
  {
    name: 'Thymalin',
    category: 'Immune Support',
    indication: 'Bioregulator analog; immune-thymic support.',
    dose: '2.5–5 mg SubQ daily.',
    route: 'SubQ',
    cycle: '10–20 day cycles.',
    cautions: 'Russian bioregulator — limited Western trial data.',
  },
  {
    name: 'KPV',
    category: 'Immune Support',
    indication: 'Anti-inflammatory tripeptide; gut, skin, autoimmune flare adjunct.',
    dose: '250–1000 mcg SubQ daily or oral.',
    route: 'SubQ or oral',
    cycle: '4–8 week cycles.',
    cautions: 'Mild profile.',
  },

  // ── Body Composition (hormone adjuncts) ────────────────────────────────
  {
    name: 'HCG',
    category: 'Body Composition',
    indication: 'Maintains testicular function on TRT; fertility preservation.',
    dose: '250–500 IU SubQ 2–3× weekly while on TRT.',
    route: 'SubQ',
    cycle: 'Continuous (with TRT) or fertility-restoration courses.',
    cautions: 'Estrogen conversion increases — monitor estradiol. Provider-directed.',
  },
  {
    name: 'ACE-031',
    category: 'Body Composition',
    indication: 'Myostatin antagonist; muscle building.',
    dose: '1–3 mg/kg SubQ every 2 weeks (research dosing).',
    route: 'SubQ',
    cycle: 'Short pulses; provider-directed.',
    cautions: 'Telangiectasia and nosebleeds reported in trials. Investigational.',
  },
  {
    name: 'AICAR',
    category: 'Body Composition',
    indication: 'AMPK activator / "exercise mimetic"; endurance, fat oxidation.',
    dose: '10–20 mg/kg SubQ daily (research dosing); often split.',
    route: 'SubQ (or IV in clinic)',
    cycle: '4–8 week cycles.',
    cautions: 'WADA banned. High doses cause hyperuricemia.',
  },

  // ── Vitamins & Lipotropics ─────────────────────────────────────────────
  {
    name: 'B12 (Methylcobalamin)',
    category: 'Vitamins & Lipotropics',
    indication: 'Energy, mood, methylation support.',
    dose: '500–1000 mcg SubQ or IM weekly.',
    route: 'SubQ or IM',
    cycle: 'Ongoing; lab-guided.',
    cautions: 'Pre-mixed — no reconstitution. Generally well-tolerated.',
  },
  {
    name: 'Glutathione',
    category: 'Vitamins & Lipotropics',
    indication: 'Master antioxidant; detox, skin, oxidative-stress support.',
    dose: '100–200 mg SubQ 1–3×/week.',
    route: 'SubQ (or IV in clinic)',
    cycle: 'Ongoing.',
    cautions: 'Sulfur-containing — rare odor complaint. Some pre-mixed bottles need refrigeration.',
  },
  {
    name: 'Lipotropic Blends (MIC / MIC-B12)',
    category: 'Vitamins & Lipotropics',
    indication: 'Methionine / Inositol / Choline blends ± B12; fat metabolism, energy.',
    dose: '0.5–1 mL IM or SubQ weekly.',
    route: 'IM or SubQ',
    cycle: 'Ongoing.',
    cautions: 'Pre-mixed; provider sets concentration per the bottle label.',
  },
];

// ─── Universal safety + monitoring (load-bearing across every recommendation) ──

export const CLINIC_SAFETY_BLOCK = `
**Always evaluate against the patient chart**:
- Active TRT → erythrocytosis / polycythemia risk. If hematocrit >52%, flag a phlebotomy / dose-reduction conversation BEFORE layering on any GH stack (CJC/Ipamorelin/Tesamorelin/IGF-1) that can further raise hematocrit. Hct ≥54% = clinical action threshold (not "monitor").
- Allergies — empty list ≠ NKDA. If chart shows allergies.nkda=false and items=[], allergy status is UNCONFIRMED. Say so.
- Renal disease (N18.x / AKI / dialysis / low eGFR / high creatinine) → caution with peptides cleared / acted on renally (notably HCG, IGF-1 LR3, AICAR at higher doses). Surface the relevant lab from labs.recentResults.
- Cardiovascular disease / uncontrolled HTN → caution with PT-141 (BP spike), Retatrutide (HR↑), and aggressive GH stacks (fluid retention).
- Glycemic disease (T2DM / pre-diabetes) → GLP class is therapeutic but monitor for hypoglycemia if also on sulfonylurea / insulin. MOTS-c and AICAR are insulin-sensitizing.
- Cancer history → avoid IGF-1 LR3 and proceed cautiously with any GH-axis stack (CJC/Ipamorelin/Tesamorelin) — theoretical growth promotion. Oncology clearance preferred.
- Pregnancy / nursing → contraindicated for essentially every peptide on this list except provider-individualized B12.
- Competitive athletes → BPC-157, TB-500, CJC, Ipamorelin, IGF-1, AICAR, GHRP-6/Hexarelin, GHK-Cu, ARA-290 are on WADA / USADA banned lists. Disclose proactively.
- Concurrent meds — scan regimen.medications. Notable: GLP drugs interact with insulin / sulfonylureas (hypoglycemia), PT-141 with antihypertensives, NAD+ with anything blood-pressure-relevant (slow injection always).
- Lab freshness — if labs.lastLabDate >6 months old, recommend new draw before titrating up or starting a GH stack.
`.trim();

// ─── Render a single, prompt-ready block ──────────────────────────────────

/**
 * Build the entire clinic-protocol reference as a single string ready to be
 * dropped into the Claude system prompt inside a <clinic_peptide_protocols>
 * tag. Kept deterministic so audit log entries for the same code version are
 * stable.
 *
 * Size budget: aim for ~12–14k characters (well under Claude's prompt cache
 * boundary but adds enough signal that the model can recommend specific
 * peptides + doses without improvising).
 */
export function renderClinicPeptideProtocols(): string {
  const lines: string[] = [];

  lines.push('# Granite Mountain Health / ABXTAC — Clinic Peptide Protocol Reference');
  lines.push('');
  lines.push(
    'This is the clinic\'s OWN handbook (Phil-approved 2026-05-27). Recommend peptides + doses FROM this reference, not from generic textbooks. The patient is enrolled at this clinic and the asker is the clinic\'s provider; peptides are in scope.'
  );
  lines.push('');

  lines.push('## Universal safety guard (apply to every peptide recommendation)');
  lines.push(CLINIC_SAFETY_BLOCK);
  lines.push('');

  lines.push('## Goal-based playbooks (clinic starter protocols)');
  for (const pb of CLINIC_GOAL_PLAYBOOKS) {
    lines.push(`### ${pb.goal}`);
    lines.push(`Who: ${pb.who}`);
    lines.push('Options:');
    for (const o of pb.options) lines.push(`- ${o}`);
    lines.push(`Starter: ${pb.starter}`);
    if (pb.addons.length) {
      lines.push('Add-ons:');
      for (const a of pb.addons) lines.push(`- ${a}`);
    }
    lines.push(`Note: ${pb.note}`);
    lines.push('');
  }

  lines.push('## Pre-built clinic stacks');
  for (const s of CLINIC_PEPTIDE_STACKS) {
    lines.push(`- **${s.name}** (${s.components}) — ${s.indication}`);
  }
  lines.push('');

  lines.push('## Per-peptide reference');
  let currentCategory: string | null = null;
  for (const p of CLINIC_PEPTIDES) {
    if (p.category !== currentCategory) {
      lines.push('');
      lines.push(`### ${p.category}`);
      currentCategory = p.category;
    }
    lines.push(
      `- **${p.name}** — ${p.indication}  | Dose: ${p.dose}  | Route: ${p.route}  | Cycle: ${p.cycle}  | Cautions: ${p.cautions}`
    );
  }
  lines.push('');

  lines.push('## Patient-facing FDA disclaimer (verbatim — close prescribing answers with this language)');
  lines.push(STACK_FDA_DISCLAIMER);

  return lines.join('\n');
}
