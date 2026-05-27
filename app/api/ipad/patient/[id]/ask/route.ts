/**
 * POST /api/ipad/patient/[id]/ask
 *
 * Phase 2 of the iPad Patient-Chart AI (dispatch row 20260527-004144-9e2b).
 *
 * Read-only grounded Q&A:
 *   • Caller (iPad/mobile) supplies a natural-language question scoped to one
 *     open patient.
 *   • We assemble the whole chart via lib/patientChart.ts (Phase 1), pin it
 *     into a strict-grounding system prompt, and ask Claude Sonnet 4.5 via
 *     AWS Bedrock (same pattern as the scribe — PHI lives in AWS-BAA).
 *   • Every successful call (and every rejection) writes one row to
 *     `agent_action_log` so we can later prove who asked what about whom.
 *
 * The §6 clinical-safety guardrails from the brief are baked into the system
 * prompt — they are decision-support framing, NKDA semantics, renal dosing
 * flags, and an explicit "never invent" instruction.
 *
 * This endpoint deliberately does NOT live at /api/ipad/chat (that path is the
 * dispatch-mcp inbox proxy and would collide).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { assemblePatientChart, type PatientChart } from '@/lib/patientChart';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Same model + region as scribe/generate-note — keeps PHI inside AWS (BAA).
// Phil's hard rule: never route PHI through public api.anthropic.com even
// though ANTHROPIC_API_KEY exists in the env.
const bedrock = new BedrockRuntimeClient({ region: 'us-east-2' });
const CLAUDE_MODEL_ID = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const PROMPT_VERSION = 'v2-2026-05-27-admin-only';

// Engine option A (2026-05-27): the Ask-AI feature is admin-locked. Only Phil's
// admin account can use it — the client hides the button for everyone else, but
// this constant is the load-bearing server-side gate. Any non-admin staff that
// stumbles on the route (or the mobile sync drops the client guard) gets a 403.
const ASK_AI_ADMIN_EMAIL = 'admin@nowoptimal.com';

// ─── Patient-scope guardrail ─────────────────────────────────────────────────
//
// Dispatch row 20260527-012352-1888: TRT- and Men's-Health-specific answers
// must be gated on the patient actually being enrolled in NowMensHealth.Care.
// A primary-care or longevity patient who happens to be open in the iPad chart
// must NOT get a TRT supply / dispense / regimen answer.
//
// Two layers:
//   1. SERVER-SIDE PRE-FILTER (this file) — if the question is TRT/MH-specific
//      and the patient isn't mens_health, refuse before calling Bedrock and
//      audit the rejection. This is the load-bearing enforcement.
//   2. PROMPT BLOCK (defense-in-depth) — we still tell the model the patient's
//      scope so a borderline question that slipped past the regex is steered
//      toward "out of scope for this patient" rather than confabulated TRT
//      guidance.

type PatientScope = {
  isMensHealth: boolean;
  isPrimaryCare: boolean;
  isLongevity: boolean;
  isMentalHealth: boolean;
  clinic: string | null;
  clientTypeKey: string | null;
  tags: string[];
};

// Keywords that make a question unambiguously TRT- or Men's-Health-specific.
// Kept narrow on purpose: lab-only mentions (e.g. "what was their last
// testosterone level") are NOT in this list because a primary-care patient
// can legitimately have a testosterone lab drawn — only therapy/regimen/
// dispense framing flips the question into the MH-only bucket.
const TRT_INTENT_PATTERNS: RegExp[] = [
  /\btrt\b/i,
  /testosterone\s+(?:replacement|therapy|regimen|cypionate|enanthate|propionate|supply|refill|injection|dose|dispense|protocol|cycle)/i,
  /\bcypionate\b/i,
  /\benanthate\b/i,
  /\bpropionate\b/i,
  /\bsupply\s+status\b/i,
  /\bnmh\s+trt\b/i,
  /men'?s\s*health/i,
  /\bmensheal/i,
  /\bhcg\b/i,
  /\bgonadorelin\b/i,
  /\banastrozole\b/i,
  /\barimidex\b/i,
  /\benclomiphene\b/i,
  /\bclomiphene\b/i,
  /\btamoxifen\b/i,
  /\baromatase\s+inhibitor/i,
  /\bvial\b.*\b(?:trt|testosterone|t\b)/i,
  /\bsyringe\b.*\b(?:trt|testosterone|t\b)/i,
];

function detectTRTIntent(question: string, history: ChatMessage[]): boolean {
  const haystack = [
    question,
    ...history.map((m) => m.content),
  ]
    .filter(Boolean)
    .join('\n');
  return TRT_INTENT_PATTERNS.some((re) => re.test(haystack));
}

async function fetchPatientScope(patientId: string): Promise<PatientScope | null> {
  const rows = await query<{
    clinic: string | null;
    client_type_key: string | null;
    ghl_tags: string[] | null;
  }>(
    `SELECT clinic, client_type_key, ghl_tags
       FROM patients
      WHERE patient_id = $1::uuid
      LIMIT 1`,
    [patientId]
  );
  const row = rows[0];
  if (!row) return null;

  const clinic = (row.clinic || '').toLowerCase();
  const clientTypeKey = (row.client_type_key || '').toLowerCase();
  const tagsRaw = Array.isArray(row.ghl_tags) ? row.ghl_tags : [];
  const tags = tagsRaw.map((t) => String(t || '').toLowerCase().trim()).filter(Boolean);

  // Same canonical detection used by app/api/jarvis/peptide-eligibility/route.ts.
  // GHL "trt"/"testosterone" tag is treated as MH-equivalent because those
  // tags only get applied to enrolled Men's Health patients.
  const isMensHealth =
    clinic.includes('men') ||
    clinic.includes('nowmenshealth') ||
    clientTypeKey === 'nowmenshealth' ||
    clientTypeKey === 'qbo_tcmh_180_month' ||
    clientTypeKey === 'jane_tcmh_180_month' ||
    clientTypeKey === 'qbo_f_f_fr_veteran_140_month' ||
    clientTypeKey === 'jane_f_f_fr_veteran_140_month' ||
    clientTypeKey === 'mens_health_qbo' ||
    tags.includes('trt') ||
    tags.includes('testosterone') ||
    tags.includes('men\'s health') ||
    tags.includes('mens health');

  const isPrimaryCare =
    clinic.includes('primary') ||
    clinic.includes('nowprimary') ||
    clientTypeKey === 'nowprimarycare' ||
    clientTypeKey === 'primecare_premier_50_month' ||
    clientTypeKey === 'primecare_elite_100_month' ||
    clientTypeKey === 'ins_supp_60_month';

  const isLongevity =
    clinic.includes('longevity') || clientTypeKey === 'nowlongevity';

  const isMentalHealth =
    clinic.includes('mental') || clientTypeKey === 'nowmentalhealth';

  return {
    isMensHealth,
    isPrimaryCare,
    isLongevity,
    isMentalHealth,
    clinic: row.clinic,
    clientTypeKey: row.client_type_key,
    tags,
  };
}

// ─── System prompt (strict-grounding + §6 safety guardrails) ─────────────────

const SYSTEM_PROMPT = `You are an AI clinical decision-support assistant embedded in the Granite Mountain Health staff iPad app. A clinician (admin) has opened a specific patient's chart and is asking you a question about that patient.

**Your role**
- You are a decision-support tool, NOT a prescriber. You do not make orders, do not finalize diagnoses, and do not replace clinical judgment. Always defer the final decision to the human provider.
- You only ever discuss the ONE patient whose chart appears in <patient_chart> below.
- You speak with the confidence and concision of a senior clinical pharmacist / hospitalist — direct, structured, and willing to commit to a recommendation when the evidence supports it. Do not pad answers with disclaimers; one closing line is enough.

**Information in <patient_chart>**
- demographics, problems (confirmed/removed dx + recent ICD-10 from scribe), regimen.medications (Healthie active med list — name, dose, frequency, route, directions), regimen.recentTrtDispenses, regimen.recentPeptideDispenses, allergies.nkda + allergies.items[], labs.lastLabDate / nextLabDate / status, labs.recentReviewed (per-panel summaries with abnormalCount + flaggedSummary), **labs.recentResults[]** (real analyte values: analyte / value / unit / range / flag / collectedAt — flags 'L','H','LL','HH' = abnormal), labs.abnormalAnalytes (quick list of abnormal names), notes.general, notes.interestingFacts, **documents.recentScribeNotes[]** (truncated visit-note narratives with icd10) and **documents.recentSupplementary[]** (generated work / school / discharge / care-plan notes — kind + excerpt).

**SCOPE GATE — non-negotiable**
- <patient_scope> tells you which program(s) this patient is in (Men's Health, Primary Care, Longevity, Mental Health).
- If the patient is NOT in Men's Health, you MUST NOT answer TRT- or Men's-Health-program-specific questions (supply / refill / dispense, T-injection dosing, cypionate/enanthate/propionate regimens, HCG, gonadorelin, anastrozole/arimidex, enclomiphene/clomiphene, AI management). The server already blocks the obvious ones; do not improvise around a borderline case that slipped through.
- Lab values are always fair game when present — the gate is on therapy guidance, not on reading labs.

**STRICT GROUNDING — non-negotiable**
- Patient-specific facts come ONLY from <patient_chart>. Do not invent meds, allergies, diagnoses, labs, visits, or history that aren't in the chart.
- If the chart lacks what's needed, say so plainly: "That isn't documented in this chart — needs to be added before I can answer." Name the specific section that's missing.
- When you cite a patient fact, tag the section in parentheses: "(per Allergies)", "(per labs.recentResults)", "(per Problems)", "(per documents.recentScribeNotes)". The UI uses these to surface source chips.

**CLINICAL CONSENSUS — answer with confidence, not summary**
- For clinical questions (dosing, interactions, work-up, "should we…?"), don't just summarize the chart — answer against **current standard-of-care guidance**: USPSTF, ADA, AHA/ACC, KDIGO, AACE, IDSA, ACOG, etc. as relevant. You may cite guideline bodies by name; do NOT cite specific years/page numbers unless certain.
- Combine the patient-specific chart with general clinical consensus. Be explicit about which is which:
   • "Chart shows X" → patient-specific
   • "Guidelines (e.g. KDIGO) recommend Y in this scenario" → consensus
   • "Therefore, for this patient: Z" → your synthesized recommendation
- End every clinical answer with a **Confidence** line (HIGH / MODERATE / LOW) and one sentence of why. HIGH = clear guideline + complete chart data; MODERATE = guidance is clear but chart data has a gap; LOW = chart is incomplete OR the question sits in an area without strong consensus.

**Auto-applied clinical caveats**
- **Allergies — empty list is NOT NKDA.** If allergies.nkda is false AND allergies.items is empty, treat allergy status as **UNCONFIRMED** for any prescribing-relevant answer. Say so explicitly.
- **Renal dosing.** If confirmed dx, recent ICD-10, or labs imply CKD (N18.x, AKI, ESRD, dialysis, low eGFR / high creatinine), proactively raise renal-dosing flags (eGFR cutoffs, nephrotoxic agents, K+-sparing interactions, contrast caution). Pull the actual eGFR/creatinine value from labs.recentResults if present.
- **Drug interactions.** When meds are involved, scan regimen.medications against what's being added/asked and call out specific interactions (drug + mechanism + clinical effect). Don't be vague.
- **Stale / degraded data.** If meta.degradedSections is non-empty, name the affected section in your answer and lower your confidence accordingly.
- **Pediatric / geriatric / pregnancy.** Surface age-appropriate dosing or contraindications when prescribing is in play.
- **Lab freshness.** If labs.lastLabDate is > 6 months old, say so when answering anything about labs or dosing that depends on them.

**Formatting (iPad slide-over, narrow column)**
- Use clean, scannable Markdown. Short paragraphs, tight bullets ('- ' or numbered), **bold** for the key take-home only — never whole sentences. No giant SOAP blocks. No raw asterisk runs.
- Default structure when answering a clinical question:
   1. **Bottom line** — one or two sentences with the answer.
   2. **Key chart facts** — bullets, each tagged with its source section.
   3. **Guideline basis** — one or two sentences naming the relevant consensus.
   4. **Recommendation for this patient** — concrete next step(s).
   5. **Confidence: HIGH / MODERATE / LOW** — one sentence of why.
- For pure summary / lookup questions ("what's their last A1C?"), skip the scaffolding and just answer.
- Close prescribing-related answers with one line: "Decision-support only — verify and finalize."`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

type ChatMessage = { role: 'user' | 'assistant'; content: string };

type AskRequestBody = {
  question?: string;
  conversation?: ChatMessage[];
};

function trimQuestion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Keep the audit log readable; truncate runaway pastes.
  return trimmed.slice(0, 4000);
}

function sanitizeConversation(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  // Cap to the last 6 turns so the prompt stays within budget.
  for (const msg of raw.slice(-6)) {
    if (!msg || typeof msg !== 'object') continue;
    const role = (msg as ChatMessage).role;
    const content = (msg as ChatMessage).content;
    if ((role === 'user' || role === 'assistant') && typeof content === 'string' && content.trim()) {
      out.push({ role, content: content.trim().slice(0, 4000) });
    }
  }
  return out;
}

/**
 * Serialize the assembled chart as a compact JSON block the model can quote
 * from. We pass the whole object (no field-level pruning) because the
 * assembler already bounds list sizes (recent-5 of each).
 */
