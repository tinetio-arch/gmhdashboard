import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { generateDocPdf } from '@/lib/pdf/docPdfGenerator';

export const dynamic = 'force-dynamic';

const DOC_LABELS: Record<string, string> = {
    work_note: 'Work_Excuse_Note',
    school_note: 'School_Excuse_Note',
    discharge_instructions: 'Discharge_Instructions',
    care_plan: 'Care_Plan',
};

/**
 * GET /api/scribe/doc-pdf/?note_id=xxx&doc_type=work_note
 * Generate and return a professional supplementary document PDF for preview.
 */
export async function GET(request: NextRequest) {
    try { await requireApiUser(request, 'read'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    const noteId = request.nextUrl.searchParams.get('note_id');
    const docType = request.nextUrl.searchParams.get('doc_type');

    if (!noteId || !docType) {
        return NextResponse.json({ success: false, error: 'note_id and doc_type are required' }, { status: 400 });
    }

    const validDocTypes = ['work_note', 'school_note', 'discharge_instructions', 'care_plan'];
    if (!validDocTypes.includes(docType)) {
        return NextResponse.json({ success: false, error: 'Invalid doc_type' }, { status: 400 });
    }

    try {
        // Fetch note + patient + session data
        const [row] = await query<any>(`
            SELECT
                sn.note_id, sn.patient_id, sn.supplementary_docs, sn.session_id, sn.created_at,
                p.full_name as patient_name, p.dob as patient_dob,
                p.phone_primary as patient_phone, p.email as patient_email,
                p.address_line1, p.city, p.state, p.postal_code, p.clinic as patient_clinic,
                ss.encounter_date, ss.visit_type
            FROM scribe_notes sn
            LEFT JOIN patients p ON sn.patient_id::text = p.patient_id::text
            LEFT JOIN scribe_sessions ss ON sn.session_id = ss.session_id
            WHERE sn.note_id = $1
        `, [noteId]);

        if (!row) {
            return NextResponse.json({ success: false, error: 'Note not found' }, { status: 404 });
        }

        const suppDocs = row.supplementary_docs || {};
        const docEntry = suppDocs[docType];

        if (!docEntry?.content) {
            return NextResponse.json({ success: false, error: `No ${docType} found — generate one first` }, { status: 400 });
        }

        // If patient not found locally, try Healthie
        let patientName = row.patient_name || 'Unknown Patient';
        let patientDob = row.patient_dob;
        if (!row.patient_name) {
            try {
                const { healthieGraphQL } = await import('@/lib/healthieApi');
                const healthieUser = await healthieGraphQL<any>(`
                    query GetUser($id: ID!) {
                        user(id: $id) { first_name last_name dob }
                    }
                `, { id: row.patient_id });
                if (healthieUser?.user) {
                    patientName = `${healthieUser.user.first_name || ''} ${healthieUser.user.last_name || ''}`.trim();
                    patientDob = healthieUser.user.dob;
                }
            } catch { /* use fallback */ }
        }

        const encounterDateRaw = row.encounter_date;
        const visitDateObj = encounterDateRaw
            ? new Date(encounterDateRaw + 'T12:00:00')
            : new Date(row.created_at || Date.now());
        const visitDate = visitDateObj.toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
        });

        // Build patient address string
        const addressParts = [row.address_line1, row.city, row.state, row.postal_code].filter(Boolean);
        const patientAddress = addressParts.length > 0 ? addressParts.join(', ') : null;

        const pdfBuffer = await generateDocPdf({
            patientName,
            patientDob: patientDob ? new Date(patientDob).toLocaleDateString() : null,
            visitDate,
            provider: 'Phil Schafer, NP',
            docType: docType as any,
            content: docEntry.content,
            patientPhone: row.patient_phone || null,
            patientEmail: row.patient_email || null,
            patientAddress,
            patientClinic: row.patient_clinic || null,
        });

        const fileLabel = DOC_LABELS[docType] || 'Document';
        const filename = `${fileLabel}_${patientName.replace(/\s+/g, '_')}_${visitDate.replace(/\s+/g, '_')}.pdf`;

        return new NextResponse(pdfBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="${filename}"`,
            },
        });
    } catch (error) {
        console.error('[Scribe:DocPdf] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'PDF generation failed' },
            { status: 500 }
        );
    }
}
