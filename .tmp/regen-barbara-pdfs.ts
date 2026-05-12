/**
 * Regenerate Barbara Barone's discharge_instructions + care_plan PDFs
 * with the corrected DOB (03/30/1951) and re-upload to Healthie chart.
 *
 * One-shot: deletes the OLD wrong-DOB documents from Healthie first to avoid duplicates.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/gmhdashboard/.env.local' });
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';
import { generateDocPdf } from '@/lib/pdf/docPdfGenerator';
import { formatDateUTC } from '@/lib/dateUtils';

const NOTE_ID = 'ffc70632-50d6-409f-9637-08354cc1a9bc';
const HEALTHIE_PATIENT_ID = '15096436';

const DOC_LABELS: Record<string, string> = {
    discharge_instructions: 'Discharge Instructions',
    care_plan: 'Care Plan',
};

async function findExistingWrongDocs(): Promise<string[]> {
    const r = await healthieGraphQL<any>(`
        query GetDocs($cuid: String) {
            documents(consolidated_user_id: $cuid, offset: 0, page_size: 100, should_paginate: false) {
                id display_name created_at
            }
        }
    `, { cuid: HEALTHIE_PATIENT_ID });
    const docs: any[] = r?.documents || [];
    // Match Discharge_Instructions_* or Care_Plan_* uploaded by us
    return docs
        .filter((d: any) => /^(Discharge_Instructions|Care_Plan)_Barbara/.test(d.display_name || ''))
        .map((d: any) => ({ id: d.id, name: d.display_name, created: d.created_at }))
        .map((d: any) => { console.log(`  found old: ${d.id} — ${d.name} (${d.created})`); return d.id; });
}

async function deleteDoc(id: string) {
    try {
        await healthieGraphQL(`
            mutation DeleteDoc($input: deleteDocumentInput!) {
                deleteDocument(input: $input) { messages { field message } }
            }
        `, { input: { id } });
        console.log(`  deleted old doc ${id}`);
    } catch (e: any) {
        console.warn(`  could not delete ${id}: ${e.message}`);
    }
}

async function regen(docType: 'discharge_instructions' | 'care_plan') {
    const [note] = await query<any>('SELECT * FROM scribe_notes WHERE note_id = $1', [NOTE_ID]);
    const supp = note.supplementary_docs || {};
    const entry = supp[docType];
    if (!entry?.content) { console.log(`  no ${docType} content — skipping`); return; }

    const [patient] = await query<any>('SELECT full_name, dob, clinic FROM patients WHERE patient_id = $1', [note.patient_id]);
    const [session] = await query<any>(`
        SELECT ss.encounter_date, ss.created_at, u.display_name as provider_name
        FROM scribe_sessions ss LEFT JOIN users u ON ss.created_by::text = u.user_id::text
        WHERE ss.session_id = $1
    `, [note.session_id]);

    const encounterDateRaw = session?.encounter_date;
    const visitDate = encounterDateRaw
        ? new Date(encounterDateRaw + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : new Date(note.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const pdfBuffer = await generateDocPdf({
        patientName: patient.full_name,
        patientDob: formatDateUTC(patient.dob),  // FIXED: was new Date(...).toLocaleDateString()
        visitDate,
        provider: session?.provider_name || 'Phil Schafer, NP',
        docType: docType as any,
        content: entry.content,
        patientClinic: patient.clinic || null,
    });

    const docLabel = DOC_LABELS[docType];
    const filename = `${docLabel.replace(/\s+/g, '_')}_${patient.full_name.replace(/\s+/g, '_')}_${visitDate.replace(/\s+/g, '_')}.pdf`;
    const dataUrl = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;

    const r = await healthieGraphQL<any>(`
        mutation CreateDocument($input: createDocumentInput!) {
            createDocument(input: $input) {
                document { id display_name }
                messages { field message }
            }
        }
    `, {
        input: {
            rel_user_id: HEALTHIE_PATIENT_ID,
            display_name: filename,
            file_string: dataUrl,
            include_in_charting: true,
            share_with_rel: true,
            description: `${docLabel} - ${visitDate} (regenerated with corrected DOB)`,
        }
    });

    const newId = r?.createDocument?.document?.id;
    if (!newId) { console.error(`  FAILED to upload ${docType}:`, JSON.stringify(r?.createDocument?.messages)); return; }
    console.log(`  ✅ uploaded ${docType} — Healthie doc ${newId} (${filename})`);
}

(async () => {
    console.log('Step 1: finding old (wrong-DOB) documents...');
    const oldIds = await findExistingWrongDocs();
    console.log(`Step 2: deleting ${oldIds.length} old documents...`);
    for (const id of oldIds) await deleteDoc(id);
    console.log('Step 3: regenerating discharge_instructions...');
    await regen('discharge_instructions');
    console.log('Step 4: regenerating care_plan...');
    await regen('care_plan');
    console.log('Done.');
    process.exit(0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
