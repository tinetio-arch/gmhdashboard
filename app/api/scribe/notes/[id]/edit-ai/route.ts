import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
        const { edit_instruction, section } = await request.json();

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

        if (targetSection) {
            currentContent = note[targetSection] || '';
            docLabel = sectionLabels[targetSection] || targetSection;
        } else {
            // Edit full SOAP note
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

        // Call Gemini API for intelligent editing (matching Telegram bot)
        const GEMINI_API_KEY = process.env.GOOGLE_AI_API_KEY;
        if (!GEMINI_API_KEY) {
            return NextResponse.json(
                { success: false, error: 'GOOGLE_AI_API_KEY not configured' },
                { status: 500 }
            );
        }

        const editPrompt = `You are Phil Schafer, NP, editing a medical SOAP note at NowOptimal Network. You are a skilled clinician who maintains high documentation standards.

**CRITICAL RULES:**
1. Maintain clinical accuracy and medical terminology
2. Preserve ALL ICD-10 codes (e.g., E11.9, Z00.00) exactly as written unless specifically instructed to change them
3. Keep the exact formatting structure (bold headers, bullet points, line breaks)
4. Do NOT add information that wasn't in the original note unless the instruction specifically asks for it
5. Do NOT remove important clinical details unless instructed to do so
6. Maintain professional medical documentation tone
7. If editing medications or prescriptions, ensure dosage, route, and frequency remain accurate
8. Return ONLY the updated ${docLabel} with NO additional commentary or explanation

**EDIT INSTRUCTION:** ${edit_instruction}

**CURRENT ${docLabel.toUpperCase()}:**
${currentContent}

**UPDATED ${docLabel.toUpperCase()}:**`;

        const geminiResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: editPrompt }] }],
                    generationConfig: {
                        temperature: 0.1,  // REDUCED: Medical edits need to be precise, not creative
                        maxOutputTokens: 8192,  // INCREASED: Allow longer notes
                    },
                }),
            }
        );

        const geminiResult: any = await geminiResponse.json();
        const updatedContent = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!updatedContent) {
            console.error('[Scribe:AI-Edit] Gemini response:', JSON.stringify(geminiResult).substring(0, 500));
            return NextResponse.json(
                { success: false, error: 'AI editing failed — no content returned from Gemini' },
                { status: 502 }
            );
        }

        // Save the updated content
        if (targetSection) {
            await query(
                `UPDATE scribe_notes SET ${targetSection} = $1, updated_at = NOW() WHERE note_id = $2`,
                [updatedContent, noteId]
            );
        } else {
            // Parse updated full SOAP back into sections
            const subMatch = updatedContent.match(/SUBJECTIVE[\s\S]*?(?=OBJECTIVE|$)/i);
            const objMatch = updatedContent.match(/OBJECTIVE[\s\S]*?(?=ASSESSMENT|$)/i);
            const assMatch = updatedContent.match(/ASSESSMENT[\s\S]*?(?=PLAN|$)/i);
            const planMatch = updatedContent.match(/PLAN[\s\S]*/i);

            await query(`
                UPDATE scribe_notes SET
                    soap_subjective = $1,
                    soap_objective = $2,
                    soap_assessment = $3,
                    soap_plan = $4,
                    full_note_text = $5,
                    updated_at = NOW()
                WHERE note_id = $6
            `, [
                subMatch ? subMatch[0].replace(/^SUBJECTIVE\s*/i, '').trim() : note.soap_subjective,
                objMatch ? objMatch[0].replace(/^OBJECTIVE\s*/i, '').trim() : note.soap_objective,
                assMatch ? assMatch[0].replace(/^ASSESSMENT\s*/i, '').trim() : note.soap_assessment,
                planMatch ? planMatch[0].replace(/^PLAN\s*/i, '').trim() : note.soap_plan,
                updatedContent,
                noteId,
            ]);
        }

        // Fetch the updated note
        const [updatedNote] = await query<any>(
            'SELECT * FROM scribe_notes WHERE note_id = $1',
            [noteId]
        );

        return NextResponse.json({
            success: true,
            data: {
                note_id: noteId,
                section_edited: targetSection || 'full',
                edit_instruction,
                updated_note: updatedNote,
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
