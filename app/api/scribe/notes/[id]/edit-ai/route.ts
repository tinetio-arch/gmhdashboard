import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Haiku 3.5 for fast triage, Haiku 4.5 for the actual edit (fast + precise)
const bedrock = new BedrockRuntimeClient({ region: 'us-east-2' });
const HAIKU_MODEL = 'us.anthropic.claude-3-5-haiku-20241022-v1:0';
const EDIT_MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

// POST: AI-powered note editing
// Matches Telegram bot's "Edit via AI" mode (L2067-2168)
// Send an edit instruction → Gemini returns updated content
export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try { await requireApiUser(request, 'write'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const noteId = params.id;
        const { edit_instruction, section, doc_type } = await request.json();

        if (!edit_instruction) {
            return NextResponse.json(
                { success: false, error: 'edit_instruction is required' },
                { status: 400 }
            );
        }

        // Fetch current note
        const [note] = await query<any>(
            'SELECT * FROM scribe_notes WHERE note_id = $1',
            [noteId]
        );
        if (!note) {
            return NextResponse.json({ success: false, error: 'Note not found' }, { status: 404 });
        }

        // ==================== SUPPLEMENTARY DOC EDITING ====================
        // If doc_type is specified, edit a supplementary document instead of SOAP
        const validDocTypes = ['work_note', 'school_note', 'discharge_instructions', 'care_plan'];
        if (doc_type && validDocTypes.includes(doc_type)) {
            const docLabels: Record<string, string> = {
                work_note: 'Work Excuse Note',
                school_note: 'School Excuse Note',
                discharge_instructions: 'Discharge Instructions',
                care_plan: 'Care Plan',
            };
            const docLabel = docLabels[doc_type] || doc_type;
            const existingDocs = note.supplementary_docs || {};
            const docEntry = existingDocs[doc_type];

            if (!docEntry?.content) {
                return NextResponse.json(
                    { success: false, error: `No ${docLabel} found to edit — generate one first` },
                    { status: 400 }
                );
            }

            const editPrompt = `You are a medical document editor for NowOptimal Network. Apply the provider's edit instruction EXACTLY as requested to this ${docLabel}.

**RULES:**
1. **DO EXACTLY WHAT THE PROVIDER ASKS** — if they say remove something, remove it. If they say add something, add it.
2. Keep the formatting structure (headers, bullet points, line breaks)
3. For work/school notes: do NOT include specific diagnosis details (HIPAA compliant) unless the provider explicitly asks
4. Return ONLY the updated document — no commentary, no explanation, no preamble

**PROVIDER'S EDIT INSTRUCTION:** ${edit_instruction}

**CURRENT ${docLabel.toUpperCase()}:**
${docEntry.content}

**UPDATED ${docLabel.toUpperCase()}:**`;

            const claudeRequest = {
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 8000,
                temperature: 0.1,
                messages: [{ role: 'user', content: editPrompt }]
            };

            const command = new InvokeModelCommand({
                modelId: EDIT_MODEL,
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify(claudeRequest)
            });

            const response = await bedrock.send(command);
            const responseBody = JSON.parse(new TextDecoder().decode(response.body));

            if (!responseBody.content || responseBody.content.length === 0) {
                return NextResponse.json(
                    { success: false, error: 'AI editing failed — invalid response' },
                    { status: 502 }
                );
            }

            const updatedContent = responseBody.content[0].text;
            console.log(`[Scribe:AI-Edit] Claude edited ${docLabel}: ${updatedContent.length} chars`);

            // Update supplementary_docs JSONB
            existingDocs[doc_type] = {
                ...docEntry,
                content: updatedContent,
                edited_at: new Date().toISOString(),
            };

            await query(
                `UPDATE scribe_notes SET supplementary_docs = $1, updated_at = NOW() WHERE note_id = $2`,
                [JSON.stringify(existingDocs), noteId]
            );

            return NextResponse.json({
                success: true,
                data: {
                    note_id: noteId,
                    doc_type,
                    section_edited: doc_type,
                    edit_instruction,
                    updated_content: updatedContent,
                },
            });
        }

        // ==================== SOAP SECTION EDITING ====================
        // Determine what to edit — specific section or full note
        const validSections = ['soap_subjective', 'soap_objective', 'soap_assessment', 'soap_plan', 'full_note_text'];
        const targetSection = section && validSections.includes(section) ? section : null;

        const sectionLabels: Record<string, string> = {
            soap_subjective: 'Subjective',
            soap_objective: 'Objective',
            soap_assessment: 'Assessment',
            soap_plan: 'Plan',
            full_note_text: 'Full Note',
        };

        let currentContent: string;
        let docLabel: string;
        let effectiveSection: string | null = targetSection;

        if (targetSection) {
            currentContent = note[targetSection] || '';
            docLabel = sectionLabels[targetSection] || targetSection;
        } else {
            // Auto-detect: edit each section individually that might be affected
            // Send ALL sections as context but instruct Claude to return only what changes
            // Default strategy: edit all 4 sections independently and keep the ones that change
            // This avoids the fragile full-SOAP re-parsing

            // Build combined content for Claude to see full context
            currentContent = [
                note.soap_subjective ? `SUBJECTIVE\n${note.soap_subjective}` : '',
                note.soap_objective ? `OBJECTIVE\n${note.soap_objective}` : '',
                note.soap_assessment ? `ASSESSMENT\n${note.soap_assessment}` : '',
                note.soap_plan ? `PLAN\n${note.soap_plan}` : '',
            ].filter(Boolean).join('\n\n');
            docLabel = 'SOAP Note';
        }

        if (!currentContent.trim()) {
            return NextResponse.json(
                { success: false, error: `No content to edit in ${docLabel}` },
                { status: 400 }
            );
        }

        // Call Claude 3 Haiku for intelligent editing
        const editPrompt = `You are a medical scribe editor for a clinical SOAP note at NowOptimal Network. Apply the provider's edit instruction EXACTLY as requested.

**RULES:**
1. **DO EXACTLY WHAT THE PROVIDER ASKS** — if they say remove something, remove it. If they say add something, add it. If they say change something, change it. Do not second-guess the provider's clinical judgment.
2. Keep the formatting structure (bold headers, bullet points, line breaks)
3. Preserve ICD-10 codes UNLESS the provider specifically says to remove or change a diagnosis
4. If the provider removes a diagnosis, also remove its ICD-10 code from the Assessment section
5. If the provider adds lot numbers, NDC numbers, or specific product details, include them exactly as stated
6. If the provider says a procedure was NOT performed by them (e.g., "I did not inject cortisone, that was another provider"), remove it from the Objective/procedures performed and note it only in the HPI as patient-reported history
7. Return ONLY the updated ${docLabel} — no commentary, no explanation, no preamble

**PROVIDER'S EDIT INSTRUCTION:** ${edit_instruction}

**CURRENT ${docLabel.toUpperCase()}:**
${currentContent}

**UPDATED ${docLabel.toUpperCase()}:**`;

        let updatedContent: string;
        try {
            const claudeRequest = {
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 8000,
                temperature: 0.1,  // Medical edits need to be precise
                messages: [
                    {
                        role: 'user',
                        content: editPrompt
                    }
                ]
            };

            const command = new InvokeModelCommand({
                modelId: EDIT_MODEL,
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify(claudeRequest)
            });

            const response = await bedrock.send(command);
            const responseBody = JSON.parse(new TextDecoder().decode(response.body));

            if (!responseBody.content || responseBody.content.length === 0) {
                console.error('[Scribe:AI-Edit] Invalid Claude response:', responseBody);
                return NextResponse.json(
                    { success: false, error: 'AI editing failed — invalid response from Claude' },
                    { status: 502 }
                );
            }

            updatedContent = responseBody.content[0].text;
            console.log(`[Scribe:AI-Edit] Claude edited ${docLabel}: ${updatedContent.length} chars`);
        } catch (error: any) {
            console.error('[Scribe:AI-Edit] Claude error:', error);
            return NextResponse.json(
                { success: false, error: `AI editing failed: ${error.message}` },
                { status: 502 }
            );
        }

        // Track what changed across all edit paths
        const allChanges: { section: string; description: string }[] = [];

        // Save the updated content
        if (targetSection) {
            // Single section edit — straightforward
            await query(
                `UPDATE scribe_notes SET ${targetSection} = $1, updated_at = NOW() WHERE note_id = $2`,
                [updatedContent, noteId]
            );
            const origLen = (note[targetSection] || '').length;
            const diff = origLen - updatedContent.length;
            allChanges.push({
                section: sectionLabels[targetSection] || targetSection,
                description: diff > 0 ? `${diff} chars removed` : `${Math.abs(diff)} chars added`,
            });
        } else {
            // ── STEP 1: Fast Haiku triage — which sections need editing? (~1-2 sec) ──
            const triagePrompt = `Given this edit instruction for a SOAP note, which sections need to be changed? Reply with ONLY a comma-separated list from: Subjective, Objective, Assessment, Plan

Edit instruction: "${edit_instruction}"

Reply with ONLY the section names, nothing else. Example: "Plan" or "Subjective, Plan" or "Assessment, Plan"`;

            let sectionsToEdit: string[] = ['Plan']; // fallback
            try {
                const triageCmd = new InvokeModelCommand({
                    modelId: HAIKU_MODEL,
                    contentType: 'application/json',
                    accept: 'application/json',
                    body: JSON.stringify({
                        anthropic_version: 'bedrock-2023-05-31',
                        max_tokens: 50,
                        temperature: 0,
                        messages: [{ role: 'user', content: triagePrompt }]
                    })
                });
                const triageResp = await bedrock.send(triageCmd);
                const triageBody = JSON.parse(new TextDecoder().decode(triageResp.body));
                const triageText = (triageBody.content?.[0]?.text || 'Plan').trim();
                sectionsToEdit = triageText.split(/,\s*/).map((s: string) => s.trim()).filter((s: string) =>
                    ['Subjective', 'Objective', 'Assessment', 'Plan'].includes(s)
                );
                if (sectionsToEdit.length === 0) sectionsToEdit = ['Plan'];
            } catch (triageErr) {
                console.warn('[Scribe:AI-Edit] Triage failed, defaulting to Plan:', triageErr);
            }

            console.log(`[Scribe:AI-Edit] Triage → editing: ${sectionsToEdit.join(', ')}`);

            // ── STEP 2: Sonnet edits only the affected sections (parallel) ──
            const sectionMap: Record<string, { key: string; content: string }> = {
                'Subjective': { key: 'soap_subjective', content: note.soap_subjective || '' },
                'Objective': { key: 'soap_objective', content: note.soap_objective || '' },
                'Assessment': { key: 'soap_assessment', content: note.soap_assessment || '' },
                'Plan': { key: 'soap_plan', content: note.soap_plan || '' },
            };

            const editResults = await Promise.allSettled(sectionsToEdit.map(async (sName) => {
                const s = sectionMap[sName];
                if (!s || !s.content.trim()) return null;

                const sPrompt = `You are a precise medical scribe editor. Apply the provider's changes to this ${sName} section.

RULES:
1. Apply ALL requested changes relevant to this section
2. For removals: delete the specific sentence/bullet — not the entire section
3. For additions: add in the appropriate place
4. Preserve ALL formatting: bold (**), bullets (-), line breaks, ICD-10 codes
5. Do NOT rewrite, rephrase, or summarize anything the provider didn't mention
6. Return ONLY the updated section content — no headers, no commentary

**PROVIDER'S INSTRUCTION:** ${edit_instruction}

**FULL NOTE (context only):**
${currentContent}

**CURRENT ${sName.toUpperCase()}:**
${s.content}`;

                const cmd = new InvokeModelCommand({
                    modelId: EDIT_MODEL,
                    contentType: 'application/json',
                    accept: 'application/json',
                    body: JSON.stringify({
                        anthropic_version: 'bedrock-2023-05-31',
                        max_tokens: 8000,
                        temperature: 0,
                        messages: [{ role: 'user', content: sPrompt }]
                    })
                });

                const resp = await bedrock.send(cmd);
                const body = JSON.parse(new TextDecoder().decode(resp.body));
                return { key: s.key, name: sName, content: s.content, result: body.content?.[0]?.text?.trim() || '' };
            }));

            for (const r of editResults) {
                if (r.status !== 'fulfilled' || !r.value) continue;
                const { key, name, content, result: edited } = r.value;
                if (!edited || edited === content.trim()) continue;

                await query(
                    `UPDATE scribe_notes SET ${key} = $1, updated_at = NOW() WHERE note_id = $2`,
                    [edited, noteId]
                );

                // Build complete diff
                const origLines = content.trim().split('\n');
                const newLines = edited.split('\n');
                const removedLines = origLines.filter(l => !newLines.includes(l)).map(l => l.trim()).filter(l => l.length > 3);
                const addedLines = newLines.filter(l => !origLines.includes(l)).map(l => l.trim()).filter(l => l.length > 3);

                const parts: string[] = [];
                for (const rl of removedLines) parts.push(`❌ ${rl}`);
                for (const al of addedLines) parts.push(`✅ ${al}`);
                const desc = parts.length > 0 ? parts.join('\n') : `${Math.abs(content.length - edited.length)} chars changed`;

                allChanges.push({ section: name, description: desc });
                console.log(`[Scribe:AI-Edit] Updated ${name}: ${desc.split('\n')[0]}`);
            }

            if (allChanges.length === 0) {
                console.log('[Scribe:AI-Edit] No sections changed');
            }
        }

        // Fetch the updated note
        const [updatedNote] = await query<any>(
            'SELECT * FROM scribe_notes WHERE note_id = $1',
            [noteId]
        );

        // If allChanges is empty, compare original note to updated note to detect any diffs
        if (allChanges.length === 0) {
            const fields = [
                { key: 'soap_subjective', name: 'Subjective' },
                { key: 'soap_objective', name: 'Objective' },
                { key: 'soap_assessment', name: 'Assessment' },
                { key: 'soap_plan', name: 'Plan' },
            ];
            for (const f of fields) {
                const orig = (note[f.key] || '').trim();
                const updated = (updatedNote[f.key] || '').trim();
                if (orig !== updated) {
                    const diff = orig.length - updated.length;
                    allChanges.push({
                        section: f.name,
                        description: diff > 0 ? `${diff} chars removed` : `${Math.abs(diff)} chars added`,
                    });
                }
            }
        }

        return NextResponse.json({
            success: true,
            data: {
                note_id: noteId,
                section_edited: targetSection || 'full',
                edit_instruction,
                updated_note: updatedNote,
                changes_summary: allChanges,
            },
        });
    } catch (error) {
        console.error('[Scribe:AI-Edit] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}