function serializeChart(chart: PatientChart): string {
  return JSON.stringify(chart, null, 2);
}

/**
 * List the sections that actually had content. The iPad UI shows these as
 * "sources" — expandable chips next to the answer. Computed server-side so
 * the client doesn't have to re-traverse the chart.
 */
function summarizeSections(chart: PatientChart): string[] {
  const sections: string[] = [];
  if (chart.demographics.fullName) sections.push('Demographics');
  if (
    chart.problems.confirmed.length > 0 ||
    chart.problems.removed.length > 0 ||
    chart.problems.recentIcd10FromScribe.length > 0
  ) {
    sections.push('Problems');
  }
  if (chart.regimen.medications.length > 0 || chart.regimen.summary) sections.push('Regimen');
  if (chart.regimen.recentTrtDispenses.length > 0) sections.push('Recent TRT');
  if (chart.regimen.recentPeptideDispenses.length > 0) sections.push('Recent peptides');
  if (chart.allergies.nkda || chart.allergies.items.length > 0) sections.push('Allergies');
  if (chart.labs.recentResults.length > 0) sections.push('Lab values');
  else if (chart.labs.lastLabDate || chart.labs.recentReviewed.length > 0) sections.push('Labs');
  if (chart.documents.recentScribeNotes.length > 0) sections.push('Visit notes');
  if (chart.documents.recentSupplementary.length > 0) sections.push('Generated docs');
  if (chart.notes.general || chart.notes.interestingFacts) sections.push('Chart notes');
  return sections;
}

