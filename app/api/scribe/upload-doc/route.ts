import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';
import { generateDocPdf } from '@/lib/pdf/docPdfGenerator';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DOC_LABELS: Record<string, string> = {
    work_note: 'Work Excuse Note',
    school_note: 'School Excuse Note',
    discharge_instructions: 'Discharge Instructions',
    care_plan: 'Care Plan',
};

/**
 * POST: Upload a single supplementary doc to Healthie as a patient-visible PDF document.
 * Can be called independently from the full SOAP submit flow.
 */
export async function POST(request: NextRequest) {
    try { await requireApiUser(request, 'write'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const { note_id, doc_type } = await request.json();

        if (!note_id || !doc_type) {
            return NextResponse.json(
                { success: false, error: 'note_id and doc_type are required' },
                { status: 400 }
            );
        }

        const validDocTypes = ['work_note', 'school_note', 'discharge_instructions', 'care_plan'];
        if (!validDocTypes.includes(doc_type)) {
            return NextResponse.json(
                { success: false, error: `Invalid doc_type. Must be one of: ${validDocTypes.join(', ')}` },
                { status: 400 }
            );
        }

        // Fetch note with supplementary docs
        const [note] = await query<any>(
            'SELECT * FROM scribe_notes WHERE note_id = $1',
            [note_id]
        );
        if (!note) {
            return NextResponse.json({ success: false, error: 'Note not found' }, { status: 404 });
        }

        const suppDocs = note.supplementary_docs || {};
        const docEntry = suppDocs[doc_type];
        if (!docEntry?.content) {
            return NextResponse.json(
                { success: false, error: `No ${DOC_LABELS[doc_type] || doc_type} found — generate one first` },
                { status: 400 }
            );
        }

        // Resolve Healthie patient ID
        let healthiePatientId: string | null = null;
        let patient: any = null;

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(note.patient_id);
        if (isUuid) {
            const [localPatient] = await query<any>(
                'SELECT p.patient_id, p.full_name, p.dob, p.clinic, hc.healthie_client_id FROM patients p LEFT JOIN healthie_clients hc ON p.patient_id::text = hc.patient_id AND hc.is_active = true WHERE p.patient_id = $1',
                [note.patient_id]
            );
            if (localPatient) {
                patient = localPatient;
                healthiePatientId = localPatient.healthie_client_id;
            }
        }

        if (!healthiePatientId) {
            healthiePatientId = note.patient_id;
            try {
                const healthieUser = await healthieGraphQL<any>(`
                    query GetUser($id: ID!) {
                        user(id: $id) { id first_name last_name dob }
                    }
                `, { id: healthiePatientId });
                if (healthieUser?.user) {
                    patient = {
                        full_name: `${healthieUser.user.first_name || ''} ${healthieUser.user.last_name || ''}`.trim(),
                        dob: healthieUser.user.dob,
                    };
                }
            } catch {
                patient = { full_name: 'Unknown Patient', dob: null };
            }
        }

        // Get visit date from session
        const [session] = await query<any>(
            'SELECT ss.encounter_date, ss.created_at, u.display_name as provider_name FROM scribe_sessions ss LEFT JOIN users u ON ss.created_by::text = u.user_id::text WHERE ss.session_id = $1',
            [note.session_id]
        );
        const providerName = session?.provider_name || 'Phil Schafer, NP';
        const encounterDateRaw = session?.encounter_date;
        const visitDateObj = encounterDateRaw
            ? new Date(encounterDateRaw + 'T12:00:00')
            : new Date(note.created_at || Date.now());
        const visitDate = visitDateObj.toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
        });

        // Generate PDF
        const pdfBuffer = await generateDocPdf({
            patientName: patient?.full_name || 'Unknown',
            patientDob: patient?.dob ? new Date(patient.dob).toLocaleDateString() : null,
            visitDate,
            provider: providerName,
            docType: doc_type as any,
            content: docEntry.content,
            patientClinic: patient?.clinic || null,
        });

        const base64Content = pdfBuffer.toString('base64');
        const dataUrl = `data:application/pdf;base64,${base64Content}`;
        const docLabel = DOC_LABELS[doc_type] || doc_type;
        const filename = `${docLabel.replace(/\s+/g, '_')}_${(patient?.full_name || 'patient').replace(/\s+/g, '_')}_${visitDate.replace(/\s+/g, '_')}.pdf`;

        // Upload to Healthie as patient-visible document
        const docResult = await healthieGraphQL(`
            mutation CreateDocument($input: createDocumentInput!) {
                createDocument(input: $input) {
                    document { id display_name }
                    messages { field message }
                }
            }
        `, {
            input: {
                rel_user_id: String(healthiePatientId),
                display_name: filename,
                file_string: dataUrl,
                include_in_charting: true,
                share_with_rel: true,
                description: `${docLabel} - ${visitDate}`,
            }
        });

        const documentId = docResult?.createDocument?.document?.id;
        if (!documentId) {
            throw new Error('Healthie did not return a document ID');
        }

        console.log(`[Scribe:UploadDoc] ${docLabel} uploaded to Healthie: ${documentId} (shared with patient)`);

        return NextResponse.json({
            success: true,
            data: {
                note_id,
                doc_type,
                healthie_document_id: documentId,
                filename,
                shared_with_patient: true,
            },
        });
    } catch (error) {
        console.error('[Scribe:UploadDoc] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}
