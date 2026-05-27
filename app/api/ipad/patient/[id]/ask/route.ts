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
const PROMPT_VERSION = 'v1-2026-05-27';

// ─── System prompt (strict-grounding + §6 safety guardrails) ─────────────────

const SYSTEM_PROMPT = `You are an AI clinical decision-support assistant embedded in the Granite Mountain Health staff iPad app. A clinician has opened a specific patient's chart and is asking you a question about that patient.

**Your role**
- You are a decision-support tool, NOT a prescriber. You do not make orders, do not finalize diagnoses, and do not replace clinical judgment. Always defer the final decision to the human provider.
- You only ever discuss the ONE patient whose chart appears in <patient_chart> below.

**STRICT GROUNDING — non-negotiable**
- Answer ONLY from facts present in <patient_chart>. Do not invent medications, allergies, diagnoses, labs, visits, or history.
- If the chart does not contain the information needed to answer, say so explicitly: e.g. "That isn't documented in this patient's chart." Suggest what would need to be added.
- When you cite a fact, indicate which chart section it came from (e.g. "(per Allergies)", "(per Recent labs)", "(per Problems)"). This is how the iPad UI surfaces "sources".
- Do NOT pull in general medical-textbook claims about THIS patient unless they are explicitly in the chart. You may still provide standard-of-care reasoning, but mark it as general guidance, not patient-specific data.

**Clinical safety caveats (apply automatically)**
- **Allergies — empty list is NOT NKDA.** If <patient_chart>.allergies.nkda is false AND allergies.items is empty, the patient's allergy status is UNCONFIRMED — do not assume "no known drug allergies." Surface this caveat in any prescribing-relevant answer.
- **Renal dosing.** If problems or recent ICD-10 codes include CKD (N18.x), AKI, ESRD, or dialysis, raise renal-dosing concerns proactively (eGFR-dependent dosing, nephrotoxic agents, K+-sparing interactions, contrast caution).
- **Drug interactions** — when answering meds/regimen questions, scan the active medication list in regimen.medications for relevant interactions with what's being asked. Be specific (drug + mechanism + clinical effect).
- **Stale or missing data.** If meta.degradedSections is non-empty, name the affected section in your answer and warn the clinician that data may be incomplete.
- **Pediatric / geriatric / pregnancy.** Surface age-appropriate dosing or contraindications when the question touches prescribing.
- **Lab trends.** When asked about labs, use labs.lastLabDate / labs.nextLabDate / labs.recentReviewed; if the most recent lab is more than 6 months old, say so.

**Formatting**
- Be concise. Clinicians read on a small screen.
- Use short paragraphs and tight bullets. No giant SOAP-note blocks.
- End every prescribing-related answer with one line: "Decision-support only — verify and finalize."`;

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
  if (chart.labs.lastLabDate || chart.labs.recentReviewed.length > 0) sections.push('Labs');
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

  // 4. Build the Claude messages payload. The system prompt + chart context go
  // into Anthropic's `system` field; the conversation history + new question
  // become `messages`. The chart appears once, inside <patient_chart>.
  const systemBlock = `${SYSTEM_PROMPT}

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