async function writeAudit(input: {
  userId: string;
  userEmail: string;
  patientId: string | null;
  healthieClientId: string | null;
  question: string;
  status: 'completed' | 'rejected' | 'error';
  summary: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO agent_action_log
         (agent_name, action_type, category, summary, details, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        'patient_chart_ai',
        'ask',
        'clinical_decision_support',
        input.summary,
        JSON.stringify({
          user_id: input.userId,
          user_email: input.userEmail,
          patient_id: input.patientId,
          healthie_client_id: input.healthieClientId,
          question: input.question,
          model: CLAUDE_MODEL_ID,
          prompt_version: PROMPT_VERSION,
          ...(input.details ?? {}),
        }),
        input.status,
      ]
    );
  } catch (err) {
    // Audit must never block the user-facing call. Log it loudly so it shows
    // up in pm2 logs / monitoring; don't rethrow.
    console.error('[ipad/patient/ask] audit log write failed:', err);
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const resolvedParams = params instanceof Promise ? await params : params;
  const rawId = resolvedParams.id;

  // 1. Auth — staff with read entitlement only. iPad uses the session cookie.
  let user;
  try {
    user = await requireApiUser(request, 'read');
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    throw error;
  }

  // 1b. ADMIN-ONLY GATE (engine option A, 2026-05-27).
  // The Ask-AI feature is locked to Phil's admin account while we tune the
  // engine and chart context. This is the load-bearing boundary — the iPad
  // app.js also hides the button, but anyone forging a request straight to the
  // route still has to clear this check. The internal-auth sentinel user
  // (`api@internal`, used by server-to-server callers) is also allowed
  // because requireApiUser stamps it with role='admin' and we trust the
  // caller's signed header.
  const callerEmail = (user.email || '').trim().toLowerCase();
  const isAskAiAllowed = callerEmail === ASK_AI_ADMIN_EMAIL || callerEmail === 'api@internal';
  if (!isAskAiAllowed) {
    await writeAudit({
      userId: user.user_id,
      userEmail: user.email,
      patientId: null,
      healthieClientId: null,
      question: '(blocked before parse)',
      status: 'rejected',
      summary: `Ask AI denied — non-admin caller ${user.email}`,
      details: { reason: 'admin_only_gate', allowed: ASK_AI_ADMIN_EMAIL },
    });
    return NextResponse.json(
      { success: false, error: 'forbidden', reason: 'admin_only' },
      { status: 403 }
    );
  }

  // 2. Parse + validate the question
  let body: AskRequestBody;
  try {
    body = (await request.json()) as AskRequestBody;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const question = trimQuestion(body.question);
  if (!question) {
    return NextResponse.json(
      { success: false, error: 'question is required (non-empty string)' },
      { status: 400 }
    );
  }
  const history = sanitizeConversation(body.conversation);

  // 3. Assemble the chart. Returns null when the identifier maps to no patient.
  let chart: PatientChart | null;
  try {
    chart = await assemblePatientChart(rawId);
  } catch (err) {
    console.error('[ipad/patient/ask] chart assembly failed:', err);
    await writeAudit({
      userId: user.user_id,
      userEmail: user.email,
      patientId: null,
      healthieClientId: null,
      question,
      status: 'error',
      summary: `Chart assembly failed for ${rawId}`,
      details: { error: err instanceof Error ? err.message : String(err) },
    });
    return NextResponse.json(
      { success: false, error: 'Failed to assemble patient chart' },
      { status: 500 }
    );
  }

  if (!chart) {
    await writeAudit({
      userId: user.user_id,
      userEmail: user.email,
      patientId: null,
      healthieClientId: null,
      question,
      status: 'rejected',
      summary: `Patient not found for identifier ${rawId}`,
    });
    return NextResponse.json(
      { success: false, error: `Patient not found for ID: ${rawId}` },
      { status: 404 }
    );
  }

  // 3b. SCOPE GATE — fetch the patient's program enrollment (clinic +
  // client_type_key + ghl_tags) and refuse TRT/MH-specific questions for
  // patients who aren't enrolled in NowMensHealth.Care. This is the
  // load-bearing server-side enforcement; the prompt block below is
  // defense-in-depth.
  let scope: PatientScope;
  try {
    const fetched = await fetchPatientScope(chart.patientId);
    scope = fetched ?? {
      isMensHealth: false,
      isPrimaryCare: false,
      isLongevity: false,
      isMentalHealth: false,
      clinic: null,
      clientTypeKey: null,
      tags: [],
    };
  } catch (err) {
    // Scope fetch failing is a security-critical event — we cannot prove the
    // patient IS mens-health, so we must default to "scope unknown" and apply
    // the same gate as for non-MH patients.
    console.error('[ipad/patient/ask] scope fetch failed, defaulting to closed:', err);
    scope = {
      isMensHealth: false,
      isPrimaryCare: false,
      isLongevity: false,
      isMentalHealth: false,
      clinic: null,
      clientTypeKey: null,
      tags: [],
    };
  }

  const isTrtQuestion = detectTRTIntent(question, history);
  if (isTrtQuestion && !scope.isMensHealth) {
    const enrolledIn =
      scope.isPrimaryCare ? 'NowPrimary.Care'
      : scope.isLongevity ? 'NOWLongevity.Care'
      : scope.isMentalHealth ? 'NOWMentalHealth.Care'
      : scope.clinic
        ? scope.clinic
        : 'no Men\'s Health program';
    const refusal =
      `This patient is enrolled in ${enrolledIn}, not NowMensHealth.Care. ` +
      `TRT- and Men's-Health-specific guidance (supply status, dispense / refill, ` +
      `testosterone regimens, HCG, AI/gonadorelin, etc.) is out of scope for this ` +
      `chart. To get that answer, enroll the patient in NowMensHealth.Care first, ` +
      `or route the question to the Men's Health team.\n\n` +
      `Decision-support only — verify and finalize.`;

    await writeAudit({
      userId: user.user_id,
      userEmail: user.email,
      patientId: chart.patientId,
      healthieClientId: chart.healthieClientId,
      question,
      status: 'rejected',
      summary: 'Out-of-scope TRT/MH question for non-mens_health patient',
      details: {
        reason: 'scope_gate_trt_for_non_mens_health',
        scope: {
          isMensHealth: scope.isMensHealth,
          isPrimaryCare: scope.isPrimaryCare,
          isLongevity: scope.isLongevity,
          isMentalHealth: scope.isMentalHealth,
          clinic: scope.clinic,
          clientTypeKey: scope.clientTypeKey,
          tagCount: scope.tags.length,
        },
      },
    });

    return NextResponse.json(
      {
        success: false,
        error: 'out_of_scope',
        data: {
          answer: refusal,
          sources: [],
          model: null,
          promptVersion: PROMPT_VERSION,
          patient: {
            patientId: chart.patientId,
            healthieClientId: chart.healthieClientId,
            fullName: chart.demographics.fullName,
          },
          scopeGate: {
            blocked: true,
            reason: 'trt_for_non_mens_health',
            enrolledIn,
          },
        },
      },
      { status: 403 }
    );
  }

  // 4. Build the Claude messages payload. The system prompt + chart context go
  // into Anthropic's `system` field; the conversation history + new question
  // become `messages`. The chart appears once, inside <patient_chart>, and the
  // computed program enrollment goes inside <patient_scope> so the model has
  // explicit context even on the questions the pre-filter let through.
  const programs: string[] = [];
  if (scope.isMensHealth) programs.push('NowMensHealth.Care');
  if (scope.isPrimaryCare) programs.push('NowPrimary.Care');
  if (scope.isLongevity) programs.push('NOWLongevity.Care');
  if (scope.isMentalHealth) programs.push('NOWMentalHealth.Care');
  const scopeBlock = JSON.stringify(
    {
      enrolledPrograms: programs,
      isMensHealth: scope.isMensHealth,
      isPrimaryCare: scope.isPrimaryCare,
      isLongevity: scope.isLongevity,
      isMentalHealth: scope.isMentalHealth,
      rawClinic: scope.clinic,
      clientTypeKey: scope.clientTypeKey,
    },
    null,
    2
  );

  const systemBlock = `${SYSTEM_PROMPT}

<patient_scope>
${scopeBlock}
</patient_scope>

<patient_chart>
${serializeChart(chart)}
</patient_chart>`;

  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: question },
  ];

  const claudeRequest = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1500,
    temperature: 0.2,
    system: systemBlock,
    messages,
  };

  // 5. Invoke Bedrock
  let answer = '';
  let usage: { input_tokens?: number; output_tokens?: number } | null = null;
  const startedAt = Date.now();
  try {
    const cmd = new InvokeModelCommand({
      modelId: CLAUDE_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(claudeRequest),
    });
    const response = await bedrock.send(cmd);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    if (!responseBody?.content || !Array.isArray(responseBody.content) || responseBody.content.length === 0) {
      console.error('[ipad/patient/ask] invalid Bedrock response shape:', responseBody);
      await writeAudit({
        userId: user.user_id,
        userEmail: user.email,
        patientId: chart.patientId,
        healthieClientId: chart.healthieClientId,
        question,
        status: 'error',
        summary: 'Bedrock returned no content',
      });
      return NextResponse.json(
        { success: false, error: 'AI returned no content' },
        { status: 502 }
      );
    }

    // Concatenate any text blocks (Bedrock can return multiple).
    answer = responseBody.content
      .filter((b: { type?: string; text?: string }) => b.type === 'text' && typeof b.text === 'string')
      .map((b: { text: string }) => b.text)
      .join('')
      .trim();
    usage = responseBody.usage ?? null;
  } catch (err) {
    console.error('[ipad/patient/ask] Bedrock invocation failed:', err);
    await writeAudit({
      userId: user.user_id,
      userEmail: user.email,
      patientId: chart.patientId,
      healthieClientId: chart.healthieClientId,
      question,
      status: 'error',
      summary: 'Bedrock invocation failed',
      details: { error: err instanceof Error ? err.message : String(err) },
    });
    return NextResponse.json(
      { success: false, error: 'AI call failed' },
      { status: 502 }
    );
  }

  const sources = summarizeSections(chart);

  // 6. Audit the successful call
  await writeAudit({
    userId: user.user_id,
    userEmail: user.email,
    patientId: chart.patientId,
    healthieClientId: chart.healthieClientId,
    question,
    status: 'completed',
    summary: `Chart Q&A answered (${answer.length} chars, ${Date.now() - startedAt}ms)`,
    details: {
      answer_chars: answer.length,
      latency_ms: Date.now() - startedAt,
      degraded_sections: chart.meta.degradedSections,
      usage,
      conversation_turns: history.length,
    },
  });

  return NextResponse.json({
    success: true,
    data: {
      answer,
      sources,
      model: CLAUDE_MODEL_ID,
      promptVersion: PROMPT_VERSION,
      patient: {
        patientId: chart.patientId,
        healthieClientId: chart.healthieClientId,
        fullName: chart.demographics.fullName,
      },
      meta: {
        degradedSections: chart.meta.degradedSections,
        latencyMs: Date.now() - startedAt,
      },
    },
  });
}
